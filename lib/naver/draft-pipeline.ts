import { supabaseAdmin } from '@/lib/supabase-admin'
import { titleSimilarity } from '@/lib/naver/dedupe'
import { cafeObservedTitles, cafePopularPosts, type TasteProfile, type PopularPost } from '@/lib/naver/taste'
import type { NaverOptions } from '@/lib/naver/settings'

/* 카페 원고 '생성 재료 수집 + 후보 심사' 공통 로직.

   왜 모았나: 원고를 만드는 경로가 둘이다 —
     · /api/naver-cafe/auto-drafts (사람이 누르는 생성 / 매일 아침 크론)
     · /api/naver-cafe/tick        (발행처 자동 스케줄)
   두 곳이 같은 재료 조회와 같은 4중 필터를 각자 복제해 갖고 있었고, 이미 어긋나 있었다
   (참고할 '카페 결' 제목 수가 한쪽 15개, 다른 쪽 12개). 임계값도 양쪽에 하드코딩돼 있어
   한쪽만 고치면 두 경로가 서로 다른 기준으로 글을 걸러내게 된다.
   → 재료·기준·심사를 여기 한 곳에 둔다. */

export const DRAFT_FILTER = {
  /** 사장님이 반려했던 제목과 이 정도 비슷하면 버린다(싫어한 결 재생산 방지) */
  rejectedSimilarity: 0.5,
  /** 카페에 실제로 있는 남의 글과 이 정도 비슷하면 버린다(따라 쓴 티) */
  cafePostSimilarity: 0.75,
  /** 프롬프트에 넣을 '이 카페 결' 제목 수 */
  vibeLimit: 15,
  /** 반응 검증된 소재 시드 후보 수 */
  seedLimit: 5,
  /** 중복 회피용으로 읽어올 최근 우리 글 수 */
  recentTitleLimit: 60,
} as const

export interface DraftContext {
  /** 최근 dup_window_days 안에 이 카페로 만든 우리 글 제목(중복 회피) */
  avoidTitles: string[]
  /** 이 카페에 실제 올라오는 글 제목(말투·소재 결 참고, 광고·잡글 제외) */
  vibe: string[]
  /** 반응이 검증된 소재 시드(주제만 차용) */
  populars: PopularPost[]
}

/** 한 발행처의 생성 재료를 모은다(두 경로가 똑같은 재료를 쓰도록). */
export async function loadDraftContext(cafeId: string, options: NaverOptions): Promise<DraftContext> {
  const dupSince = new Date(Date.now() - Math.max(1, options.dup_window_days) * 86400_000).toISOString()
  const [recentRes, vibe, populars] = await Promise.all([
    supabaseAdmin
      .from('nc_posts')
      .select('title')
      .eq('cafe_id', cafeId)
      .gte('created_at', dupSince)
      .order('created_at', { ascending: false })
      .limit(DRAFT_FILTER.recentTitleLimit),
    cafeObservedTitles(cafeId, DRAFT_FILTER.vibeLimit),
    cafePopularPosts(cafeId, DRAFT_FILTER.seedLimit),
  ])
  const avoidTitles = ((recentRes.data ?? []) as { title: string | null }[])
    .map((r) => String(r.title ?? '').trim())
    .filter(Boolean)
  return { avoidTitles, vibe, populars }
}

export type ScreenResult = { ok: true } | { ok: false; kind: 'dup' | 'taste'; reason: string }

/* 생성된 제목 후보 심사 — 통과한 것만 저장한다.
   순서가 곧 정책이다:
     ① 최근 우리 글과 중복      → 같은 글 반복 방지
     ② 반려됐던 결과 유사        → 사장님이 싫어한 톤 재생산 방지
     ③ 승인·발행작과 유사        → 승인 = 이미 포스팅됨. 좋았다고 또 쓰면 반려 대상(사장님 룰)
     ④ 카페의 남의 글과 유사     → 표절 시비 방지 */
export function screenTitle(
  title: string,
  args: { seen: string[]; vibe: string[]; taste: TasteProfile; options: NaverOptions },
): ScreenResult {
  const { seen, vibe, taste, options } = args
  const t = String(title || '').trim()
  if (!t) return { ok: false, kind: 'dup', reason: '제목 없음' }

  if (seen.some((old) => titleSimilarity(t, old) >= options.dup_similarity)) {
    return { ok: false, kind: 'dup', reason: '중복(최근 비슷한 글)' }
  }
  if (taste.active && taste.rejectedTitles.some((rt) => titleSimilarity(t, rt) >= DRAFT_FILTER.rejectedSimilarity)) {
    return { ok: false, kind: 'taste', reason: '반려됐던 결과 유사' }
  }
  if (taste.approvedTitles.some((at) => titleSimilarity(t, at) >= options.dup_similarity)) {
    return { ok: false, kind: 'taste', reason: '승인작과 유사(복제 방지)' }
  }
  if (vibe.some((vt) => titleSimilarity(t, vt) >= DRAFT_FILTER.cafePostSimilarity)) {
    return { ok: false, kind: 'taste', reason: '카페 기존 글과 유사' }
  }
  return { ok: true }
}

/** 취향 학습을 프롬프트용 형태로(활성일 때만). 두 경로가 같은 방식으로 넘기도록. */
export function tasteForPrompt(taste: TasteProfile) {
  return taste.active
    ? { active: true as const, approvedSamples: taste.approvedSamples, rejectedSamples: taste.rejectedSamples, guidance: taste.guidance }
    : undefined
}
