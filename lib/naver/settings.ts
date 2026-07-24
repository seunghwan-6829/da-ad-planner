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

/* 운영 옵션(v4) — 페이스와 별개로, 사고를 막는 안전장치들. */
export interface NaverOptions {
  preview_before_publish: boolean // 등록 직전 캡처를 사람이 확인해야 실제 등록
  halt_after_failures: number     // 연속 N회 실패하면 에이전트 자동 중단(0=끄기)
  dup_window_days: number         // 최근 N일 안의 발행글과 비교
  dup_similarity: number          // 제목 유사도 이 값 이상이면 중복으로 보고 보류(0~1)
}

export const DEFAULT_OPTIONS: NaverOptions = {
  /* 기본은 끔. 검수 대기에서 사람이 이미 승인한 글이라 등록 직전에 또 확인받는 건 과하다.
     대신 에이전트가 "입력이 온전한지"를 기계적으로 검수하고, 이상하면 등록하지 않고 실패로 보고한다.
     켜면 예전처럼 캡처를 올리고 사람 확인을 기다린다. */
  preview_before_publish: false,
  halt_after_failures: 2,
  dup_window_days: 30, // 같은 카페에 최근 30일(≈1달) 안엔 비슷한 글을 다시 안 낸다.
  dup_similarity: 0.6,
}

export interface NaverSettings {
  pacing: NaverPacing
  claude: NaverClaude
  options: NaverOptions
}

// 리뉴얼 원본 settings.yaml 라이브 기본값과 동일.
export const DEFAULT_PACING: NaverPacing = {
  // [0,24] = 시간 제한 없음(언제든 발행). 계정 보호는 아래 간격·상한 규칙이 맡는다.
  active_hours: [0, 24],
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

function normalizeOptions(raw: Partial<NaverOptions> | null | undefined): NaverOptions {
  const o = { ...DEFAULT_OPTIONS, ...(raw || {}) }
  // 기본이 false 이므로 "명시적으로 true 일 때만" 켠다.
  // (!== false 로 두면 저장된 값이 null/undefined 일 때 켜져 버려, 아무도 기다리지 않는 확인 대기에 빠진다)
  o.preview_before_publish = o.preview_before_publish === true
  for (const k of ['halt_after_failures', 'dup_window_days', 'dup_similarity'] as const) {
    const v = Number((o as Record<string, unknown>)[k])
    ;(o as Record<string, unknown>)[k] = Number.isFinite(v) ? v : DEFAULT_OPTIONS[k]
  }
  o.dup_similarity = Math.min(1, Math.max(0, o.dup_similarity))
  return o
}

export async function getNaverSettings(): Promise<NaverSettings> {
  try {
    // options 컬럼이 아직 없을 수 있어(마이그레이션 전) 실패하면 pacing/claude 만 읽는다.
    let data: { pacing?: unknown; claude?: unknown; options?: unknown } | null = null
    const withOpts = await supabaseAdmin.from('nc_settings').select('pacing, claude, options').eq('id', 1).single()
    if (withOpts.error) {
      const legacy = await supabaseAdmin.from('nc_settings').select('pacing, claude').eq('id', 1).single()
      data = legacy.data
    } else data = withOpts.data

    return {
      pacing: normalizePacing(data?.pacing as Partial<NaverPacing>),
      claude: { ...DEFAULT_CLAUDE, ...((data?.claude as object) || {}) },
      options: normalizeOptions(data?.options as Partial<NaverOptions>),
    }
  } catch {
    return { pacing: DEFAULT_PACING, claude: DEFAULT_CLAUDE, options: DEFAULT_OPTIONS }
  }
}

/** 운영 옵션 일부만 수정. */
export async function saveNaverOptions(patch: Partial<NaverOptions>): Promise<NaverOptions> {
  const cur = await getNaverSettings()
  const merged = normalizeOptions({ ...cur.options, ...patch })
  await supabaseAdmin.from('nc_settings').upsert({ id: 1, options: merged, updated_at: new Date().toISOString() })
  return merged
}

// 페이스 일부만 수정(나머지는 유지). claude 컬럼은 건드리지 않음.
export async function saveNaverPacing(patch: Partial<NaverPacing>): Promise<NaverPacing> {
  const cur = await getNaverSettings()
  const merged = normalizePacing({ ...cur.pacing, ...patch })
  await supabaseAdmin.from('nc_settings').upsert({ id: 1, pacing: merged, updated_at: new Date().toISOString() })
  return merged
}
