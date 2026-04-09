import { NextRequest, NextResponse } from 'next/server'
import { buildAnthropicImages, buildFrameFacts, buildVideoFacts, VIDEO_MODEL } from '@/lib/video-ai'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const DEFAULT_CATEGORIES = ['의류', '식품', '부동산', '뷰티', '건강', '금융', '교육', '여행', '자동차', '가전', '기타']

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = await request.json()
  const frames = body.frames || []

  if (!frames.length) {
    return NextResponse.json({ error: '분류할 영상 프레임이 없습니다.' }, { status: 400 })
  }

  const prompt = [
    '당신은 광고 소재 라이브러리 분류 담당자입니다.',
    '',
    '영상 프레임과 정보를 보고 아래 대분류 중 가장 가까운 하나만 고르세요.',
    DEFAULT_CATEGORIES.join(', '),
    '',
    buildVideoFacts(body),
    buildFrameFacts(body),
    '',
    '출력 규칙:',
    '- 카테고리 이름 한 단어만 출력',
    '- 애매하면 기타',
  ].join('\n')

  try {
    const response = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: VIDEO_MODEL,
        max_tokens: 60,
        messages: [
          {
            role: 'user',
            content: [
              ...buildAnthropicImages(frames),
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({}))
      return NextResponse.json({ error: error.error?.message || '영상 분류에 실패했습니다.' }, { status: 500 })
    }

    const data = await response.json()
    const text = (data.content?.[0]?.text || '').trim()
    const category = DEFAULT_CATEGORIES.find((name) => text.includes(name)) || '기타'

    return NextResponse.json({ category, model: VIDEO_MODEL })
  } catch (error) {
    console.error('Video board categorize error:', error)
    return NextResponse.json({ error: '영상 분류 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
