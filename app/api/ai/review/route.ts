import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { copy, advertiserName, mediaType } = body

  const prompt = `당신은 광고 카피 전문 리뷰어입니다.
아래 ${mediaType === 'image' ? '이미지' : '영상'} 광고 카피를 분석해주세요.
${advertiserName ? `광고주: ${advertiserName}` : ''}

카피: "${copy}"

다음 4가지를 각각 1-2문장으로 간결하게 작성하세요:
1. 좋은 점 (good): 이 카피의 강점
2. 아쉬운 점 (bad): 개선이 필요한 부분
3. 수정 제안 (suggestion): 구체적인 개선 방향
4. 수정본 (revised): 위 제안을 반영한 개선된 카피 (메인카피: 서브카피 형식)

JSON 형식으로만 응답하세요:
{"good":"...","bad":"...","suggestion":"...","revised":"..."}`

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
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    
    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return NextResponse.json(parsed)
    }
    
    return NextResponse.json({ 
      good: '분석 실패', 
      bad: '분석 실패', 
      suggestion: '분석 실패',
      revised: copy 
    })
  } catch (error) {
    console.error('Review error:', error)
    return NextResponse.json({ error: '검토 실패' }, { status: 500 })
  }
}
