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

  // 사실성 + 안전 필터 오탐 방지 가드레일을 모든 프롬프트에 강제로 부착
  const SAFE_SUFFIX =
    ' — Photorealistic, candid photo with natural lighting and realistic skin texture; ' +
    'authentic UGC style, not an over-polished or artificial stock photo. ' +
    'If a person appears and no demographic is specified, depict a natural-looking Korean woman in her 20s. ' +
    'Professional, modest, fully-clothed commercial advertising reference. Strictly safe-for-work and tasteful. ' +
    'No nudity, no underwear, no swimwear, no cleavage, no suggestive or sexual posing, no skin exposure beyond face and hands.'
  const finalPrompt = `${prompt}${SAFE_SUFFIX}`

  try {
    const res = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-image-2',
        prompt: finalPrompt,
        size: '1024x1536',
        quality: 'medium',
        n: 1,
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      const msg: string = data.error?.message ?? 'OpenAI 이미지 생성 오류'
      const code: string = data.error?.code ?? ''
      const isSafety =
        code === 'moderation_blocked' ||
        /safety system|safety_violations|content policy|moderation/i.test(msg)
      return NextResponse.json(
        { error: msg, code: isSafety ? 'safety' : 'error', details: data },
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
