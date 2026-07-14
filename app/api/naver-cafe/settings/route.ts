import { NextResponse } from 'next/server'
import { getNaverSettings, saveNaverPacing, type NaverPacing } from '@/lib/naver/settings'
import { pacingStatus } from '@/lib/naver/pacing'

export const dynamic = 'force-dynamic'

// 페이스(계정 밴 방지) 설정 + 현재 상태.
//   GET   → { pacing, status }  (status = 오늘 발행량/다음 동작 대기 등 카드용)
//   PATCH { active_hours?, daily_post_limit?, ... } → 부분 수정 후 { pacing }

export async function GET() {
  const { pacing } = await getNaverSettings()
  const status = await pacingStatus(pacing)
  return NextResponse.json({ pacing, status })
}

const NUM_KEYS: (keyof NaverPacing)[] = [
  'daily_post_limit',
  'daily_comment_limit',
  'per_cafe_post_weekly',
  'min_action_gap_min',
  'max_action_gap_min',
  'comment_delay_min',
  'comment_delay_max',
]

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const patch: Partial<NaverPacing> = {}
  if (Array.isArray(b.active_hours) && b.active_hours.length === 2) {
    const lo = Number(b.active_hours[0]); const hi = Number(b.active_hours[1])
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 24 && lo < hi) patch.active_hours = [lo, hi]
  }
  for (const k of NUM_KEYS) {
    if (b[k] !== undefined) {
      const v = Number(b[k])
      if (Number.isFinite(v) && v >= 0) (patch as Record<string, number>)[k] = Math.round(v)
    }
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  // 간격 min<=max 보정
  if (patch.min_action_gap_min !== undefined && patch.max_action_gap_min !== undefined && patch.min_action_gap_min > patch.max_action_gap_min) {
    ;[patch.min_action_gap_min, patch.max_action_gap_min] = [patch.max_action_gap_min, patch.min_action_gap_min]
  }
  const pacing = await saveNaverPacing(patch)
  return NextResponse.json({ ok: true, pacing })
}
