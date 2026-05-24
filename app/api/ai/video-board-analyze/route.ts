import { NextRequest, NextResponse } from 'next/server'
import { buildAnthropicImages, buildFrameFacts, buildVideoFacts, VIDEO_MODEL } from '@/lib/video-ai'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  const body = await request.json()
  const frames = body.frames || []

  if (!frames.length) {
    return NextResponse.json({ error: '분석할 영상 프레임이 없습니다.' }, { status: 400 })
  }

  const prompt = [
    '당신은 광고 영상 라이브러리 메타데이터를 정리하는 시니어 전략가입니다.',
    '영상 프레임과 기본 정보를 보고 아래 형식으로 정확히 정리하세요.',
    '',
    buildVideoFacts(body),
    buildFrameFacts(body),
    '',
    '형식:',
    '[요약]',
    '두세 문장으로 어떤 영상인지 정리',
    '',
    '[타임코드 포인트]',
    '- 0:00-0:03 | 화면 / 액션 / 자막 추정',
    '- 0:03-0:06 | 화면 / 액션 / 자막 추정',
    '- 계속',
    '',
    '[대본/메시지 추정]',
    '- 핵심 카피, 내레이션, CTA 추정',
    '',
    '[화면 구성 포인트]',
    '- 구도, 제품 노출, 인물, 자막 스타일, 편집 리듬 정리',
    '',
    '규칙:',
    '- 실제 프레임에서 확인 가능한 정보 위주로',
    '- 억지 추정은 피하고, 추정이면 "추정"이라고 명시',
    '- 한국어로 작성',
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
        max_tokens: 1400,
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
      return NextResponse.json({ error: error.error?.message || '영상 분석에 실패했습니다.' }, { status: 500 })
    }

    const data = await response.json()
    const text = (data.content?.[0]?.text || '').trim()

    return NextResponse.json({
      analysis: text,
      model: VIDEO_MODEL,
    })
  } catch (error) {
    console.error('Video board analyze error:', error)
    return NextResponse.json({ error: '영상 분석 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
