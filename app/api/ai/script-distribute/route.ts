import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

export async function POST(request: NextRequest) {
  let body: { script: string; sceneCount: number; autoFill?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 }
    )
  }

  const { script, sceneCount, autoFill = true } = body
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.' },
      { status: 401 }
    )
  }
  if (!script || !sceneCount || sceneCount < 1) {
    return NextResponse.json(
      { error: '대본(script)과 씬 수(sceneCount)를 보내주세요.' },
      { status: 400 }
    )
  }

  const systemPrompt = autoFill
    ? `인스타 릴스/숏폼 광고 콘텐츠 전문 편집자. 풀 대본을 ${sceneCount}개 씬으로 나누고, 요즘 릴스 트렌드에 맞는 편집 효과와 연출 포인트를 제안한다.

## 규칙
1. 대본을 의미 단위로 ${sceneCount}개로 나눈다. 문장 중간에서 자르지 않는다.
2. "effect"는 릴스/숏폼에서 실제로 쓰이는 편집 기법을 짧게 쓴다. 한 줄 이내.
   좋은 예: "빠른 컷 전환", "자막 강조 팝업", "브이로그 핸드헬드", "속도감 있는 줌인", "리액션 컷 삽입"
   나쁜 예: "페이드인으로 시작, 화면 중앙에 텍스트 오버레이 강조 효과와 함께 배경 삽입" ← 이런 딱딱한 서술은 금지
3. "special_notes"는 촬영/연출 시 핵심 한마디만 쓴다. 한 줄 이내.
   좋은 예: "말투 자연스럽게, 친구한테 얘기하듯", "표정 리액션 크게", "제품 자연스럽게 노출", "밝고 경쾌한 톤"
   나쁜 예: "공감 유도 오프닝, 후킹 톤으로 시작" ← 이런 기획서 말투는 금지
4. 반드시 정확히 ${sceneCount}개 씬.

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "scenes": [
    {
      "scene_number": 1,
      "script": "씬 대본",
      "effect": "릴스 편집 효과 (한 줄)",
      "special_notes": "연출 포인트 (한 줄)"
    }
  ]
}`
    : `영상 광고 스토리보드 전문가. 풀 대본을 ${sceneCount}개 씬으로 나눈다.

## 규칙
1. 대본을 의미 단위로 ${sceneCount}개로 나눈다. 문장 중간에서 자르지 않는다.
2. 반드시 정확히 ${sceneCount}개 씬.
3. effect와 special_notes는 빈 문자열로 둔다.

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "scenes": [
    {
      "scene_number": 1,
      "script": "씬 대본",
      "effect": "",
      "special_notes": ""
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
