import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // 이미지 생성은 느림(Vercel Pro 권장, Hobby 는 60 제한)

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations'

// POST { prompt, ratio?, sanitize? } → gpt-image-2 로 1장 생성(클라이언트가 여러 번 호출해 N장).
// 계정에 gpt-image-2 권한이 없으면 gpt-image-1 으로 자동 폴백.
// 사용자 본인 OpenAI 키(x-user-openai-key). NSFW(콘텐츠 정책)로 막히면 { nsfw:true } 반환 → 프론트가 '순화 후 재생성' 유도.
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-openai-key') || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: '마이페이지에서 OpenAI API 키를 입력해야 이미지를 만들 수 있어요.' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const prompt: string = (body.prompt || '').toString()
  const ratio: string = (body.ratio || '9:16').toString()
  const sanitize = !!body.sanitize
  if (!prompt.trim()) return NextResponse.json({ error: '프롬프트가 비어 있어요.' }, { status: 400 })

  // 프리뷰 비율에 맞춰 생성
  const size = ratio === '1:1' ? '1024x1024' : ratio === '16:9' ? '1536x1024' : '1024x1536'

  // 자막/텍스트는 무시하고 생성. 순화 요청 시 선정적 요소 제거.
  let finalPrompt = sanitize
    ? `아래 장면을 "건전하고 비선정적으로 순화"하여 묘사해줘. 노출/속옷/수영복/선정적 포즈/과도한 피부 노출은 제거하고, 제품·상황·분위기·표정 중심으로 표현.\n[장면] ${prompt}`
    : prompt
  finalPrompt += ' — 화면 안에 어떤 글자/자막/워터마크도 넣지 말 것. 사실적인 광고 레퍼런스 이미지 스타일.'

  const genOnce = async (model: string) => {
    const res = await fetch(OPENAI_IMAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, prompt: finalPrompt, size, quality: 'medium', n: 1 }),
    })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  try {
    let { res, data } = await genOnce('gpt-image-2')
    // 계정에 gpt-image-2 권한이 없거나 모델 미인식이면 gpt-image-1 로 폴백
    if (!res.ok) {
      const code: string = data.error?.code ?? ''
      const msg: string = data.error?.message ?? ''
      const modelIssue = res.status === 404 || /model/i.test(code) || /model[^.]*(not found|does not exist|unsupported|do not have access|not available)/i.test(msg)
      if (modelIssue) ({ res, data } = await genOnce('gpt-image-1'))
    }
    if (!res.ok) {
      const msg: string = data.error?.message ?? 'OpenAI 이미지 생성 오류'
      const code: string = data.error?.code ?? ''
      const isSafety = code === 'moderation_blocked' || /safety system|safety_violations|content policy|moderation/i.test(msg)
      if (isSafety) return NextResponse.json({ nsfw: true }, { status: 200 })
      return NextResponse.json({ error: msg }, { status: res.status })
    }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) return NextResponse.json({ error: '이미지 데이터를 받지 못했어요.' }, { status: 500 })
    return NextResponse.json({ b64 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'API 호출 실패' }, { status: 500 })
  }
}
