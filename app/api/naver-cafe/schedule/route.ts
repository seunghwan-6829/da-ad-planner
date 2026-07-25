import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { lastPublishAtMs, nextEligibleAt, bumpToActiveHours } from '@/lib/naver/pacing'

export const dynamic = 'force-dynamic'

// 발행 대기(승인) 글들이 '대략 언제' 올라갈지 예상 시각을 계산해서 준다.
//   GET → { now, estimates: { [postId]: { at, note } } }
// ⚠️ 발행 게이트(agent/next)와 같은 기준(업로드 주기 interval_days + 마지막 발행 published_at +
//    활동 시간대)을 쓴다. 그래서 화면에 뜨는 예상 시각이 실제 발행 순간과 맞물린다.
//    전역 동작 간격(25~90분)은 발행처 간 몇 분 차이라 일(day) 단위 예상에선 무시(오차 미미).

export async function GET() {
  const DAY = 86400_000
  const nowMs = Date.now()
  const { pacing } = await getNaverSettings()

  const { data: posts } = await supabaseAdmin
    .from('nc_posts')
    .select('id, cafe_id, created_at, not_before, force_publish, nc_cafes(interval_days)')
    .in('status', ['approved', 'queued'])
    .order('created_at', { ascending: true })
    .limit(200)

  // 발행처별 마지막 발행 시각(한 번씩만 조회).
  const lastByCafe = new Map<string, number | null>()
  for (const cid of [...new Set((posts || []).map((p) => (p as { cafe_id: string }).cafe_id))]) {
    lastByCafe.set(cid, await lastPublishAtMs(cid))
  }

  // 발행처별로 오래된 순서대로 j번째면 기준시각 + j*주기 (게이트가 한 발행처당 주기마다 하나씩 내보내므로).
  const seq = new Map<string, number>()
  const estimates: Record<string, { at: string; note: string }> = {}
  for (const p of posts || []) {
    const row = p as { id: string; cafe_id: string; not_before?: string | null; force_publish?: boolean; nc_cafes?: { interval_days?: number } }
    if (row.force_publish === true) {
      estimates[row.id] = { at: new Date(nowMs).toISOString(), note: '지금 바로 발행 지정 — 곧 올라가요' }
      continue
    }
    const interval = Math.max(1, Number(row.nc_cafes?.interval_days) || 3)
    const last = lastByCafe.get(row.cafe_id) ?? null
    const j = seq.get(row.cafe_id) || 0
    seq.set(row.cafe_id, j + 1)

    let est = nextEligibleAt(last, interval, pacing, nowMs) + j * interval * DAY
    est = bumpToActiveHours(est, pacing)
    const nb = row.not_before ? Date.parse(row.not_before) : NaN
    if (!Number.isNaN(nb) && nb > est) est = bumpToActiveHours(nb, pacing)

    const note = last === null && j === 0 ? '주기 도래 — 곧 올라가요' : `업로드 주기 ${interval}일 기준`
    estimates[row.id] = { at: new Date(est).toISOString(), note }
  }

  return NextResponse.json({ now: new Date(nowMs).toISOString(), estimates })
}
