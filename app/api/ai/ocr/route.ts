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

  const prompt = `이 광고 이미지에서 보이는 모든 텍스트(카피)를 추출해주세요.

규칙:
1. 이미지에 보이는 텍스트를 정확하게 그대로 추출
2. 메인 카피, 서브 카피, CTA 등을 구분해서 줄바꿈으로 표시
3. 브랜드명이나 제품명도 포함
4. 작은 글씨(법적 고지 등)는 제외해도 됨
5. 텍스트만 출력하고 다른 설명은 하지 마세요

텍스트가 없으면 "텍스트 없음"이라고만 답하세요.`

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
      console.error('OCR API Error:', err)
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    
    return NextResponse.json({ text })
  } catch (error) {
    console.error('OCR error:', error)
    return NextResponse.json({ error: '텍스트 추출 실패' }, { status: 500 })
  }
}
