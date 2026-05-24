import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' },
      { status: 500 }
    )
  }

  let body: { script: string; sceneCount: number }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 }
    )
  }

  const { script, sceneCount } = body
  if (!script || !sceneCount || sceneCount < 1) {
    return NextResponse.json(
      { error: '대본(script)과 씬 수(sceneCount)를 보내주세요.' },
      { status: 400 }
    )
  }

  const systemPrompt = `당신은 영상 광고 스토리보드 전문가입니다. 주어진 풀 대본을 ${sceneCount}개의 씬(장면)으로 나누고, 각 씬에 맞는 영상 효과와 특이사항을 제안해야 합니다.

## 규칙
1. 대본을 문맥과 의미 단위로 ${sceneCount}개로 나눕니다. 문장 중간에서 자르지 마세요.
2. 각 씬의 대본은 자연스러운 문단/문장 단위로 분할하세요.
3. 각 씬의 "effect"는 해당 대본에 어울리는 영상 효과를 구체적으로 작성합니다 (예: 페이드인, 줌인, 슬로모션, 컷 전환, 텍스트 오버레이 등).
4. 각 씬의 "special_notes"는 해당 장면의 연출 시 주의할 점이나 강조할 사항을 작성합니다.
5. 반드시 정확히 ${sceneCount}개의 씬을 생성하세요.

## 응답 형식
반드시 아래 JSON 형식으로만 응답하세요. JSON 외 다른 텍스트는 포함하지 마세요.

{
  "scenes": [
    {
      "scene_number": 1,
      "script": "이 씬의 대본 내용",
      "effect": "이 씬에 어울리는 영상 효과",
      "special_notes": "연출 시 특이사항/주의사항"
    }
  ]
}`

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
            content: `다음 풀 대본을 ${sceneCount}개의 씬으로 나누고, 각 씬에 맞는 효과와 특이사항을 작성해주세요.\n\n---\n${script}\n---`
          }
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

    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''

    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json(
        { error: 'AI 응답에서 JSON을 파싱할 수 없습니다.', raw: text },
        { status: 500 }
      )
    }

    const parsed = JSON.parse(jsonMatch[0])
    return NextResponse.json({ scenes: parsed.scenes, usage: data.usage })
  } catch (err) {
    console.error('AI 대본 분배 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 호출 실패' },
      { status: 500 }
    )
  }
}
