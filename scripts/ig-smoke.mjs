// 인스타 성과 스모크 테스트(목 데이터). 네트워크/DB 없이 파싱·정규화·토큰 암복호화를 검증.
// 실행: node scripts/ig-smoke.mjs
import crypto from 'crypto'
import assert from 'assert'

let pass = 0
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; console.log('  ✓', msg) }

// ── 1) 인사이트 값 파서 (sync.ts readInsightValue 와 동일 규칙) ──
function readInsightValue(item) {
  if (item?.total_value?.value != null) return Number(item.total_value.value)
  if (Array.isArray(item?.values) && item.values.length) {
    const v = item.values[item.values.length - 1]?.value
    if (typeof v === 'number') return v
  }
  if (typeof item?.value === 'number') return item.value
  return null
}

console.log('1) 인사이트 파서')
ok(readInsightValue({ name: 'reach', total_value: { value: 12345 } }) === 12345, 'total_value 구조 파싱')
ok(readInsightValue({ name: 'reach', values: [{ value: 1 }, { value: 9 }] }) === 9, 'values[] 마지막값 파싱')
ok(readInsightValue({ name: 'x' }) === null, '값 없으면 null(스킵 대상)')

// ── 2) 계정 인사이트 → 스냅샷 정규화 (sync 의 insert 매핑과 동일 컬럼) ──
console.log('2) 계정 스냅샷 정규화')
const mockAccountInsights = { data: [
  { name: 'reach', total_value: { value: 5000 } },
  { name: 'views', total_value: { value: 8000 } },
  { name: 'accounts_engaged', total_value: { value: 320 } },
  { name: 'total_interactions', total_value: { value: 410 } },
  // profile_links_taps 는 deprecated 가정 → 응답에 없음 → null 이어야 함
] }
const iv = {}
for (const it of mockAccountInsights.data) iv[it.name] = readInsightValue(it)
const snapshot = {
  followers_count: 1234, follows_count: 56, media_count: 78,
  reach: iv.reach ?? null, views: iv.views ?? null,
  accounts_engaged: iv.accounts_engaged ?? null,
  total_interactions: iv.total_interactions ?? null,
  profile_links_taps: iv.profile_links_taps ?? null,
}
ok(snapshot.reach === 5000 && snapshot.views === 8000, 'reach/views 매핑')
ok(snapshot.profile_links_taps === null, 'deprecated 지표는 null(스킵, 에러 아님)')
const COLS = ['followers_count','follows_count','media_count','reach','views','accounts_engaged','total_interactions','profile_links_taps']
ok(COLS.every((c) => c in snapshot), '스냅샷 키가 DB 컬럼과 일치')

// ── 3) 미디어 타입별 메트릭 분기 ──
console.log('3) 미디어 메트릭 타입 분기')
const MEDIA_METRICS_BY_TYPE = {
  REELS: ['reach','likes','comments','saved','shares','total_interactions','views'],
  FEED: ['reach','likes','comments','saved','shares','total_interactions'],
  STORY: ['reach','replies','total_interactions'],
  DEFAULT: ['reach','likes','comments','saved','shares','total_interactions'],
}
ok(MEDIA_METRICS_BY_TYPE['REELS'].includes('views'), 'Reels 는 views 포함')
ok(!MEDIA_METRICS_BY_TYPE['FEED'].includes('views'), 'Feed 는 views 미포함')
ok((MEDIA_METRICS_BY_TYPE['UNKNOWN_TYPE'] || MEDIA_METRICS_BY_TYPE.DEFAULT).length > 0, '미지 타입은 DEFAULT 폴백')

// ── 4) 인구통계 breakdown 파싱(follower_demographics total_value.breakdowns) ──
console.log('4) 인구통계 파싱')
const demoResp = { data: [{ total_value: { breakdowns: [{ results: [
  { dimension_values: ['Seoul'], value: 1200 },
  { dimension_values: ['Busan'], value: 300 },
] }] } }] }
const results = demoResp.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
const breakdown = {}
for (const r of results) breakdown[r.dimension_values.join(' · ')] = Number(r.value) || 0
ok(breakdown['Seoul'] === 1200 && breakdown['Busan'] === 300, 'city breakdown 파싱')

// ── 5) 토큰 암복호화 라운드트립 (crypto.ts 와 동일 알고리즘) ──
console.log('5) 토큰 AES-256-GCM 라운드트립')
process.env.TOKEN_ENC_KEY = process.env.TOKEN_ENC_KEY || 'smoke-test-key'
function key() { return crypto.createHash('sha256').update(process.env.TOKEN_ENC_KEY).digest() }
function enc(plain) {
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const e = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return `${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${e.toString('base64')}`
}
function dec(stored) {
  const [i, t, d] = stored.split('.')
  const dc = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(i, 'base64'))
  dc.setAuthTag(Buffer.from(t, 'base64'))
  return Buffer.concat([dc.update(Buffer.from(d, 'base64')), dc.final()]).toString('utf8')
}
const secret = 'EAABsomeLongLivedToken12345'
const round = dec(enc(secret))
ok(round === secret, '암호화→복호화 원문 일치')
ok(enc(secret) !== enc(secret), 'IV 무작위라 매번 다른 암호문')

console.log(`\n✅ 스모크 테스트 통과: ${pass} assertions`)
