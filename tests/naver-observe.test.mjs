/* 네이버 카페 '관찰·판정' 순수 로직 회귀 테스트.
   실행: npm test   (node --experimental-strip-types 로 .ts 를 그대로 불러온다)

   왜 이 파일이 있나: 이 로직들은 조용히 틀리면 아무도 모른다.
     · 광고를 잘못 잡으면 → 멀쩡한 회원 글이 소재에서 빠진다(오탐이 미탐보다 나쁘다)
     · 증가폭 계산이 틀리면 → 전부 '측정 불가'가 되거나 점수가 폭등한다(실제로 났던 버그)
     · 병합이 틀리면 → 기준선이 매번 덮여 24시간 반응을 영영 못 잰다(실제로 났던 버그)
   그래서 실제 소스를 그대로 불러 검증한다(복사본 아님). */

import {
  classifyByRules, computeDelta, cafeThreshold, decideVerdict, mergeObservedRow,
  resolveClubId, cafeArticleUrl, MIN_SCORE_FLOOR, COMMENT_WEIGHT,
} from '../lib/naver/observe-rules.ts'
import { isValidUrl } from '../lib/validate/url.ts'

let pass = 0, fail = 0
const t = (name, cond, extra = '') => {
  if (cond) pass++
  else { fail++; console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`) }
}
const section = (s) => console.log(`\n=== ${s} ===`)

// ─────────────────────────────────────────────
section('① 광고여야 하는 제목 (놓치면 안 됨)')
for (const a of [
  '상세페이지 제작 전문업체입니다 카톡문의 주세요',
  '공동구매 진행합니다 선착순 20명',
  '중고 포스기 팝니다',
  '체험단 모집합니다 무료로 드려요',
  '블로그 주소 남겨요 http://example.com',
  '문의는 010-1234-5678 로 주세요',
  '초특가 이벤트 진행중이에요',
  '리뷰어 모집 / 제휴 문의 받습니다',
  '입금 계좌 안내드립니다',
  '직원 구인합니다',
  '마케팅 대행 저렴하게 해드립니다 상담가능',
]) t(`광고 판정: "${a}"`, classifyByRules(a).cls === 'ad', `→ ${classifyByRules(a).cls}`)

section('② 절대 광고면 안 되는 일반 회원 글 (오탐 = 가장 치명적)')
for (const l of [
  '상세페이지 업체 추천부탁드립니다ㅠ',
  '다들 마케팅 어디서 하세요?',
  '외주 견적서 보다가 현타 왔어요..',
  '요즘 매출 어떠신가요 저만 힘든가요',
  '정산하다가 현타 왔어요..',
  '주말에 정리하다 그냥 올려요',
  '새벽에 잠 못 자다가 결국 해버렸어요ㅋㅋ',
  '통화하다가 생각났는데 이거 어떡하죠ㅋㅋ',
  '상세페이지 직접 만들어보신 분 계신가요',
  '광고비 얼마나 쓰세요 다들',
  '요가 몇 년 다녔는데 요즘 늘고 있는 건지 모르겠어요?',
  '가격 얼마나 하나요 궁금해서요',
]) t(`일반글 유지: "${l}"`, classifyByRules(l).cls === 'unknown', `→ ${classifyByRules(l).cls}`)

section('③ 잡글(공지·등업·출석) 판정')
for (const n of ['공지 카페 운영 규칙 안내', '[공지] 필독해주세요', '등업 신청합니다', '출석체크 합니다', '가입인사 드립니다', '안내드립니다 정기 모임', '필독 공지사항입니다'])
  t(`잡글 판정: "${n}"`, classifyByRules(n).cls === 'noise', `→ ${classifyByRules(n).cls}`)

// ─────────────────────────────────────────────
section('④ 증가폭 계산 (기준선 null 폭등 버그 회귀)')
const DAY = 24 * 3600e3
{
  const d = computeDelta({ views: 500, comments: null, viewsFirst: null, commentsFirst: null, spanMs: DAY })
  t('기준선 없음 → 측정 불가(폭등 방지)', d.measurable === false && d.score === 0, JSON.stringify(d))
}
{
  const d = computeDelta({ views: 500, comments: 3, viewsFirst: 100, commentsFirst: 1, spanMs: DAY })
  t('정상 증가폭', d.measurable && d.dv === 400 && d.dc === 2 && d.score === 400 + 2 * COMMENT_WEIGHT, JSON.stringify(d))
}
{
  const d = computeDelta({ views: 90, comments: null, viewsFirst: 100, commentsFirst: null, spanMs: DAY })
  t('조회수 감소해도 음수 금지', d.dv === 0 && d.score === 0, JSON.stringify(d))
}
{
  const d = computeDelta({ views: 200, comments: 5, viewsFirst: 100, commentsFirst: 1, spanMs: 3 * 3600e3 })
  t('관측 간격 6h 미만 → 측정 불가', d.measurable === false, JSON.stringify(d))
}
{
  const d = computeDelta({ views: null, comments: 4, viewsFirst: null, commentsFirst: 1, spanMs: DAY })
  t('댓글만 있어도 측정 가능', d.measurable && d.dv === 0 && d.dc === 3 && d.score === 90, JSON.stringify(d))
}
{
  const d = computeDelta({ views: 0, comments: 0, viewsFirst: 0, commentsFirst: 0, spanMs: DAY })
  t('0 값도 유효한 측정(결측 아님)', d.measurable === true && d.score === 0, JSON.stringify(d))
}

section('⑤ 카페 기준선(임계값)')
t('표본 부족 → 절대 하한', cafeThreshold([10, 20]).th === MIN_SCORE_FLOOR)
t('표본 충분 → 60분위(하한 이상)', (() => { const r = cafeThreshold([0, 10, 20, 30, 40, 100, 500]); return r.th >= MIN_SCORE_FLOOR && r.th <= 500 })())
t('전부 0(죽은 카페) → 하한 유지', cafeThreshold([0, 0, 0, 0, 0, 0]).th === MIN_SCORE_FLOOR)

section('⑥ 최종 판정 매트릭스')
const base = { ruleCls: 'unknown', aiSaysAd: false, isPopular: false, measurable: true, dv: 0, dc: 0, score: 0, threshold: 30, basis: 'x' }
t('광고는 인기글·고득점이어도 ad', (() => { const v = decideVerdict({ ...base, ruleCls: 'ad', isPopular: true, score: 9999 }); return v.verdict === 'ad' && v.isAd === true })())
t('AI 광고 판정 우선', decideVerdict({ ...base, aiSaysAd: true, score: 9999 }).verdict === 'ad')
t('잡글은 점수 무관 noise', decideVerdict({ ...base, ruleCls: 'noise', score: 9999 }).verdict === 'noise')
t('측정 불가 + 인기글 → keep', decideVerdict({ ...base, measurable: false, isPopular: true }).verdict === 'keep')
t('측정 불가 + 일반 → unrated', decideVerdict({ ...base, measurable: false }).verdict === 'unrated')
t('임계 이상 → keep', decideVerdict({ ...base, dv: 500, score: 500 }).verdict === 'keep')
t('임계 미만 → drop', decideVerdict({ ...base, dv: 5, score: 5 }).verdict === 'drop')
t('임계 동일 → keep(경계 포함)', decideVerdict({ ...base, score: 30, threshold: 30 }).verdict === 'keep')
t('인기글은 점수 낮아도 keep', decideVerdict({ ...base, isPopular: true, score: 0, threshold: 9999 }).verdict === 'keep')

// ─────────────────────────────────────────────
section('⑦ 수집 병합 — 하루 2회 방문 시나리오')
const T0 = '2026-08-05T09:00:00.000Z', T1 = '2026-08-05T20:00:00.000Z', T2 = '2026-08-06T07:00:00.000Z'
{
  const v1 = mergeObservedRow(undefined, { article_id: '111', views: 100, comments: 1, is_popular: false }, T0)
  t('1회차: 기준선 = 첫 관측값', v1.views_first === 100 && v1.comments_first === 1 && v1.first_metric_at === T0)
  t('1회차: 신규는 pending', v1.verdict === 'pending')
  const v2 = mergeObservedRow({ ...v1 }, { article_id: '111', views: 340, comments: 5, is_popular: false }, T1)
  t('2회차: 기준선 유지(덮어쓰기 금지)', v2.views_first === 100 && v2.first_metric_at === T0)
  t('2회차: 최신값 갱신', v2.views === 340 && v2.comments === 5)
  const v3 = mergeObservedRow({ ...v2 }, { article_id: '111', views: 520, comments: 9, is_popular: true }, T2)
  t('3회차: 인기글 승격 + 기준선 유지', v3.is_popular === true && v3.views_first === 100)
  const d = computeDelta({ views: v3.views, comments: v3.comments, viewsFirst: v3.views_first, commentsFirst: v3.comments_first, spanMs: Date.parse(T2) - Date.parse(T0) })
  t('평가: 증가폭 정확', d.measurable && d.dv === 420 && d.dc === 8, JSON.stringify(d))
}
{
  const v1 = mergeObservedRow(undefined, { article_id: '1', views: 200, comments: 3, is_popular: false }, T0)
  const v2 = mergeObservedRow({ ...v1 }, { article_id: '1', views: null, comments: null, is_popular: false }, T1)
  t('파싱 실패(null)가 지난 값을 지우지 않음', v2.views === 200 && v2.comments === 3 && v2.views_first === 200)
}
{
  const v1 = mergeObservedRow(undefined, { article_id: '1', views: 10, comments: 0, is_popular: true }, T0)
  const v2 = mergeObservedRow({ ...v1 }, { article_id: '1', views: 20, comments: 0, is_popular: false }, T1)
  t('인기글 표시는 내려가지 않음', v2.is_popular === true)
}
{
  const legacy = { article_id: '9', views: 700, comments: 4, views_first: null, comments_first: null, first_metric_at: null, is_popular: false, verdict: 'unrated' }
  const v = mergeObservedRow(legacy, { article_id: '9', views: 720, comments: 5, is_popular: false }, T0)
  t('옛 글: 기준선 생성 + 평가 대기 복귀', v.views_first === 720 && v.first_metric_at === T0 && v.verdict === 'pending')
}
for (const done of ['keep', 'drop', 'ad', 'noise']) {
  const prev = { article_id: '1', views: 100, comments: 2, views_first: 10, comments_first: 0, first_metric_at: T0, is_popular: false, verdict: done }
  t(`판정 '${done}' 유지(재판정 루프 방지)`, mergeObservedRow(prev, { article_id: '1', views: 130, comments: 3, is_popular: false }, T2).verdict === done)
}
{
  const prevU = { article_id: '1', views: 100, comments: null, views_first: 100, comments_first: null, first_metric_at: T0, is_popular: false, verdict: 'unrated' }
  t('기준선 있는 unrated 는 그대로', mergeObservedRow(prevU, { article_id: '1', views: 100, comments: null, is_popular: false }, T2).verdict === 'unrated')
}

// ─────────────────────────────────────────────
section('⑧ 카페 원문 주소 조립')
t('f-e URL에서 클럽ID', resolveClubId('https://cafe.naver.com/f-e/cafes/30790560/menus/37') === '30790560')
t('ca-fe URL', resolveClubId('https://cafe.naver.com/ca-fe/cafes/12345/articles/9') === '12345')
t('구형 URL → null', resolveClubId('https://cafe.naver.com/somecafe') === null)
t('club_id 우선', resolveClubId('https://cafe.naver.com/f-e/cafes/111/menus/1', '999') === '999')
t('원문 주소 조립', cafeArticleUrl('30790560', '12345') === 'https://cafe.naver.com/f-e/cafes/30790560/articles/12345')
t('글번호 없으면 null', cafeArticleUrl('30790560', null) === null)
t('클럽ID 없으면 null', cafeArticleUrl(null, '12345') === null)

section('⑨ URL 검증 (위험 스킴 차단)')
for (const [v, exp] of [
  ['https://example.com', true], ['http://a.co.kr/path?x=1', true], ['  https://ok.com  ', true],
  ['javascript:alert(1)', false], ['data:text/html,<script>', false], ['file:///etc/passwd', false],
  ['ftp://x.com', false], ['', false], ['not a url', false], ['https://', false],
]) t(`isValidUrl(${JSON.stringify(v)})`, isValidUrl(v) === exp, `→ ${isValidUrl(v)}`)

console.log(`\n────────────\n결과: ${pass} 통과 / ${fail} 실패`)
process.exit(fail ? 1 : 0)
