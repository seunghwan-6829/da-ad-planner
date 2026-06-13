import { NextRequest, NextResponse } from 'next/server'

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations'

// 이미지 생성은 시간이 걸리므로 함수 타임아웃을 늘린다 (Vercel Pro 권장)
export const maxDuration = 60

export async function POST(request: NextRequest) {
  let body: { prompt: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
  }

  const { prompt } = body
  const apiKey = request.headers.get('x-user-openai-key') || process.env.OPENAI_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'OpenAI API 키가 없습니다. 마이페이지에서 입력해주세요.' },
      { status: 401 }
    )
  }
  if (!prompt) {
    return NextResponse.json({ error: '이미지 프롬프트(prompt)를 보내주세요.' }, { status: 400 })
  }

  try {
    const res = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1536',
        quality: 'medium',
        n: 1,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message ?? 'OpenAI 이미지 생성 오류', details: data },
        { status: res.status }
      )
    }

    const b64 = data.data?.[0]?.b64_json
    if (!b64) {
      return NextResponse.json({ error: '이미지 데이터를 받지 못했습니다.' }, { status: 500 })
    }

    return NextResponse.json({ b64 })
  } catch (err) {
    console.error('촬영 가이드 이미지 생성 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 호출 실패' },
      { status: 500 }
    )
  }
}
