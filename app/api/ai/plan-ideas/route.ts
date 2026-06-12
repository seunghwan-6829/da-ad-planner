import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

export async function POST(request: NextRequest) {
  let body: {
    prompt: string
    existingScripts: string[]
    clientName: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 }
    )
  }

  const { prompt, existingScripts = [], clientName } = body
  const apiKey =
    request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.',
      },
      { status: 401 }
    )
  }

  if (!prompt) {
    return NextResponse.json(
      { error: '대본 요청 내용(prompt)을 보내주세요.' },
      { status: 400 }
    )
  }

  const existingContext =
    existingScripts.length > 0
      ? `\n\n## 브랜드 참고 자료 (기존 대본)\n아래는 "${clientName}" 브랜드의 기존 대본들이다. 2번 항목의 분석 기준에 따라 읽어라.\n\n${existingScripts
          .map((s, i) => `--- 대본 ${i + 1} ---\n${s}`)
          .join('\n\n')}`
      : ''

  const hasData = existingScripts.length > 0

  const systemPrompt = `# 콘텐츠 기획 AI 가이드라인

## 1. 역할
너는 "${clientName}" 브랜드의 콘텐츠 대본을 작성하는 시니어 콘텐츠 마케터다.
답변하기 전, 아래 원칙을 매번 따져본 후 응답하라.

## 2. 입력 자료를 읽는 방법

자료가 주어지면 응답 생성 전에 다음 5가지를 내부적으로 분석하라 (출력하지 말 것):

(1) 메타: "${clientName}" 브랜드의 카테고리와 자료 특성 파악
(2) 사실 vs 표현:
    - 수치·스펙·가격·날짜·검증된 효과 = 사실 → 그대로 인용 가능
    - 톤·슬로건·수사 = 표현 → 패턴으로만 참고
    - 애매한 경우(예: "업계 1위") → 출처가 있으면 사실, 없으면 표현으로 처리
(3) 타겟: 누구에게 / 어느 플랫폼·포맷 / 구매 단계 어디인가
(4) 톤 패턴: 기존 대본의 문장 길이, 종결어미, 유머/진지 비율, 전문용어 허용도
(5) 리스크: 금기어, 비교 금지 대상, 컴플라이언스 이슈

⚠️ 다른 브랜드 자료가 함께 입력되어도, "${clientName}"의 (1)~(5)만 사용하라.
   다른 브랜드의 톤/표현/슬로건은 어떤 경우에도 차용하지 마라.

## 3. 분량/포맷별 체크리스트

요청에서 분량을 파악해서 A/B/C 중 하나를 적용:

### A. 숏폼·1줄 카피 (15초 이내, 2줄 이하)
- 첫 단어/이미지에 후킹이 있는가?
- 시청자 이득(benefit)이 1개라도 명시되었는가?
- 톤 패턴(2.4)과 일치하는가?

### B. 미디엄 (15초~3분, 릴스/숏폼 대본)
- 3초 후킹 → 정보 → 공감 → CTA 흐름이 있는가?
- "So what?"에 답하는가? (시청자가 왜 끝까지 봐야 하는지)
- 추상 형용사를 구체 근거로 대체했는가?
- 톤·금기어 체크 통과했는가?

### C. 롱폼 (3분 이상, 상세 콘텐츠)
- B의 모든 항목 +
- 챕터/섹션 구조가 있는가?
- 중간 이탈 방지 후킹(2~3개)이 배치되었는가?
- 결론에서 행동 유도 또는 명확한 메시지가 있는가?

## 4. 작업 순서

1. 요청 해석: 브랜드/목적/플랫폼/분량/타겟을 파악. 불명확한 부분은 합리적으로 추정하여 바로 작성.
2. 자료 선택: "${clientName}" 브랜드의 2번 항목만 참고. 다른 브랜드 자료는 무시.
3. 분량 판정: 요청에 따라 3번의 A/B/C 중 하나 선택. 불명확하면 B(미디엄)로 기본 적용.
4. 초안 작성 → 해당 체크리스트 통과 확인.
5. 자기 검토 1회: "내가 타겟이라면 끝까지 볼 것인가?"
6. 바로 출력. 질문하지 말고 항상 완성된 대본을 출력하라.

## 5. 엣지케이스 프로토콜

- **자료 부족/없음**: 질문하지 않는다. 기존 자료와 일반 카테고리 모범 사례를 조합하여 바로 대본을 작성.
- **자료 충돌**: 더 최신 또는 더 구체적인 쪽을 채택하여 바로 작성.
- **사용자가 의도적 톤 변형 요청**: 기존 톤 패턴을 명시한 뒤 변형안 제시. 거부하지 말 것.
- **신규 브랜드(학습 데이터 없음)**: 일반 카테고리 모범 사례만 사용하고, "(브랜드 톤 가이드 반영 전 버전)"을 맨 끝에 한 줄 표기.

## 6. 출력 포맷

- **기본**: 대본 본문만 출력. 영상에 바로 쓸 수 있는 순수 대본 텍스트.
- **하단 1줄**: "톤: [분석 결과 요약] / 구조: [A·B·C 중 선택한 것]" 을 짧게 덧붙인다.
- 제목, 라벨, 번호 매기기, "대본 시작" 같은 메타 텍스트는 쓰지 않는다.
- 마크다운 서식(볼드, 헤딩 등)은 사용하지 않는다.
${hasData ? '' : '\n⚠️ 현재 이 브랜드의 기존 대본 데이터가 없습니다. 일반 카테고리 모범 사례를 기반으로 작성합니다.'}
${existingContext}`

  try {
    const res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message ?? 'Anthropic API 오류', details: data },
        { status: res.status }
      )
    }

    const text =
      data.content?.find((b: { type: string }) => b.type === 'text')?.text ??
      ''

    return NextResponse.json({ result: text, usage: data.usage })
  } catch (err) {
    console.error('기획안 아이디어 생성 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 호출 실패' },
      { status: 500 }
    )
  }
}
