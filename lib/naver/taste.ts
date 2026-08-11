import { supabaseAdmin } from '@/lib/supabase-admin'

/* 사장님 취향 학습 — 승인/반려 이력(nc_posts)에서 "무엇을 좋아하고 무엇을 걷어내는지"를 뽑는다.
   별도 테이블 없이 기존 데이터가 원천: 승인·발행 = 좋아요 신호, 반려 = 싫어요 신호.

   쓰는 곳(auto-drafts):
   1) 프롬프트 가이드 — 승인작 스타일 예시(⚠️ 참고만, 이미 발행된 글이라 비슷하면 다시 반려됨을 명시)
      + 반려작 예시(이 결 피하기) + 데이터에서 계산한 경향 문장.
   2) 생성 후 점수 필터 — 반려작과 비슷한 후보는 버리고(≥0.5), 승인작과 너무 비슷한 후보도 버린다
      (승인 = 이미 포스팅됨. 복제하면 안 된다는 사장님 룰).

   데이터가 충분해질 때까지(승인 5+ · 반려 3+) 비활성 — 어설픈 데이터로 편향 주지 않는다. */

export interface TasteProfile {
  active: boolean
  approvedCount: number
  rejectedCount: number
  /** 복제 금지용 전체 승인 제목(발행됨 포함, 최대 150) — 생성 후보가 이와 비슷하면 버린다 */
  approvedTitles: string[]
  /** 프롬프트 참고용 최근 승인 제목 */
  approvedSamples: string[]
  /** 프롬프트 회피용 최근 반려 제목 */
  rejectedSamples: string[]
  /** 반려작 유사도 필터용(최대 80) */
  rejectedTitles: string[]
  /** 승인/반려 데이터에서 계산한 경향 문장들 */
  guidance: string[]
}

const EMPTY: TasteProfile = {
  active: false, approvedCount: 0, rejectedCount: 0,
  approvedTitles: [], approvedSamples: [], rejectedSamples: [], rejectedTitles: [], guidance: [],
}

// 시스템이 자동 반려한 것(설정 문제)은 취향이 아니다 — 반려 신호에서 제외.
const SYSTEM_REJECT_NOTES = ['카페 설정 없음', '말머리 미설정', '글 발행 미허용', '댓글 미허용']

type Row = { title: string | null; note?: string | null }

const rate = (titles: string[], re: RegExp) => (titles.length ? titles.filter((t) => re.test(t)).length / titles.length : 0)
const avgLen = (titles: string[]) => (titles.length ? Math.round(titles.reduce((s, t) => s + t.length, 0) / titles.length) : 0)

export async function buildTasteProfile(): Promise<TasteProfile> {
  try {
    const [likedRes, dislikedRes] = await Promise.all([
      supabaseAdmin
        .from('nc_posts')
        .select('title')
        .in('status', ['approved', 'queued', 'published'])
        .not('title', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(150),
      supabaseAdmin
        .from('nc_posts')
        .select('title, note')
        .eq('status', 'rejected')
        .not('title', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(120),
    ])

    const liked = ((likedRes.data as Row[] | null) ?? []).map((r) => String(r.title || '').trim()).filter(Boolean)
    const disliked = ((dislikedRes.data as Row[] | null) ?? [])
      .filter((r) => !SYSTEM_REJECT_NOTES.some((n) => String(r.note || '').includes(n)))
      .map((r) => String(r.title || '').trim())
      .filter(Boolean)

    const active = liked.length >= 5 && disliked.length >= 3

    // 경향 계산 — 차이가 뚜렷한 것만 문장으로(애매한 차이로 지시하면 오히려 편향).
    const guidance: string[] = []
    if (active) {
      const lLen = avgLen(liked)
      const dLen = avgLen(disliked)
      if (Math.abs(lLen - dLen) >= 5) guidance.push(`승인작 제목은 평균 ${lLen}자(반려작 ${dLen}자) — ${lLen < dLen ? '짧고 툭 던지는' : '조금 더 구체적인'} 쪽 선호`)
      const pairs: [string, RegExp][] = [
        ['ㅠ/ㅜ 감정 표기', /[ㅠㅜ]/],
        ['물음표(질문형)', /\?/],
        ['말줄임(…/...)', /(\.\.\.|…)/],
        ['ㅋ/ㅎ 웃음기', /[ㅋㅎ]/],
      ]
      for (const [label, re] of pairs) {
        const l = rate(liked, re)
        const d = rate(disliked, re)
        if (l - d >= 0.25) guidance.push(`${label} 있는 제목 선호(승인 ${Math.round(l * 100)}% vs 반려 ${Math.round(d * 100)}%)`)
        else if (d - l >= 0.25) guidance.push(`${label} 과한 제목은 반려 경향(반려 ${Math.round(d * 100)}% vs 승인 ${Math.round(l * 100)}%)`)
      }
    }

    return {
      active,
      approvedCount: liked.length,
      rejectedCount: disliked.length,
      approvedTitles: liked,
      approvedSamples: liked.slice(0, 6),
      rejectedSamples: disliked.slice(0, 6),
      rejectedTitles: disliked.slice(0, 80),
      guidance,
    }
  } catch {
    return EMPTY
  }
}

/* 특정 카페의 '관찰된 실제 글 제목'(워커가 수집) — 원고가 이 카페의 말투·소재 결을 맞추는 재료.
   ⚠️ 광고(ad)·잡글(noise)은 제외한다 — 그 결을 따라가면 우리 글까지 광고처럼 보인다.
   판정 전(pending)·측정 불가(unrated)는 포함(진짜 회원 글이라 결 참고엔 문제없음).
   ⚠️ 필터는 SQL 이 아니라 JS 에서 한다 — verdict 가 NULL 인 옛 행이 SQL NOT IN 에서 통째로 사라지기 때문. */
const VIBE_EXCLUDE = new Set(['ad', 'noise'])
export async function cafeObservedTitles(cafeId: string, limit = 15): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('nc_cafe_posts')
      .select('*')
      .eq('cafe_id', cafeId)
      .order('last_seen', { ascending: false })
      .limit(Math.max(limit * 3, 45)) // 광고·잡글이 걸러질 것을 감안해 넉넉히 읽는다
    if (error) return []
    return (data as Record<string, unknown>[] ?? [])
      .filter((r) => r.is_ad !== true && !VIBE_EXCLUDE.has(String(r.verdict ?? '')))
      .map((r) => String(r.title || '').trim())
      .filter(Boolean)
      .slice(0, limit)
  } catch {
    return []
  }
}

/* 이 카페에서 '반응이 검증된 글' — 원고 소재 시드용(최근 14일).
   우선순위: ① 24시간 평가에서 keep 판정 → ② (평가 이력이 아직 없을 때만) 인기글 폴백.
   ⛔ 광고(ad)·잡글(noise)·저반응(drop)은 절대 시드가 되지 않는다.
   ⚠️ 시드는 '주제'만 차용한다 — 본문은 애초에 수집하지 않아 물리적으로 베낄 수 없고,
      제목 유사도 필터(생성 후 ≥0.75)가 비슷한 제목도 차단한다. */
export interface PopularPost { title: string; views: number | null; comments: number | null }
export async function cafePopularPosts(cafeId: string, limit = 5): Promise<PopularPost[]> {
  try {
    const since = new Date(Date.now() - 14 * 86400_000).toISOString()
    const { data, error } = await supabaseAdmin
      .from('nc_cafe_posts')
      .select('*')
      .eq('cafe_id', cafeId)
      .gte('last_seen', since)
      .order('last_seen', { ascending: false })
      .limit(150)
    if (error || !data) return []

    const rows = (data as Record<string, unknown>[])
      .map((r) => ({
        title: String(r.title || '').trim(),
        views: typeof r.views === 'number' ? (r.views as number) : null,
        comments: typeof r.comments === 'number' ? (r.comments as number) : null,
        popular: r.is_popular === true,
        verdict: String(r.verdict ?? ''),
        isAd: r.is_ad === true,
        score: typeof r.score === 'number' ? (r.score as number) : null,
      }))
      .filter((r) => r.title && !r.isAd && r.verdict !== 'ad' && r.verdict !== 'noise')

    // ① 평가 통과(keep) — 점수 높은 순
    const keeps = rows.filter((r) => r.verdict === 'keep')
    if (keeps.length) {
      keeps.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || Number(b.popular) - Number(a.popular))
      return keeps.slice(0, limit).map(({ title, views, comments }) => ({ title, views, comments }))
    }

    // ② 폴백 — 아직 평가된 글이 없을 때(수집 첫날 등). 인기글/지표 상위로 대신한다.
    //    drop 판정된 글은 이미 '반응 낮음'이 확인됐으므로 폴백에서도 뺀다.
    const fallback = rows
      .filter((r) => r.verdict !== 'drop' && (r.popular || (r.views ?? 0) > 0 || (r.comments ?? 0) > 0))
      .sort(
        (a, b) =>
          Number(b.popular) - Number(a.popular) ||
          (b.views ?? -1) - (a.views ?? -1) ||
          (b.comments ?? -1) - (a.comments ?? -1),
      )
    return fallback.slice(0, limit).map(({ title, views, comments }) => ({ title, views, comments }))
  } catch {
    return []
  }
}
