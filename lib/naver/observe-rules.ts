/* 카페 관찰 글 판정의 '순수 규칙' — DB·AI 의존이 전혀 없어 그대로 단위 테스트할 수 있다.
   (observe-eval.ts 가 이 규칙을 가져다 DB 조회·AI 판별과 엮는다) */

export type Verdict = 'pending' | 'keep' | 'drop' | 'ad' | 'noise' | 'unrated'
export type RuleClass = 'ad' | 'noise' | 'unknown'

/* ── 수집·평가 타이밍 상수(한 곳에서만 정의) ──
   수집 라우트·평가 엔진·현황 페이지가 모두 이 값을 import 한다.
   각자 상수를 들고 있으면 한쪽만 바뀌었을 때 화면의 '다음 수집 예정'이 실제와 어긋난다. */
export const OBSERVE_GAP_MS = 11 * 60 * 60 * 1000     // 카페당 수집 간격(하루 2회)
export const OBSERVE_GLOBAL_GAP_MS = 25 * 60 * 1000   // 카페 간 최소 간격(연속 방문 방지)
export const EVAL_AFTER_MS = 24 * 60 * 60 * 1000      // 첫 관측 후 이만큼 지나야 평가

// 댓글 1개는 조회 30 정도의 가치(카페 글은 댓글이 진짜 반응) — 점수 = 조회증가 + 댓글증가*30
export const COMMENT_WEIGHT = 30
// 표본이 적을 때 쓰는 절대 하한 — 이만큼도 안 움직였으면 반응 없음으로 본다.
export const MIN_SCORE_FLOOR = 30
// 관측 간격이 이보다 짧으면(=재방문 때 목록에서 사라짐) 증가폭을 신뢰하지 않는다.
export const MIN_MEASURE_SPAN_MS = 6 * 60 * 60 * 1000

/* ⚠️ 한글 뒤에는 정규식 \b(단어 경계)가 동작하지 않는다(\b 는 ASCII \w 기준).
   그래서 한글 패턴에는 \b 를 쓰지 않고, 대신 '동사형까지 포함'해 정밀도를 높였다.

   STRONG: 하나만 걸려도 광고 확정(AI 를 거치지 않으므로 '거의 확실한 것'만 넣는다)
   WEAK  : 일반 회원 글에도 흔한 말 — 2개 이상 겹칠 때만 광고
   NOISE : 광고는 아니지만 소재 가치가 없는 잡글(공지·등업·출석 등) */
export const STRONG_AD: RegExp[] = [
  /카톡\s*(?:아이디|주세요|문의|상담)|카카오톡\s*(?:아이디|문의|상담)|오픈\s*채팅|오픈톡|톡\s*아이디/,
  /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/,               // 휴대폰 번호
  /https?:\/\/|www\.|\.co\.kr|\.com(?:$|[/\s])|블로그\s*주소|링크\s*(?:참고|첨부|남)/,
  /공동\s*구매|공구\s*(?:합니다|진행|오픈|참여)|판매\s*(?:합니다|중이|해요)|팝니다|처분\s*합니다/,
  /최저가|초특가|할인\s*(?:코드|쿠폰|이벤트)|무료\s*체험\s*신청/,
  /체험단\s*모집|서포터즈\s*모집|기자단\s*모집|리뷰어\s*모집|협찬\s*(?:문의|가능)|제휴\s*문의/,
  /광고\s*(?:합니다|문의)|홍보\s*(?:합니다|글|해요)|입금\s*계좌|계좌\s*번호|선착순\s*\d+\s*명/,
  /구인\s*(?:합니다|공고|중)|채용\s*공고|알바\s*(?:구합|모집)/,
]
/* 특히 "업체 추천 부탁드려요"(묻는 글)는 우리가 원하는 자연스러운 글이라 절대 걸리면 안 되므로,
   '추천드립니다/소개합니다'(주는 쪽)만 넣고 '추천 부탁/문의드려요'(받는 쪽)는 아예 넣지 않았다. */
export const WEAK_AD: RegExp[] = [
  /할인|특가|이벤트|증정|사은품|쿠폰/,
  /상담\s*(?:가능|받|해)|견적\s*(?:문의|가능)|무료\s*상담/,
  /신청\s*(?:하세요|받|가능)|모집|접수\s*중/,
  /추천\s*드립니다|추천\s*해\s*드립|소개\s*(?:합니다|해\s*드립)|알려\s*드립니다/,
  /후기\s*이벤트|리뷰\s*(?:이벤트|작성\s*시)/,
  /저렴|가성비\s*갑|믿고\s*맡기/,
  /업체\s*(?:입니다|소개)|전문\s*(?:업체|기업)\s*입니다/,
  /구인|알바|무료\s*배송/,
]
export const NOISE: RegExp[] = [
  /^\[?(?:공지|필독|안내|이벤트)\]?/,
  /등업\s*(?:신청|부탁|해\s*주세요|요청)/,
  /^출석|출석\s*체크|오늘의\s*출석/,
  /가입\s*인사|첫\s*인사|신입\s*입니다|자기\s*소개/,
  /정모\s*공지|번개\s*모임/,
]

const hit = (list: RegExp[], t: string) => list.reduce((n, re) => n + (re.test(t) ? 1 : 0), 0)

/** 규칙만으로 내리는 1차 판정(무료·즉시). unknown 은 AI 가 다시 본다. */
export function classifyByRules(title: string): { cls: RuleClass; reason: string } {
  const t = String(title || '')
  for (const re of NOISE) if (re.test(t)) return { cls: 'noise', reason: '공지·등업·출석 등 잡글(규칙)' }
  for (const re of STRONG_AD) if (re.test(t)) return { cls: 'ad', reason: '광고·상업글 확정 신호(연락처·판매·모집 등)' }
  const weak = hit(WEAK_AD, t)
  if (weak >= 2) return { cls: 'ad', reason: `상업적 표현 ${weak}개 중복(할인·상담·모집류)` }
  return { cls: 'unknown', reason: '' }
}

/* ── 수집 병합 규칙 ──
   같은 글을 하루 2번씩 다시 보므로, 새로 읽은 값과 기존 값을 어떻게 합치느냐가 이 기능의 핵심이다.
   그냥 덮어쓰면 ① 기준선이 매번 갱신돼 증가폭을 영영 못 재고, ② 이번에 못 읽은 지표가 지난 값을 지우고,
   ③ 어제 인기글이던 글이 오늘 목록에 없다고 인기글 표시가 사라진다. */
export interface ObservedPrev {
  article_id: string | null
  views: number | null
  comments: number | null
  views_first: number | null
  comments_first: number | null
  first_metric_at: string | null
  is_popular: boolean | null
  verdict: string | null
}
export interface ObservedIncoming {
  article_id: string | null
  views: number | null
  comments: number | null
  is_popular: boolean
}
export interface ObservedMerged {
  article_id: string | null
  views: number | null
  comments: number | null
  views_first: number | null
  comments_first: number | null
  first_metric_at: string
  is_popular: boolean
  verdict: string
}

export function mergeObservedRow(prev: ObservedPrev | undefined, next: ObservedIncoming, nowISO: string): ObservedMerged {
  /* 이번에 기준선이 '처음' 박히는 행(= 측정 시작 전에 수집됐던 옛 글)은 평가 대기열로 되돌린다.
     안 그러면 기준선이 생겼는데도 verdict='unrated' 에 갇혀 영영 평가되지 않는다.
     이미 판정이 끝난 글(keep/drop/ad/noise)은 절대 건드리지 않는다 — 재판정 루프 방지. */
  const firstBaselineNow = !prev?.first_metric_at
  const verdict = !prev
    ? 'pending'
    : firstBaselineNow && (prev.verdict === 'unrated' || !prev.verdict)
      ? 'pending'
      : (prev.verdict ?? 'pending')

  return {
    article_id: next.article_id ?? prev?.article_id ?? null,
    // 최신값 — 이번에 못 읽었으면(null) 지난 값을 유지(0 은 유효한 값이라 유지된다)
    views: next.views ?? prev?.views ?? null,
    comments: next.comments ?? prev?.comments ?? null,
    // 첫 관측치 — 한 번 박히면 절대 안 바뀐다(24h 증가폭의 기준선)
    views_first: prev?.views_first ?? next.views ?? null,
    comments_first: prev?.comments_first ?? next.comments ?? null,
    first_metric_at: prev?.first_metric_at ?? nowISO,
    // 인기글은 한 번이라도 잡히면 유지(오늘 목록에 없다고 내리지 않는다)
    is_popular: prev?.is_popular === true || next.is_popular,
    verdict,
  }
}

/** 24시간 증가폭 계산 — 기준선과 최신값이 '둘 다' 있는 지표로만 잰다(없으면 0). */
export function computeDelta(input: {
  views: number | null
  comments: number | null
  viewsFirst: number | null
  commentsFirst: number | null
  spanMs: number
}): { measurable: boolean; dv: number; dc: number; score: number } {
  const hasViewPair = input.views !== null && input.viewsFirst !== null
  const hasCommentPair = input.comments !== null && input.commentsFirst !== null
  const measurable = (hasViewPair || hasCommentPair) && input.spanMs >= MIN_MEASURE_SPAN_MS
  if (!measurable) return { measurable: false, dv: 0, dc: 0, score: 0 }
  const dv = hasViewPair ? Math.max(0, (input.views as number) - (input.viewsFirst as number)) : 0
  const dc = hasCommentPair ? Math.max(0, (input.comments as number) - (input.commentsFirst as number)) : 0
  return { measurable: true, dv, dc, score: dv + dc * COMMENT_WEIGHT }
}

/** 백분위(0~1). 정렬된 배열 기준. */
export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx]
}

/** 카페 기준선 — 표본 5개 이상이면 그 카페 평소 수준(60분위), 아니면 절대 하한. */
export function cafeThreshold(scores: number[]): { th: number; basis: string } {
  const pool = [...scores].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (pool.length >= 5) {
    const p60 = percentile(pool, 0.6)
    return { th: Math.max(MIN_SCORE_FLOOR, p60), basis: `카페 평소 수준 60분위(${p60}) 기준` }
  }
  return { th: MIN_SCORE_FLOOR, basis: `표본 부족 → 기본 하한(${MIN_SCORE_FLOOR}) 기준` }
}

/** 최종 판정 — 광고/잡글이 점수보다 우선한다. */
export function decideVerdict(input: {
  ruleCls: RuleClass
  aiSaysAd: boolean
  isPopular: boolean
  measurable: boolean
  dv: number
  dc: number
  score: number
  threshold: number
  basis: string
}): { verdict: Verdict; reason: string; isAd: boolean } {
  if (input.ruleCls === 'ad') return { verdict: 'ad', reason: '광고·상업글 확정 신호(연락처·판매·모집 등)', isAd: true }
  if (input.aiSaysAd) return { verdict: 'ad', reason: 'AI 판별: 광고·상업 홍보 글', isAd: true }
  if (input.ruleCls === 'noise') return { verdict: 'noise', reason: '공지·등업·출석 등 잡글(규칙)', isAd: false }

  if (!input.measurable) {
    // 지표를 못 읽었거나 재측정 전 목록에서 사라짐 → 점수를 신뢰할 수 없다.
    // 단, 카페 '인기글'로 잡혔던 글은 카페가 인정한 글이라 소재로 살린다.
    if (input.isPopular) return { verdict: 'keep', reason: '카페 인기글 등재(지표는 측정 못 함)', isAd: false }
    return { verdict: 'unrated', reason: '조회·댓글을 읽지 못했거나 재측정 전 목록에서 사라짐', isAd: false }
  }
  if (input.isPopular) return { verdict: 'keep', reason: `카페 인기글 등재 · 24h 조회 +${input.dv} 댓글 +${input.dc}`, isAd: false }
  if (input.score >= input.threshold) {
    return { verdict: 'keep', reason: `24h 조회 +${input.dv} 댓글 +${input.dc} (점수 ${input.score} ≥ ${input.threshold}, ${input.basis})`, isAd: false }
  }
  return { verdict: 'drop', reason: `24h 반응 낮음 — 조회 +${input.dv} 댓글 +${input.dc} (점수 ${input.score} < ${input.threshold}, ${input.basis})`, isAd: false }
}
