import { supabaseAdmin } from '@/lib/supabase-admin'
import type { NaverPacing } from './settings'

// ─────────────────────────────────────────────────────────────
// 발행 페이스 제어 — 탐지 회피의 본질(리뉴얼 pacing.py 충실 포팅).
// 사람처럼: 활동 시간대, 일일/주간 상한, 랜덤(비균일) 간격, 댓글 지연.
// 탐지 트리거는 '빈도/리듬'. 그래서 이 게이트가 서버(발행 배정) 앞단에 반드시 걸린다.
//
// 타임존: 활동시간대/일 경계는 한국(KST=UTC+9, DST 없음) 로컬 기준. 서버는 UTC 로 도니
//         'now + 9h' 를 만들어 getUTC* 로 KST 벽시계 값을 읽는다.
// 카운트 원천: nc_activity(발행 성공마다 1행). status 가 아니라 이 표를 센다.
// ─────────────────────────────────────────────────────────────

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const NEXT_KEY = 'next_action_at'

function kstParts(nowMs: number) {
  const d = new Date(nowMs + KST_OFFSET_MS)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate(), hour: d.getUTCHours() }
}

/* 활동 시간대 제한.
   [0, 24] 이면 "제한 없음"으로 본다 — 24시간 언제든 발행. 화면의 시간 제한 토글이 이 값을 쓴다.
   (새벽 테스트나 즉시 발행이 필요할 때 이 게이트가 걸리면 답답하기만 하고,
    계정 보호는 발행 간격·일일 상한·카페별 주간 상한이 더 크게 맡는다) */
export function inActiveHours(pacing: NaverPacing, nowMs: number = Date.now()): boolean {
  const [lo, hi] = pacing.active_hours
  if (lo <= 0 && hi >= 24) return true // 제한 없음
  const { hour } = kstParts(nowMs)
  return lo <= hour && hour < hi
}

// KST 오늘 00:00 에 해당하는 실제 UTC 순간(ISO).
function startOfKstDayUtcISO(nowMs: number = Date.now()): string {
  const { y, m, day } = kstParts(nowMs)
  const utc = Date.UTC(y, m, day) - KST_OFFSET_MS
  return new Date(utc).toISOString()
}

async function countToday(kind: string, nowMs: number = Date.now()): Promise<number> {
  const since = startOfKstDayUtcISO(nowMs)
  const { count } = await supabaseAdmin
    .from('nc_activity')
    .select('id', { count: 'exact', head: true })
    .eq('kind', kind)
    .gte('at', since)
  return count || 0
}

export async function getMeta(key: string): Promise<string | null> {
  const { data } = await supabaseAdmin.from('nc_meta').select('value').eq('key', key).maybeSingle()
  return data?.value ?? null
}

export async function setMeta(key: string, value: string): Promise<void> {
  await supabaseAdmin.from('nc_meta').upsert({ key, value, updated_at: new Date().toISOString() })
}

// 지금 이 동작을 해도 되는지. (가능여부, 사유).
export async function canAct(
  kind: 'post' | 'comment',
  cafeId: string,
  pacing: NaverPacing,
  nowMs: number = Date.now(),
): Promise<{ ok: boolean; reason: string }> {
  if (!inActiveHours(pacing, nowMs)) return { ok: false, reason: '활동 시간대 아님' }

  /* 개수 상한(하루 글/댓글·카페 주간 글)은 쓰지 않는다 — 발행처별 운영 주기가 물량을 관리하므로 중복.
     계정 보호는 '활동 시간대'와 아래 '동작 간 랜덤 간격'이 맡는다(간격 자체가 사실상 속도 상한). */

  // 동작 간 랜덤 간격: 직전 동작 후 예약된 next_action_at 전이면 대기.
  const nxt = await getMeta(NEXT_KEY)
  if (nxt) {
    const nxtMs = Date.parse(nxt)
    if (!Number.isNaN(nxtMs) && nowMs < nxtMs) {
      const mins = Math.round((nxtMs - nowMs) / 60000)
      return { ok: false, reason: `다음 동작까지 약 ${mins}분 대기(랜덤 간격)` }
    }
  }
  return { ok: true, reason: 'ok' }
}

// 동작 직후 호출. 다음 동작 허용 시각을 [min,max]분 사이 랜덤으로 예약(고정 주기 X).
export async function scheduleNext(pacing: NaverPacing, nowMs: number = Date.now()): Promise<string> {
  const gap = pacing.min_action_gap_min + Math.random() * (pacing.max_action_gap_min - pacing.min_action_gap_min)
  const nxt = new Date(nowMs + gap * 60000).toISOString()
  await setMeta(NEXT_KEY, nxt)
  return nxt
}

// 발행 성공 1건 기록(페이스 카운트 원천).
export async function logActivity(kind: string, cafeId: string | null): Promise<void> {
  await supabaseAdmin.from('nc_activity').insert({ kind, cafe_id: cafeId, at: new Date().toISOString() })
}

// 원글 발견 시각 기준 댓글 발행 가능 시각(랜덤 지연) ISO. items.not_before 에 저장.
export function commentNotBefore(pacing: NaverPacing, seenAtMs: number = Date.now()): string {
  const delay = pacing.comment_delay_min + Math.random() * (pacing.comment_delay_max - pacing.comment_delay_min)
  return new Date(seenAtMs + delay * 60000).toISOString()
}

// UI 페이스 상태 카드용 요약.
export async function pacingStatus(pacing: NaverPacing, nowMs: number = Date.now()) {
  const [postToday, commentToday] = await Promise.all([countToday('post', nowMs), countToday('comment', nowMs)])
  const nxt = await getMeta(NEXT_KEY)
  const nxtMs = nxt ? Date.parse(nxt) : NaN
  const waitMin = !Number.isNaN(nxtMs) && nowMs < nxtMs ? Math.round((nxtMs - nowMs) / 60000) : 0
  return {
    active: inActiveHours(pacing, nowMs),
    active_hours: pacing.active_hours,
    post_today: postToday,
    daily_post_limit: pacing.daily_post_limit,
    comment_today: commentToday,
    daily_comment_limit: pacing.daily_comment_limit,
    next_action_at: nxt,
    wait_min: waitMin,
  }
}
