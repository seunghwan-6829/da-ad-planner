import { NextResponse } from 'next/server'
import { getNaverSettings, saveNaverPacing, saveNaverOptions, type NaverPacing, type NaverOptions } from '@/lib/naver/settings'
import { pacingStatus } from '@/lib/naver/pacing'

export const dynamic = 'force-dynamic'

/* 페이스(계정 밴 방지) 설정 + 운영 정책 + 현재 상태.
     GET   → { pacing, options, status }
     PATCH → pacing 키 또는 options 키를 부분 수정 후 { pacing, options }

   ⚠️ 2026-08-12 점검에서 확인: 예전에는 이 라우트가 pacing 만 다뤄서
      운영 정책 4종(연속 실패 중단 임계값·자동 발행 자격·중복 창·발행 전 확인)이
      화면 어디서도 바꿀 수 없었다(saveNaverOptions 는 호출부가 없는 죽은 코드였다).
      정책이 코드에만 존재하고 운영자가 볼 수도 바꿀 수도 없는 상태였다. */

export async function GET() {
  const { pacing, options } = await getNaverSettings()
  const status = await pacingStatus(pacing)
  return NextResponse.json({ pacing, options, status })
}

const PACING_NUM_KEYS: (keyof NaverPacing)[] = [
  'daily_post_limit',
  'daily_comment_limit',
  'per_cafe_post_weekly',
  'min_action_gap_min',
  'max_action_gap_min',
  'comment_delay_min',
  'comment_delay_max',
]

const OPTION_NUM_KEYS: (keyof NaverOptions)[] = [
  'halt_after_failures',
  'dup_window_days',
  'dup_similarity',
  'autopilot_min_published',
]

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))

  // ── 페이스 ──
  const patch: Partial<NaverPacing> = {}
  if (Array.isArray(b.active_hours) && b.active_hours.length === 2) {
    const lo = Number(b.active_hours[0]); const hi = Number(b.active_hours[1])
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 24 && lo < hi) patch.active_hours = [lo, hi]
  }
  for (const k of PACING_NUM_KEYS) {
    if (b[k] !== undefined) {
      const v = Number(b[k])
      if (Number.isFinite(v) && v >= 0) (patch as Record<string, number>)[k] = Math.round(v)
    }
  }
  // 간격 min<=max 보정
  if (patch.min_action_gap_min !== undefined && patch.max_action_gap_min !== undefined && patch.min_action_gap_min > patch.max_action_gap_min) {
    ;[patch.min_action_gap_min, patch.max_action_gap_min] = [patch.max_action_gap_min, patch.min_action_gap_min]
  }

  // ── 운영 정책 ──
  const optPatch: Partial<NaverOptions> = {}
  if (typeof b.preview_before_publish === 'boolean') optPatch.preview_before_publish = b.preview_before_publish
  for (const k of OPTION_NUM_KEYS) {
    if (b[k] !== undefined) {
      const v = Number(b[k])
      // dup_similarity 만 소수(0~1), 나머지는 정수. 최종 범위 보정은 normalizeOptions 가 한다.
      if (Number.isFinite(v) && v >= 0) (optPatch as Record<string, number>)[k] = k === 'dup_similarity' ? v : Math.round(v)
    }
  }

  if (!Object.keys(patch).length && !Object.keys(optPatch).length) {
    return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  }

  const pacing = Object.keys(patch).length ? await saveNaverPacing(patch) : (await getNaverSettings()).pacing
  const options = Object.keys(optPatch).length ? await saveNaverOptions(optPatch) : (await getNaverSettings()).options
  return NextResponse.json({ ok: true, pacing, options })
}
