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

  const systemPrompt = `영상 광고 스토리보드 전문가. 풀 대본을 ${sceneCount}개 씬으로 나누고 효과·특이사항을 짧게 제안.

## 규칙
1. 대본을 의미 단위로 ${sceneCount}개로 나눈다. 문장 중간에서 자르지 않는다.
2. "effect"는 핵심 효과만 짧게 쓴다 (예: "페이드인", "줌인 → 컷전환", "텍스트 오버레이"). 한 줄 이내.
3. "special_notes"는 핵심 연출 포인트만 짧게 쓴다 (예: "밝은 톤 유지", "제품 클로즈업 강조"). 한 줄 이내.
4. 반드시 정확히 ${sceneCount}개 씬.

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "scenes": [
    {
      "scene_number": 1,
      "script": "씬 대본",
      "effect": "짧은 효과 (한 줄)",
      "special_notes": "짧은 특이사항 (한 줄)"
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
