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

  const prompt = `이 광고 이미지를 분석해주세요.

다음 형식으로만 답변해주세요:

[카테고리]
(이미지의 광고 카테고리를 한 단어로: 뷰티/건강/식품/패션/가전/금융/교육/여행/자동차/대행/기타 중 하나)

[카피]
(이미지에서 보이는 모든 텍스트를 추출. 메인 카피, 서브 카피, CTA 등 줄바꿈으로 구분)

규칙:
- 텍스트가 없으면 [카피] 아래에 "텍스트 없음"
- 카테고리와 카피만 출력, 다른 설명 금지`

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
    const fullText = data.content?.[0]?.text || ''
    
    console.log('OCR Raw Response:', fullText)
    
    // 카테고리와 카피 분리
    let category = ''
    let text = ''
    
    // 유효한 카테고리 목록
    const validCategories = ['뷰티', '건강', '식품', '패션', '가전', '금융', '교육', '여행', '자동차', '대행', '기타']
    
    // 카테고리 추출 (여러 패턴 시도)
    const categoryMatch = fullText.match(/\[카테고리\]\s*\n?\s*([^\n\[]+)/) ||
                          fullText.match(/카테고리[:\s]*([^\n]+)/)
    if (categoryMatch) {
      const rawCategory = categoryMatch[1].trim()
      // 유효한 카테고리인지 확인
      const foundCategory = validCategories.find(c => rawCategory.includes(c))
      category = foundCategory || '기타'
    }
    
    // 카피 추출
    const copyMatch = fullText.match(/\[카피\]\s*\n?([\s\S]*)/) ||
                      fullText.match(/카피[:\s]*\n?([\s\S]*)/)
    if (copyMatch) {
      text = copyMatch[1].trim()
    } else {
      text = fullText
    }
    
    console.log('Parsed category:', category, 'text length:', text.length)
    
    return NextResponse.json({ text, category })
  } catch (error) {
    console.error('OCR error:', error)
    return NextResponse.json({ error: '텍스트 추출 실패' }, { status: 500 })
  }
}
