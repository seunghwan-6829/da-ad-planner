import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120 // 이미지 편집도 느림(Vercel Pro 권장, Hobby 는 60 제한)

const OPENAI_EDIT_URL = 'https://api.openai.com/v1/images/edits'

// POST { image_url, prompt, ratio?, sanitize? } → 기존 이미지를 "수정 프롬프트"대로 편집(image-to-image).
// gpt-image-2(미권한 계정은 gpt-image-1) 의 images/edits 엔드포인트 사용. 생성(content-image)과는 다른 API.
// 사용자 본인 OpenAI 키(x-user-openai-key). NSFW 차단 시 { nsfw:true } 반환.
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-openai-key') || process.env.OPENAI_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: '마이페이지에서 OpenAI API 키를 입력해야 이미지를 편집할 수 있어요.' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const imageUrl: string = (body.image_url || '').toString()
  const prompt: string = (body.prompt || '').toString()
  const ratio: string = (body.ratio || '9:16').toString()
  const sanitize = !!body.sanitize
  if (!imageUrl) return NextResponse.json({ error: '편집할 이미지가 없어요.' }, { status: 400 })
  if (!prompt.trim()) return NextResponse.json({ error: '수정 프롬프트를 입력해 주세요.' }, { status: 400 })

  const size = ratio === '1:1' ? '1024x1024' : ratio === '16:9' ? '1536x1024' : '1024x1536'

  let editPrompt = sanitize
    ? `아래 수정 지시를 "건전하고 비선정적으로" 반영해줘. 노출/속옷/수영복/선정적 포즈/과도한 피부 노출은 제거.\n[수정] ${prompt}`
    : prompt
  // 편집 결과에도 글자/텍스트가 들어가지 않도록 강제
  editPrompt =
    `[필수·최우선] 결과 이미지 안에 어떤 글자·문자·숫자·자막·캡션·로고·워터마크도 절대 렌더링하지 말 것.\n` +
    editPrompt +
    `\n— 사실적인 광고 레퍼런스 이미지 스타일을 유지하면서 위 수정만 반영.`

  // 원본 이미지 가져오기
  let imgBlob: Blob
  try {
    const ir = await fetch(imageUrl)
    if (!ir.ok) throw new Error('load fail')
    const ab = await ir.arrayBuffer()
    const type = ir.headers.get('content-type') || 'image/png'
    imgBlob = new Blob([ab], { type })
  } catch {
    return NextResponse.json({ error: '원본 이미지를 불러오지 못했어요.' }, { status: 400 })
  }

  const editOnce = async (model: string) => {
    const fd = new FormData()
    fd.append('model', model)
    fd.append('prompt', editPrompt)
    fd.append('size', size)
    fd.append('n', '1')
    fd.append('quality', 'medium')
    fd.append('image', imgBlob, 'image.png')
    const res = await fetch(OPENAI_EDIT_URL, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: fd })
    const data = await res.json().catch(() => ({}))
    return { res, data }
  }

  try {
    let { res, data } = await editOnce('gpt-image-2')
    if (!res.ok) {
      const code: string = data.error?.code ?? ''
      const msg: string = data.error?.message ?? ''
      const modelIssue = res.status === 404 || /model/i.test(code) || /model[^.]*(not found|does not exist|unsupported|do not have access|not available)/i.test(msg)
      if (modelIssue) ({ res, data } = await editOnce('gpt-image-1'))
    }
    if (!res.ok) {
      const msg: string = data.error?.message ?? 'OpenAI 이미지 편집 오류'
      const code: string = data.error?.code ?? ''
      const isSafety = code === 'moderation_blocked' || /safety system|safety_violations|content policy|moderation/i.test(msg)
      if (isSafety) return NextResponse.json({ nsfw: true }, { status: 200 })
      return NextResponse.json({ error: msg }, { status: res.status })
    }
    const b64 = data.data?.[0]?.b64_json
    if (!b64) return NextResponse.json({ error: '편집 이미지를 받지 못했어요.' }, { status: 500 })
    return NextResponse.json({ b64 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'API 호출 실패' }, { status: 500 })
  }
}
