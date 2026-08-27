/* Anthropic 호출 규약을 한 곳에서 정의한다.

   왜 필요했나(2026-08-12 전수 점검에서 확인)
     · 엔드포인트(ANTHROPIC_BASE)를 33개 라우트가 각자 선언하고 있었다.
     · 모델명을 26개 라우트가 각자 하드코딩했고 실제로 4종이 섞여 있었다
       — claude-sonnet-4-6 / claude-opus-4-5-20251101 / claude-opus-4-6 / claude-3-opus-latest(구형 별칭).
     · 일부 파일만 환경변수 재정의를 지원해 규칙이 두 갈래였다.
     → 모델을 교체하려면 수십 파일을 뒤져야 하고, 하나만 놓쳐도 조용히 다른 모델이 돌아간다.

   원칙
     · 라우트는 '용도(티어)'만 고른다. 실제 모델명은 여기서만 바꾼다.
     · 모든 티어가 환경변수로 재정의된다 — 배포 후 코드 수정 없이 교체할 수 있다.
     · 기존 각 라우트가 쓰던 모델은 그대로 유지했다(이번 정리로 동작이 바뀌지 않게). */

export const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'

const pick = (...keys: string[]): string => {
  for (const k of keys) {
    const v = process.env[k]
    if (v && v.trim()) return v.trim()
  }
  return ''
}

export const MODELS = {
  /** 기본 생성·분석 — 대부분의 라우트(원고·요약·분류 등) */
  standard: pick('ANTHROPIC_MODEL_STANDARD', 'ANTHROPIC_MODEL') || 'claude-sonnet-4-6',
  /** 무거운 추론 — 이미지 이해·리뷰·긴 기획 생성 */
  heavy: pick('ANTHROPIC_MODEL_HEAVY', 'ANTHROPIC_MODEL') || 'claude-opus-4-5-20251101',
  /** 영상 프레임 해석 */
  video: pick('ANTHROPIC_VIDEO_MODEL', 'ANTHROPIC_MODEL') || 'claude-opus-4-6',
  /** 이미지 보드 분류 */
  image: pick('ANTHROPIC_IMAGE_MODEL', 'ANTHROPIC_MODEL') || 'claude-opus-4-6',
} as const

/** 모든 Anthropic 호출이 같은 헤더를 쓰도록 — 버전 헤더 누락/오타 방지. */
export function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
  }
}
