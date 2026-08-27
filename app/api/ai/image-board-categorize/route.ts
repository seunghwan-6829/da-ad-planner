import { NextRequest, NextResponse } from 'next/server'
import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

const MODEL = MODELS.image

const DEFAULT_CATEGORIES = ['의류', '식품', '부동산', '뷰티', '건강', '금융', '교육', '여행', '자동차', '가전', '기타']

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  const body = (await request.json()) as { image: string }
  if (!body.image) {
    return NextResponse.json({ error: '분류할 이미지가 없습니다.' }, { status: 400 })
  }

  let base64Data = body.image
  let mediaType = 'image/jpeg'

  if (body.image.startsWith('data:')) {
    const match = body.image.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      mediaType = match[1]
      base64Data = match[2]
    }
  }

  const prompt = `당신은 이미지 보드 관리자입니다.

이미지를 보고 아래 대분류 중 하나만 고르세요.
${DEFAULT_CATEGORIES.join(', ')}

규칙:
- 반드시 카테고리 이름 한 단어만 출력
- 가장 가까운 대분류를 선택
- 애매하면 기타`

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
        max_tokens: 50,
        messages: [
          {
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
          },
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? '이미지 분류에 실패했습니다.' }, { status: 500 })
    }

    const data = await res.json()
    const text = (data.content?.[0]?.text || '').trim()
    const category = DEFAULT_CATEGORIES.find((name) => text.includes(name)) || '기타'

    return NextResponse.json({ category })
  } catch (error) {
    console.error('Image board categorize error:', error)
    return NextResponse.json({ error: '이미지 분류 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
