import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { classifyByRules, computeDelta, cafeThreshold, decideVerdict, type Verdict } from '@/lib/naver/observe-rules'

/* 카페 관찰 글 자동 평가 — "수집 → 24시간 뒤 재측정 → 잘 나온 것만 남기기 + 광고 걸러내기".

   흐름
     ① 워커가 하루 2번 수집 → 첫 관측치(views_first/comments_first/first_metric_at)가 한 번만 박히고,
        이후 방문마다 최신값(views/comments)만 갱신된다.
     ② 이 파일의 evaluateObservedPosts() 가 매시각(크론) 돌면서
        '첫 관측 후 24시간이 지난 pending 글'만 골라 판정한다(한 글당 정확히 1회 — 멱등).
     ③ 판정: 광고/잡글 먼저 걸러내고(규칙 → AI), 나머지는 24시간 증가폭으로 점수를 매겨
        그 카페의 평소 수준(60분위)과 비교해 keep / drop.

   ⚠️ 원칙: 어떤 글도 삭제하지 않는다. 광고도 verdict='ad' 로 '남겨서' 화면에서 볼 수 있게 한다.
      소재로 쓰이지 않을 뿐이다(taste.ts 의 시드/결 조회가 verdict·is_ad 로 거른다).
   ⚠️ 판정 규칙 자체는 lib/naver/observe-rules.ts(순수 함수)에 있다 — 단위 테스트 대상. */

// 첫 관측 후 이 시간이 지나야 평가한다(요청: "1일 뒤에 한번씩 재고").
const EVAL_AFTER_MS = 24 * 60 * 60 * 1000
// 한 번의 크론 실행에서 평가할 최대 건수(타임아웃 방지)
const MAX_PER_RUN = 300
// AI 광고 판별 1회 배치 크기
const AI_BATCH = 40
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'

/* ── AI 광고 판별(2차) ──
   규칙으로 확정 못 한 제목만 배치로 묶어 한 번에 물어본다(카페당 하루 1~2회, 토큰 미미).
   서버 공용 키가 없으면 이 단계는 조용히 건너뛴다(규칙 판정만으로 동작). */
export async function classifyAdsByAI(titles: string[], apiKey: string, model: string): Promise<Set<number>> {
  const ads = new Set<number>()
  if (!apiKey || !titles.length) return ads

  for (let off = 0; off < titles.length; off += AI_BATCH) {
    const batch = titles.slice(off, off + AI_BATCH)
    const prompt = `너는 네이버 카페 게시판을 정리하는 사람이다. 아래 글 제목들 중 "광고·상업적 홍보 글"의 번호만 골라라.

[광고로 볼 것]
- 상품·서비스를 팔거나 홍보하는 글(업체 소개, 공동구매, 할인·특가 안내, 체험단·서포터즈 모집)
- 연락 유도(카톡·오픈채팅·전화번호·링크·DM), 구인/알바 모집, 제휴·협찬 제안

[절대 광고가 아닌 것 — 실수로 고르지 마라]
- 회원이 무언가를 묻는 글("업체 추천 부탁드려요", "다들 어디서 하세요?", "가격 얼마나 하나요")
- 개인 경험·후기·푸념·일상 잡담("직접 해봤는데 별로였어요", "요즘 매출 어떠세요")
- 정보 공유·노하우 글(팔려는 의도 없이 아는 걸 푸는 글)
- 애매하면 광고가 아닌 것으로 판단해라(놓치는 것보다 잘못 잡는 게 더 나쁘다).

[제목들]
${batch.map((t, i) => `${i + 1}. ${t}`).join('\n')}

광고인 번호만 쉼표로 구분해 한 줄로 출력. 없으면 "none" 만 출력. 다른 말 금지.`

    try {
      const r = await fetch(ANTHROPIC_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
        signal: AbortSignal.timeout(30_000),
      })
      if (!r.ok) continue // 실패해도 규칙 판정만으로 진행(평가를 멈추지 않는다)
      const j = await r.json().catch(() => ({}))
      const text: string = Array.isArray(j?.content)
        ? j.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join(' ')
        : ''
      if (/none/i.test(text)) continue
      for (const m of text.matchAll(/\d+/g)) {
        const n = Number(m[0])
        if (n >= 1 && n <= batch.length) ads.add(off + n - 1)
      }
    } catch { /* 네트워크 오류 무시 — 규칙 판정으로 폴백 */ }
  }
  return ads
}

type Row = {
  id: string
  cafe_id: string
  title: string
  views: number | null
  comments: number | null
  views_first: number | null
  comments_first: number | null
  first_metric_at: string | null
  last_seen: string | null
  is_popular: boolean | null
}

export type EvalSummary = {
  ok: boolean
  evaluated: number
  keep: number
  drop: number
  ad: number
  noise: number
  unrated: number
  tableMissing?: boolean
  error?: string
}

/** 첫 관측 후 24시간이 지난 관찰 글을 평가한다(한 글당 1회, 멱등). 크론이 매시각 호출. */
export async function evaluateObservedPosts(): Promise<EvalSummary> {
  const empty: EvalSummary = { ok: true, evaluated: 0, keep: 0, drop: 0, ad: 0, noise: 0, unrated: 0 }
  const nowMs = Date.now()
  const dueBefore = new Date(nowMs - EVAL_AFTER_MS).toISOString()

  const { data, error } = await supabaseAdmin
    .from('nc_cafe_posts')
    .select('id, cafe_id, title, views, comments, views_first, comments_first, first_metric_at, last_seen, is_popular')
    .eq('verdict', 'pending')
    .not('first_metric_at', 'is', null)
    .lte('first_metric_at', dueBefore)
    .order('first_metric_at', { ascending: true })
    .limit(MAX_PER_RUN)

  if (error) {
    // 테이블/컬럼 미생성(마이그레이션 전) — 조용히 no-op(다른 기능에 영향 주지 않는다)
    return { ...empty, ok: true, tableMissing: true, error: error.message.slice(0, 160) }
  }
  const rows = (data ?? []) as Row[]
  if (!rows.length) return empty

  // ── 1) 규칙 판정 → 애매한 것만 AI 에 넘김 ──
  const ruleCls = rows.map((r) => classifyByRules(r.title))
  const unknownIdx = ruleCls.map((c, i) => (c.cls === 'unknown' ? i : -1)).filter((i) => i >= 0)

  let aiAds = new Set<number>()
  const apiKey = process.env.ANTHROPIC_API_KEY || ''
  if (apiKey && unknownIdx.length) {
    try {
      const { claude } = await getNaverSettings()
      const found = await classifyAdsByAI(unknownIdx.map((i) => rows[i].title), apiKey, claude.model)
      aiAds = new Set([...found].map((k) => unknownIdx[k]))
    } catch { /* AI 실패해도 규칙 판정으로 계속 */ }
  }

  // ── 2) 24시간 증가폭 ──
  const deltas = rows.map((r) =>
    computeDelta({
      views: r.views,
      comments: r.comments,
      viewsFirst: r.views_first,
      commentsFirst: r.comments_first,
      spanMs: r.last_seen && r.first_metric_at ? Date.parse(r.last_seen) - Date.parse(r.first_metric_at) : 0,
    }),
  )

  // ── 3) 카페별 기준선 — 최근 21일 평가 이력 + 이번 배치로 60분위 ──
  const cafeIds = [...new Set(rows.map((r) => r.cafe_id))]
  const since = new Date(nowMs - 21 * 86400_000).toISOString()
  const thresholds = new Map<string, { th: number; basis: string }>()
  for (const cid of cafeIds) {
    const { data: hist } = await supabaseAdmin
      .from('nc_cafe_posts')
      .select('score')
      .eq('cafe_id', cid)
      .in('verdict', ['keep', 'drop'])
      .not('score', 'is', null)
      .gte('evaluated_at', since)
      .limit(300)
    const pool = [
      ...((hist ?? []) as { score: number }[]).map((h) => Number(h.score)),
      ...rows.map((r, i) => (r.cafe_id === cid && deltas[i].measurable ? deltas[i].score : NaN)),
    ].filter((n) => Number.isFinite(n))
    thresholds.set(cid, cafeThreshold(pool))
  }

  // ── 4) 판정 + 저장 ──
  const nowISO = new Date().toISOString()
  const out: EvalSummary = { ...empty }
  const bump = (v: Verdict) => {
    if (v === 'keep' || v === 'drop' || v === 'ad' || v === 'noise' || v === 'unrated') out[v] += 1
  }
  const updates: { id: string; patch: Record<string, unknown> }[] = []

  rows.forEach((r, i) => {
    const d = deltas[i]
    const { th, basis } = thresholds.get(r.cafe_id) ?? { th: 0, basis: '' }
    const { verdict, reason, isAd } = decideVerdict({
      ruleCls: ruleCls[i].cls,
      aiSaysAd: aiAds.has(i),
      isPopular: r.is_popular === true,
      measurable: d.measurable,
      dv: d.dv,
      dc: d.dc,
      score: d.score,
      threshold: th,
      basis,
    })
    bump(verdict)
    updates.push({
      id: r.id,
      patch: {
        verdict,
        verdict_reason: reason.slice(0, 300),
        is_ad: isAd,
        views_delta: d.measurable ? d.dv : null,
        comments_delta: d.measurable ? d.dc : null,
        score: d.measurable ? d.score : null,
        evaluated_at: nowISO,
      },
    })
  })

  // 개별 update(행마다 값이 달라 upsert 로 묶을 수 없다) — 10개씩 병렬로 나눠 부하·시간 제어.
  for (let i = 0; i < updates.length; i += 10) {
    await Promise.allSettled(
      updates.slice(i, i + 10).map((u) => supabaseAdmin.from('nc_cafe_posts').update(u.patch).eq('id', u.id)),
    )
  }
  out.evaluated = updates.length
  return out
}
