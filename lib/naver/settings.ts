import { supabaseAdmin } from '@/lib/supabase-admin'

// 네이버 카페 자동화 — 페이스(계정 밴 방지) 설정 + Claude 모델 설정.
// nc_settings 싱글턴(id=1) 한 행에 저장. 값이 없으면 아래 기본값으로 폴백.

export interface NaverPacing {
  active_hours: [number, number]   // [lo, hi) 로컬(KST) 활동 시간대. [9,23] = 09:00~22:59
  daily_post_limit: number         // 하루 글 상한
  daily_comment_limit: number      // 하루 댓글 상한
  per_cafe_post_weekly: number     // 발행처(카페 보드)별 롤링 7일 글 상한
  min_action_gap_min: number       // 동작 간 최소 간격(분)
  max_action_gap_min: number       // 동작 간 최대 간격(분) — [min,max] 랜덤
  comment_delay_min: number        // 원글 발견 → 댓글까지 최소 지연(분)
  comment_delay_max: number        // 최대 지연(분)
}

export interface NaverClaude {
  model: string
  max_tokens: number
}

export interface NaverSettings {
  pacing: NaverPacing
  claude: NaverClaude
}

// 리뉴얼 원본 settings.yaml 라이브 기본값과 동일.
export const DEFAULT_PACING: NaverPacing = {
  active_hours: [9, 23],
  daily_post_limit: 2,
  daily_comment_limit: 8,
  per_cafe_post_weekly: 2,
  min_action_gap_min: 25,
  max_action_gap_min: 90,
  comment_delay_min: 30,
  comment_delay_max: 240,
}

export const DEFAULT_CLAUDE: NaverClaude = { model: 'claude-sonnet-4-6', max_tokens: 2000 }

// active_hours 는 jsonb 에서 배열로 들어오지만 방어적으로 정규화.
function normalizePacing(raw: Partial<NaverPacing> | null | undefined): NaverPacing {
  const p = { ...DEFAULT_PACING, ...(raw || {}) }
  const ah = Array.isArray(p.active_hours) ? p.active_hours : DEFAULT_PACING.active_hours
  const lo = Number(ah[0]); const hi = Number(ah[1])
  p.active_hours = [Number.isFinite(lo) ? lo : 9, Number.isFinite(hi) ? hi : 23]
  // 숫자 컬럼 방어
  for (const k of ['daily_post_limit', 'daily_comment_limit', 'per_cafe_post_weekly', 'min_action_gap_min', 'max_action_gap_min', 'comment_delay_min', 'comment_delay_max'] as const) {
    const v = Number((p as Record<string, unknown>)[k])
    ;(p as Record<string, unknown>)[k] = Number.isFinite(v) ? v : DEFAULT_PACING[k]
  }
  // 간격 min<=max 보정(한쪽만 저장돼 역전되는 것 방지)
  if (p.min_action_gap_min > p.max_action_gap_min) [p.min_action_gap_min, p.max_action_gap_min] = [p.max_action_gap_min, p.min_action_gap_min]
  if (p.comment_delay_min > p.comment_delay_max) [p.comment_delay_min, p.comment_delay_max] = [p.comment_delay_max, p.comment_delay_min]
  return p
}

export async function getNaverSettings(): Promise<NaverSettings> {
  try {
    const { data } = await supabaseAdmin.from('nc_settings').select('pacing, claude').eq('id', 1).single()
    return {
      pacing: normalizePacing(data?.pacing),
      claude: { ...DEFAULT_CLAUDE, ...(data?.claude || {}) },
    }
  } catch {
    return { pacing: DEFAULT_PACING, claude: DEFAULT_CLAUDE }
  }
}

// 페이스 일부만 수정(나머지는 유지). claude 컬럼은 건드리지 않음.
export async function saveNaverPacing(patch: Partial<NaverPacing>): Promise<NaverPacing> {
  const cur = await getNaverSettings()
  const merged = normalizePacing({ ...cur.pacing, ...patch })
  await supabaseAdmin.from('nc_settings').upsert({ id: 1, pacing: merged, updated_at: new Date().toISOString() })
  return merged
}
