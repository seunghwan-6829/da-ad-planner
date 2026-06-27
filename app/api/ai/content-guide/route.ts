import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { library_id } → 소재의 장면(프레임)별로 "그 화면을 만들기 위한 이미지 생성 프롬프트(한국어)
// + 간략 설명 + 주의할 점"을 스토리보드 형태로 생성. 사용자 본인 Anthropic 키(x-user-api-key).
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: '마이페이지에서 Anthropic API 키를 입력해야 컨텐츠 가이드를 만들 수 있어요.' }, { status: 401 })
  }
  const body = await req.json().catch(() => ({}))
  const libraryId: string | null = body.library_id ?? null
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const cols = 'library_id, page_name, ad_text, media_type, media_url, media_urls, poster_url, frames'
  let { data: ad, error } = await supabaseAdmin.from('am_ads').select(cols + ', transcript').eq('library_id', libraryId).single()
  if (error) ({ data: ad, error } = await supabaseAdmin.from('am_ads').select(cols).eq('library_id', libraryId).single())
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  // ── 단일 장면 모드: { image } 한 장만 처리(클라이언트가 장면마다 병렬 호출) ──
  //    1이미지 + 작은 출력이라 함수 타임아웃/맥스토큰 제약을 받지 않는다.
  const single = (body.image || '').toString()
  if (single) {
    const p1 = `너는 숏폼 광고 컨텐츠 디렉터다. 첨부된 "한 장면(스크린샷)"을 보고, 이 화면과 비슷한 이미지를 AI 이미지 생성 도구로 다시 만들기 위한 것을 작성해라.
[참고] 브랜드: ${ad.page_name ?? '미상'} / 본문·자막: """${(ad.ad_text ?? '').slice(0, 600)}"""
JSON 으로만 작성:
- prompt: 이 화면을 만들 한국어 이미지 생성 프롬프트(피사체/구도/조명/분위기/스타일/카메라 앵글, 2~4문장)
- description: 장면 간략 설명(20자 내외)
- caution: 만들 때 주의점(25자 내외)
완결된 JSON 하나만: {"prompt":"...","description":"...","caution":"..."}`
    try {
      let r = await fetch(ANTHROPIC_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: [{ type: 'text', text: p1 }, { type: 'image', source: { type: 'url', url: single } }] }] }),
      })
      if (!r.ok) {
        r = await fetch(ANTHROPIC_BASE, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: [{ type: 'text', text: p1 }] }] }) })
      }
      const d = await r.json()
      if (!r.ok) return NextResponse.json({ error: d.error?.message ?? 'Anthropic API 오류' }, { status: r.status })
      const t = d.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
      const mm = t.match(/\{[\s\S]*\}/)
      let one: { prompt?: string; description?: string; caution?: string } = {}
      if (mm) { try { one = JSON.parse(mm[0]) } catch {} }
      return NextResponse.json({ prompt: one.prompt || '', description: one.description || '', caution: one.caution || '', brand: ad.page_name ?? null })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '생성 실패' }, { status: 500 })
    }
  }

  // 장면 이미지: 영상=추출 프레임, 그 외=캐러셀/포스터
  const frames: string[] = Array.isArray(ad.frames) ? (ad.frames as string[]).filter(Boolean) : []
  // 클라이언트가 영상에서 직접 추출한 씬 프레임(배경 변화 감지)을 우선 사용. 없으면 서버 프레임/포스터 폴백.
  const clientFrames: string[] = Array.isArray(body.frames) ? (body.frames as string[]).filter(Boolean) : []
  let images: string[] = clientFrames.length
    ? clientFrames
    : frames.length
      ? frames
      : (Array.isArray(ad.media_urls) && ad.media_urls.length ? (ad.media_urls as string[]) : ([ad.poster_url || ad.media_url].filter(Boolean) as string[]))
  images = images.slice(0, 14)
  if (!images.length) return NextResponse.json({ error: '장면으로 쓸 이미지가 없는 소재예요(프레임 추출 전일 수 있어요).' }, { status: 400 })

  const transcript = typeof ad.transcript === 'string' ? ad.transcript : ''
  const prompt = `너는 숏폼 광고 컨텐츠 디렉터다. 아래는 한 광고 소재의 장면(스크린샷) ${images.length}개가 시간 순서대로 첨부돼 있다.
각 장면마다, 우리가 이 화면과 비슷한 이미지를 "AI 이미지 생성 도구"로 다시 만들기 위한 것을 작성해라.

[참고]
- 브랜드: ${ad.page_name ?? '미상'}
- 본문/자막: """${(ad.ad_text ?? '').slice(0, 1000)}"""
${transcript ? `- 나레이션: """${transcript.slice(0, 1000)}"""` : ''}

각 장면(scene)마다 다음을 작성(첨부된 이미지 순서와 1:1로 매칭, ${images.length}개):
- prompt: 그 화면을 만들기 위한 "이미지 생성 프롬프트"(한국어, 최신 생성기법 기준으로 구체적 — 피사체/구도/조명/분위기/스타일/카메라 앵글 등 포함, 2~4문장)
- description: 이 장면이 무엇인지 간략 설명(20자 내외)
- caution: 이 장면을 만들 때 주의할 점(저작권/모델/텍스트 가독성/비율 등, 25자 내외)

반드시 "완결된 JSON" 하나만 출력. 마크다운/설명 금지.
{"scenes":[{"prompt":"...","description":"...","caution":"..."}]}`

  type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }
  const content: Block[] = [{ type: 'text', text: prompt }, ...images.map((u) => ({ type: 'image' as const, source: { type: 'url' as const, url: u } }))]

  try {
    let res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content }] }),
    })
    // 외부 이미지 로딩 실패 시 텍스트만으로 재시도
    if (!res.ok) {
      res = await fetch(ANTHROPIC_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] }),
      })
    }
    const data = await res.json()
    if (!res.ok) return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    let scenes: { prompt?: string; description?: string; caution?: string }[] = []
    if (m) { try { scenes = (JSON.parse(m[0]).scenes || []) } catch {} }
    // 이미지와 1:1 매칭(부족분 빈칸)
    const out = images.map((img, i) => ({
      image: img,
      prompt: scenes[i]?.prompt || '',
      description: scenes[i]?.description || '',
      caution: scenes[i]?.caution || '',
    }))
    return NextResponse.json({ scenes: out, brand: ad.page_name ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '생성 실패' }, { status: 500 })
  }
}
