import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { image } = body as { image: string }

  if (!image) {
    return NextResponse.json({ error: '이미지가 필요합니다' }, { status: 400 })
  }

  // base64 데이터 추출
  let base64Data = image
  let mediaType = 'image/jpeg'
  
  if (image.startsWith('data:')) {
    const match = image.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      mediaType = match[1]
      base64Data = match[2]
    }
  }

  const prompt = `이 광고 이미지를 상세하게 분석해주세요. 다음 항목을 포함해서 분석해주세요:

[텍스트 분석]
- 메인 카피(헤드라인)
- 서브 카피(부제/설명)
- CTA(Call to Action) 문구
- 기타 텍스트

[디자인 분석]
- 전체 컬러 톤/분위기
- 레이아웃 구조
- 타이포그래피 스타일
- 시각적 강조 요소

[이미지/사진 분석]
- 사용된 이미지/사진의 종류 (제품샷, 인물, 배경 등)
- 이미지가 전달하는 메시지
- 타겟 고객층 예상

[광고 특성]
- 광고 카테고리 (뷰티/건강/식품/교육/금융 등)
- 주요 소구점
- 광고의 강점과 개선 가능 포인트

마크다운 형식으로 깔끔하게 정리해주세요.`

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
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      console.error('Image Analyze API Error:', err)
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const analysis = data.content?.[0]?.text || ''
    
    return NextResponse.json({ analysis })
  } catch (error) {
    console.error('Image analyze error:', error)
    return NextResponse.json({ error: '이미지 분석 실패' }, { status: 500 })
  }
}
