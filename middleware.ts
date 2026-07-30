import { NextResponse, type NextRequest } from 'next/server'

/* 서버 측 접근 제어.  ⚠️ 화면에서 메뉴를 숨기는 것만으로는 못 막는다 —
   주소를 직접 치거나 fetch 로 API 를 부르면 그대로 뚫리기 때문에, 요청 자체를 여기서 막는다.

   체험 계정(role='trial')
     허용: 크롤러 3종(메타·구글·온드미디어) 열람, 소재에서 기획 마인드맵/AI 분석, 제작도구·보드류
     차단: 네이버 카페 자동화 / 기획안 제작 / 데이터 추적 / 인스타 성과 / 관리자
     차단: 광고주(크롤링 대상) 추가·수정·삭제 — 열람만 가능
     만료(trial_expires_at 경과) 시 전부 차단

   ※ 이 미들웨어는 위 "차단 대상" 경로만 검사한다. 나머지 API 는 예전과 동일하게 동작하므로
     기존 기능·크론·로컬 에이전트에 영향이 없다. */

// ── 체험 계정이 못 보는 화면 ──
const TRIAL_BLOCKED_PAGES = ['/naver-cafe', '/project-plans', '/data-tracking', '/instagram', '/admin']

// ── '관리자 페이지에서 승인된 사용자'만 볼 수 있는 화면 ──
//    관리자·정식 승인(role: admin|approved)만 통과. 체험·대기·미로그인은 차단(AuthGuard 우회 불가한 서버 게이트).
//    ※ 여기 넣는 경로는 위 TRIAL_BLOCKED_PAGES 에도 포함돼 있어야 미들웨어가 검사한다.
const APPROVED_ONLY_PAGES = ['/data-tracking']

// ── 체험 계정이 못 부르는 API(로그인 안 한 사람도 못 부른다) ──
const PROTECTED_API = ['/api/naver-cafe', '/api/pb', '/api/instagram', '/api/admin']

/* 위 API 안에서도 "사람 로그인"과 무관하게 열려 있어야 하는 것들.
     - 네이버 카페 에이전트: 내 PC 워커가 x-agent-token 으로 호출(사용자 세션 없음)
     - 자동 스케줄/초안 크론: GitHub Actions 가 호출
     - 데이터 추적 수집 비컨: 고객사 사이트에서 익명으로 호출 — 막으면 추적이 죽는다 */
const API_EXCEPTIONS = ['/api/naver-cafe/agent', '/api/naver-cafe/tick', '/api/naver-cafe/auto-drafts', '/api/naver-cafe/reflow', '/api/instagram/cron', '/api/pb/collect']

// ── 광고주(크롤링 대상) 변경 — 체험 계정은 조회만 ──
const TARGET_MUTATION_API = ['/api/meta-ad/targets', '/api/google-ads/targets', '/api/owned-media/creators']

const startsWithAny = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p + '/'))

type Profile = { role: string; trial_expires_at: string | null; can_data_tracking?: boolean } | null

// 같은 사용자의 연속 요청마다 Supabase 를 두 번씩 부르지 않도록 짧게 캐시(60초).
const cache = new Map<string, { at: number; profile: Profile }>()
const TTL = 60_000

async function loadProfile(token: string): Promise<Profile> {
  const hit = cache.get(token)
  if (hit && Date.now() - hit.at < TTL) return hit.profile

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_KEY
  if (!url || !anon || !service) return null

  try {
    // 1) 토큰이 진짜인지 Supabase 에 확인(위조 토큰 차단)
    const ures = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })
    if (!ures.ok) { cache.set(token, { at: Date.now(), profile: null }); return null }
    const user = (await ures.json()) as { id?: string }
    if (!user?.id) return null

    // 2) 역할·만료·권한 조회(service_role — RLS 우회)
    //    select=* : 아직 can_data_tracking 컬럼이 없어도(마이그레이션 전) 에러 없이 통과하도록 전체 선택.
    const pres = await fetch(`${url}/rest/v1/user_profiles?id=eq.${user.id}&select=*`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    })
    const rows = pres.ok ? ((await pres.json()) as Profile[]) : []
    const profile = rows?.[0] ?? null
    cache.set(token, { at: Date.now(), profile })
    if (cache.size > 500) cache.delete(cache.keys().next().value as string)
    return profile
  } catch {
    return null
  }
}

const deny = (req: NextRequest, reason: string) => {
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: reason }, { status: 403 })
  }
  const to = new URL('/', req.url)
  to.searchParams.set('denied', reason)
  return NextResponse.redirect(to)
}

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname

  const isProtectedApi = startsWithAny(path, PROTECTED_API) && !startsWithAny(path, API_EXCEPTIONS)
  const isBlockedPage = startsWithAny(path, TRIAL_BLOCKED_PAGES)
  const isApprovedOnlyPage = startsWithAny(path, APPROVED_ONLY_PAGES)
  const isTargetMutation = startsWithAny(path, TARGET_MUTATION_API) && req.method !== 'GET'
  if (!isProtectedApi && !isBlockedPage && !isTargetMutation) return NextResponse.next()

  const token = req.cookies.get('cd-at')?.value || ''
  const profile = token ? await loadProfile(token) : null

  // 로그인 안 됨 / 프로필 없음
  if (!profile) {
    // 보호 API 는 익명 호출을 막는다(지금까지 열려 있던 구멍).
    if (isProtectedApi) return deny(req, '로그인이 필요합니다')
    // 승인자 전용 화면은 미로그인도 서버에서 막는다(AuthGuard 우회 방지).
    if (isApprovedOnlyPage) return deny(req, '로그인이 필요합니다')
    // 그 외 화면은 기존처럼 클라이언트 AuthGuard 가 로그인 폼을 띄우게 통과시킨다.
    return NextResponse.next()
  }

  // 데이터 추적 전용 권한 게이트 — 앱 승인과 별개인 can_data_tracking 하나만 본다(관리자는 항상 통과).
  //   · 마이그레이션 전(can_data_tracking undefined)이면 예전처럼 정식 승인(approved)에 열어 준다.
  //   · 관리자 페이지 '데이터 추적 권한' 탭에서 끄면(false) 정식 승인이라도 차단.
  if (isApprovedOnlyPage) {
    const dt = profile.can_data_tracking
    const allowed = profile.role === 'admin' || dt === true || (dt === undefined && profile.role === 'approved')
    if (!allowed) return deny(req, '데이터 추적 권한이 없어요 (관리자에게 요청하세요)')
  }

  const isTrial = profile.role === 'trial'
  if (!isTrial) return NextResponse.next() // 관리자·정식 계정은 예전과 동일

  // 만료된 체험 계정 → 전부 차단
  if (profile.trial_expires_at && Date.parse(profile.trial_expires_at) <= Date.now()) {
    return deny(req, '체험 기간이 끝났습니다')
  }
  if (isTargetMutation) return deny(req, '체험 계정은 광고주를 변경할 수 없어요')
  return deny(req, '체험 계정은 이용할 수 없는 메뉴예요')
}

export const config = {
  // 검사가 필요한 경로에서만 미들웨어를 돌려 나머지 요청은 그대로 빠르게 지나가게 한다.
  matcher: [
    '/naver-cafe/:path*',
    '/project-plans/:path*',
    '/data-tracking/:path*',
    '/instagram/:path*',
    '/admin/:path*',
    '/api/naver-cafe/:path*',
    '/api/pb/:path*',
    '/api/instagram/:path*',
    '/api/admin/:path*',
    '/api/meta-ad/targets/:path*',
    '/api/google-ads/targets/:path*',
    '/api/owned-media/creators/:path*',
  ],
}
