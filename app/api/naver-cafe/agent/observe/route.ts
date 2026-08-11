import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { setMeta } from '@/lib/naver/pacing'
import { mergeObservedRow, OBSERVE_GAP_MS, OBSERVE_GLOBAL_GAP_MS, type ObservedPrev } from '@/lib/naver/observe-rules'

/* 카페 관찰 — 워커(노트북)가 발행처 게시판에 들러 '실제로 올라오는 글'을 수집한다.
   GET  → 지금 관찰할 카페 1곳 배정
          · 카페당 11시간에 1번(= 하루 2번). 오전/오후 다른 시간대에 자연스럽게 걸린다.
          · 카페 사이엔 최소 25분 간격 — 5개 카페를 20초 만에 연속 방문하는 '봇 패턴'을 막는다.
   POST → 수집 결과 저장. 첫 관측치(views_first/comments_first)는 한 번만 박고 이후엔 최신값만 갱신
          → 24시간 뒤 증가폭(반응)을 잴 수 있다. 평가는 lib/naver/observe-eval.ts 가 크론에서 수행.
   ⚠️ /api/naver-cafe/agent/* 는 middleware 예외(워커는 사용자 세션이 없다) — x-agent-token 으로 인증. */

export const dynamic = 'force-dynamic'

// 간격 상수는 lib/naver/observe-rules 에서 가져온다(현황 페이지가 같은 값으로 '다음 수집 예정'을 계산)
const GLOBAL_GAP_MS = OBSERVE_GLOBAL_GAP_MS
const META_PREFIX = 'observe:'
const GLOBAL_KEY = 'observe_last_any'

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true // 토큰 미설정(로컬) → 개방
  return req.headers.get('x-agent-token') === need
}

// 카페 UI 라벨(전체글보기 등)이 제목으로 잘못 잡히는 걸 걸러낸다.
const UI_LABELS = /^(전체\s?글\s?보기|인기글|공지|카페\s?태그|멤버|출석|등업|가입인사|카페\s?정보|즐겨찾는\s?게시판|베스트\s?게시판)$/

function cleanTitle(raw: unknown): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length < 5 || t.length > 100) return ''
  if (UI_LABELS.test(t)) return ''
  /* 숫자·괄호뿐인 문자열("[ 4 ]", "12")은 글 제목이 아니라 '댓글 수 배지'다.
     워커에서 이미 걸러지지만, 스킨이 다른 카페에서 또 새 나갈 수 있어 서버에서도 막는다. */
  if (/^\[?\s*\d{1,5}\s*\]?$/.test(t)) return ''
  return t
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })

  const nowMs = Date.now()

  /* 워커가 20초마다 부르는 엔드포인트라 쿼리 수를 고정해 둔다.
     (카페마다 getMeta 를 부르면 카페 수 × 2회 × 하루 4320번 = 수만 쿼리) → nc_meta 를 한 번에 읽어 Map 으로 본다. */
  const { data: metaRows } = await supabaseAdmin.from('nc_meta').select('key, value').limit(1000)
  const meta = new Map((metaRows ?? []).map((m) => [String((m as { key: string }).key), String((m as { value?: string }).value ?? '')]))

  // 카페 간 최소 간격 — 직전 관찰이 25분 이내면 이번엔 배정하지 않는다(사람처럼 띄엄띄엄).
  const lastAnyMs = Date.parse(meta.get(GLOBAL_KEY) || '')
  if (!Number.isNaN(lastAnyMs) && nowMs - lastAnyMs < GLOBAL_GAP_MS) {
    return NextResponse.json({ none: true, reason: '카페 간 간격 대기 중' })
  }

  const { data: cafes } = await supabaseAdmin
    .from('nc_cafes')
    .select('id, name, cafe_url, club_id, board_id')
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  for (const cafe of cafes || []) {
    if (!cafe.cafe_url) continue
    // 연속 실패로 일시정지된 발행처는 관찰도 쉰다(문제 카페를 계속 두드리지 않게).
    if (meta.get(`pause:${cafe.id}`)) continue
    const lastMs = Date.parse(meta.get(`${META_PREFIX}${cafe.id}`) || '')
    if (!Number.isNaN(lastMs) && nowMs - lastMs < OBSERVE_GAP_MS) continue
    // 배정 시각을 지금 기록 — 수집이 실패해도 11시간 뒤에나 재시도(같은 카페를 계속 두드리지 않게)
    await setMeta(`${META_PREFIX}${cafe.id}`, new Date(nowMs).toISOString())
    await setMeta(GLOBAL_KEY, new Date(nowMs).toISOString())
    return NextResponse.json({ cafe })
  }
  return NextResponse.json({ none: true })
}

type ExistingRow = ObservedPrev & { title: string }

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const cafeId = (b.cafe_id || '').toString()
  const items = Array.isArray(b.items) ? b.items.slice(0, 40) : []
  if (!cafeId || !items.length) return NextResponse.json({ error: 'cafe_id/items 필요' }, { status: 400 })

  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 99_999_999) : null
  }

  const nowISO = new Date().toISOString()
  type Incoming = { title: string; article_id: string | null; views: number | null; comments: number | null; is_popular: boolean }
  const incoming: Incoming[] = []
  const seen = new Set<string>()
  for (const it of items) {
    const o = it as { title?: unknown; article_id?: unknown; views?: unknown; comments?: unknown; is_popular?: unknown }
    const title = cleanTitle(o?.title)
    if (!title || seen.has(title)) continue
    seen.add(title)
    incoming.push({
      title,
      article_id: o?.article_id ? String(o.article_id) : null,
      views: num(o?.views),
      comments: num(o?.comments),
      is_popular: o?.is_popular === true,
    })
  }
  if (!incoming.length) return NextResponse.json({ ok: true, stored: 0 })

  /* 기존 행을 먼저 읽어 '병합값'을 직접 계산한다 — 그냥 upsert 하면
       ① 첫 관측치(views_first)가 매번 덮어써져 증가폭을 영영 못 재고,
       ② 이번에 파싱 실패한 지표(null)가 지난 값을 지우고,
       ③ 어제 인기글이던 글의 is_popular 가 오늘 false 로 내려간다.
     제목 목록을 URL 쿼리(.in)로 넘기면 길어져 깨질 수 있어, 이 카페의 최근 행을 한 번에 읽어 JS 에서 맞춘다. */
  const since = new Date(Date.now() - 60 * 86400_000).toISOString()
  const { data: existingRows, error: readErr } = await supabaseAdmin
    .from('nc_cafe_posts')
    .select('title, article_id, views, comments, views_first, comments_first, first_metric_at, is_popular, verdict')
    .eq('cafe_id', cafeId)
    .gte('last_seen', since)
    .order('last_seen', { ascending: false })
    .limit(1000)

  // 컬럼 미생성(마이그레이션 전)이면 확장 필드 없이 제목만 저장하는 폴백으로 간다.
  const legacyMode = !!readErr
  const prev = new Map<string, ExistingRow>()
  if (!legacyMode) for (const r of (existingRows ?? []) as ExistingRow[]) prev.set(r.title, r)

  // 병합 규칙은 lib/naver/observe-rules.mergeObservedRow (순수 함수 — 단위 테스트 대상)
  const rows = incoming.map((r) => {
    const p = prev.get(r.title)
    const base: Record<string, unknown> = { cafe_id: cafeId, title: r.title, last_seen: nowISO }
    if (legacyMode) return { ...base, article_id: r.article_id ?? p?.article_id ?? null }
    return { ...base, ...mergeObservedRow(p, r, nowISO) }
  })

  let { error } = await supabaseAdmin.from('nc_cafe_posts').upsert(rows, { onConflict: 'cafe_id,title' })
  if (error && /(views|comments|is_popular|views_first|comments_first|first_metric_at|verdict)/.test(error.message)) {
    // 확장 컬럼 미생성 폴백 — 제목만이라도 저장(기능 무중단)
    const stripped = rows.map((r) => ({
      cafe_id: r.cafe_id, title: r.title, article_id: r.article_id, last_seen: r.last_seen,
    }))
    ;({ error } = await supabaseAdmin.from('nc_cafe_posts').upsert(stripped, { onConflict: 'cafe_id,title' }))
  }
  if (error) {
    const missing = /nc_cafe_posts/.test(error.message)
    return NextResponse.json(
      { ok: false, error: missing ? 'nc_cafe_posts 테이블이 없어요 — Supabase 에서 db/naver-cafe-observe.sql 실행 필요' : error.message },
      { status: missing ? 503 : 500 },
    )
  }
  const fresh = rows.filter((r) => !prev.has(String(r.title))).length
  return NextResponse.json({ ok: true, stored: rows.length, fresh })
}
