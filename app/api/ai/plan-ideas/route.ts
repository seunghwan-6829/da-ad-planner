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
      ? `\n\n## 이 브랜드의 기존 대본들 (참고용 - 톤, 스타일, 표현 방식을 학습해서 반영)\n${existingScripts
          .map((s, i) => `--- 대본 ${i + 1} ---\n${s}`)
          .join('\n\n')}\n\n위 기존 대본들의 톤, 말투, 표현 스타일을 분석해서 새 대본에 자연스럽게 반영해주세요.`
      : ''

  const systemPrompt = `광고 대본 작성 전문가. "${clientName}" 브랜드의 새로운 광고 대본을 작성한다.
${existingContext}

## 규칙
- 광고 영상(릴스/숏폼)에 바로 쓸 수 있는 자연스러운 대본 작성
- 시청자의 관심을 끄는 도입부, 제품/서비스 소개, 행동 유도(CTA) 포함
- 기존 대본이 있으면 그 톤과 스타일을 참고하되, 내용은 새롭게
- 기존 대본이 없으면 일반적인 릴스/숏폼 광고 톤으로 작성
- 대본만 출력. 부가 설명, 제목, 라벨 없이 순수 대본 텍스트만.`

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
