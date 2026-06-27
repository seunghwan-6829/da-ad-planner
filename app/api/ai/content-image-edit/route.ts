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
  // 재현 모드: 첨부 이미지(원본 프레임)의 구도/각도/포즈를 유지하며 광고 컷을 다시 그림(초기 생성·재생성용)
  const recreate = !!body.recreate
  // 참고 이미지(배경/스타일 레퍼런스) — 있으면 원본과 함께 여러 장 입력(편집 모드)
  const refUrls: string[] = Array.isArray(body.ref_urls) ? (body.ref_urls as string[]).filter(Boolean).slice(0, 4) : []
  if (!imageUrl) return NextResponse.json({ error: '편집할 이미지가 없어요.' }, { status: 400 })
  if (!prompt.trim()) return NextResponse.json({ error: '수정 프롬프트를 입력해 주세요.' }, { status: 400 })

  const size = ratio === '1:1' ? '1024x1024' : ratio === '16:9' ? '1536x1024' : '1024x1536'

  let editPrompt: string
  if (recreate) {
    // 원본 프레임을 레퍼런스로 "재현" — 구도·각도·포즈는 고정, 옷 재질/색만 살짝 변형, 글자 제거
    const sanLine = sanitize ? '\n- 노출/속옷/선정적 요소는 건전하게 순화.' : ''
    editPrompt =
`[재현 모드] 첨부된 "레퍼런스 이미지"를 광고용 이미지로 다시 그려라.
- 반드시 동일하게 유지: 구도·카메라 앵글·인물 포즈·시점·프레이밍·피사체의 위치와 크기.
- 살짝만 변형(픽셀 단위 복제 금지, 너무 똑같으면 안 됨): 옷의 재질·색상, 미세한 조명·배경 디테일 정도.
- 절대 금지: 화면 안의 글자·자막·캡션·워터마크 — 레퍼런스에 글자가 있어도 전부 제거하고 글자 없는 깨끗한 이미지로.${sanLine}
[장면 묘사] ${prompt}
— 사실적인 광고 레퍼런스 이미지 스타일.`
  } else {
    editPrompt = sanitize
      ? `아래 수정 지시를 "건전하고 비선정적으로" 반영해줘. 노출/속옷/수영복/선정적 포즈/과도한 피부 노출은 제거.\n[수정] ${prompt}`
      : prompt
    const refNote = refUrls.length
      ? `\n[참고 이미지 사용] 이미지가 여러 장 첨부됨 — "첫 번째"가 원본(수정 대상)이고 "나머지"는 참고 이미지다. 원본의 인물·피사체·구도·포즈는 그대로 유지하고, 참고 이미지의 배경/색감/분위기/스타일을 반영해 수정할 것.`
      : ''
    // 편집 결과에도 글자/텍스트가 들어가지 않도록 강제
    editPrompt =
      `[필수·최우선] 결과 이미지 안에 어떤 글자·문자·숫자·자막·캡션·로고·워터마크도 절대 렌더링하지 말 것.\n` +
      editPrompt +
      refNote +
      `\n— 사실적인 광고 레퍼런스 이미지 스타일을 유지하면서 위 수정만 반영.`
  }

  // 원본 + 참고 이미지 모두 가져오기
  const fetchBlob = async (u: string): Promise<Blob> => {
    const ir = await fetch(u)
    if (!ir.ok) throw new Error('load fail')
    const ab = await ir.arrayBuffer()
    return new Blob([ab], { type: ir.headers.get('content-type') || 'image/png' })
  }
  let baseBlob: Blob
  const refBlobs: Blob[] = []
  try {
    baseBlob = await fetchBlob(imageUrl)
  } catch {
    return NextResponse.json({ error: '원본 이미지를 불러오지 못했어요.' }, { status: 400 })
  }
  for (const u of refUrls) {
    try { refBlobs.push(await fetchBlob(u)) } catch { /* 참고 이미지 일부 실패는 무시 */ }
  }

  const editOnce = async (model: string) => {
    const fd = new FormData()
    fd.append('model', model)
    fd.append('prompt', editPrompt)
    fd.append('size', size)
    fd.append('n', '1')
    fd.append('quality', 'medium')
    // 참고 이미지가 있으면 image[] 배열로(원본 먼저, 참고 뒤), 없으면 단일 image
    if (refBlobs.length) {
      fd.append('image[]', baseBlob, 'base.png')
      refBlobs.forEach((b, i) => fd.append('image[]', b, `ref${i + 1}.png`))
    } else {
      fd.append('image', baseBlob, 'image.png')
    }
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
