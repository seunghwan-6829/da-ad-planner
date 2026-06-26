import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { library_id } → 경쟁 소재 1개를 7갈래 기획 마인드맵으로 분해.
// ⚠️ 서버 키가 아니라 "사용자 본인 Anthropic 키"(x-user-api-key)로만 동작 → 키 없는 사람은 사용 불가(체리피커 방지).
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: '마이페이지에서 Anthropic API 키를 입력해야 기획 마인드맵을 사용할 수 있어요.' },
      { status: 401 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const libraryId: string | null = body.library_id ?? null
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  // transcript 컬럼이 없는 환경에서도 깨지지 않게 폴백.
  const cols = 'library_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, frames, ai_analysis'
  let { data: ad, error } = await supabaseAdmin
    .from('am_ads')
    .select(cols + ', transcript')
    .eq('library_id', libraryId)
    .single()
  if (error) {
    ;({ data: ad, error } = await supabaseAdmin.from('am_ads').select(cols).eq('library_id', libraryId).single())
  }
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  const isVideo = ad.media_type === 'video'
  const frames: string[] = Array.isArray(ad.frames) ? (ad.frames as string[]).filter(Boolean) : []
  const imageUrls: string[] = (
    isVideo
      ? frames.slice(0, 4)
      : [ad.media_url || (Array.isArray(ad.media_urls) && ad.media_urls.length ? ad.media_urls[0] : null)]
  ).filter(Boolean) as string[]

  const transcript = typeof ad.transcript === 'string' ? ad.transcript : ''
  const mediaNote = imageUrls.length
    ? isVideo
      ? `- 영상 프레임 ${imageUrls.length}장이 시간 순서대로 첨부됨. 반드시 보고 반영할 것.`
      : '- 크리에이티브 이미지가 첨부됨(반영).'
    : ''

  const prompt = `너는 숏폼/퍼포먼스 광고 기획 디렉터다. 아래 경쟁사 메타 광고 소재 1개를 보고, 우리 팀이 "이 소재를 우리식으로 다시 기획"할 때 쓸 마인드맵을 JSON으로만 출력해줘.

[소재 정보]
- 브랜드(페이지): ${ad.page_name ?? '미상'}
- 유형: ${isVideo ? '영상' : ad.media_type === 'carousel' ? '슬라이드' : '이미지'}
- 게재 시작일: ${ad.started_on ?? '미상'}
- 본문/자막: """${(ad.ad_text ?? '').slice(0, 1500)}"""
${transcript ? `- 영상 나레이션 대본(실제 음성 받아쓰기): """${transcript.slice(0, 2000)}"""` : ''}
${ad.ai_analysis ? `- 기존 AI 상세분석(JSON, 반드시 근거로 활용): """${String(ad.ai_analysis).slice(0, 1800)}"""` : ''}
${mediaNote}

위 [소재 정보](프레임/자막/나레이션/기존 AI 분석)를 **실제로 근거 삼아** 작성할 것. 추측만으로 대충 쓰지 말 것.

아래 7개 가지(node)를 각각 채워라. items 는 구체적이고 실행가능한 짧은 문장(각 30자 내외) 2~4개씩.
1) develop — 디벨롭할 부분: 이 소재에서 우리가 더 발전/개선시킬 수 있는 포인트
2) storytelling — 스토리텔링: 소재가 쓴 이야기 구조/전개 방식(우리가 차용할 흐름)
3) script — 대본: 우리 버전으로 쓸 핵심 카피/대사 아이디어(후킹·전개·CTA)
4) plan — 기획안: 이걸 우리 소재로 만들 때의 기획 방향/구성안
5) segment — 세그먼트: 이 소재에 반응이 좋을 타겟. 제작자가 의도했을 타겟을 역추적해 추정(연령/관심사/상황)
6) weakness — 못한 점: 이 소재의 약점/아쉬운 점(우리가 피하거나 보완할 것)
7) strength — 잘한 점: 이 소재가 잘한 점(반드시 살릴 강점)
8) segment2 — 추가 세그먼트: 위 세그먼트와는 다른 또 하나의 반응 좋을 타겟을 더 깊이 조사해 추정(연령/관심사/상황/맥락이 5번과 겹치지 않게)

또한 "charts" 에 시각화용 추정 데이터 2개를 만들어라(수치는 추정):
- 첫째: 소재 진행(0~100%) 대비 시청자 몰입도 곡선(line, 5~7포인트).
- 둘째: 후킹/전개/혜택/CTA 등 구성 비중(bar, 3~5개, 합 100 근처).

규칙: 한국어. 추정이어도 좋음. summary 는 한 줄 총평. 반드시 "완결된 JSON" 하나만, 마크다운/설명 금지.

아래 형식만 출력:
{"summary":"한 줄 총평","nodes":[
{"key":"develop","label":"디벨롭할 부분","items":["...","..."]},
{"key":"storytelling","label":"스토리텔링","items":["...","..."]},
{"key":"script","label":"대본","items":["...","..."]},
{"key":"plan","label":"기획안","items":["...","..."]},
{"key":"segment","label":"세그먼트","items":["...","..."]},
{"key":"weakness","label":"못한 점","items":["...","..."]},
{"key":"strength","label":"잘한 점","items":["...","..."]},
{"key":"segment2","label":"추가 세그먼트","items":["...","..."]}
],"charts":[
{"title":"구간별 몰입도","kind":"line","data":[{"label":"0%","value":60},{"label":"25%","value":85},{"label":"50%","value":70},{"label":"75%","value":78},{"label":"100%","value":65}]},
{"title":"구성 비중","kind":"bar","data":[{"label":"후킹","value":25},{"label":"전개","value":40},{"label":"혜택","value":20},{"label":"CTA","value":15}]}
]}`

  type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }
  const baseContent: Block[] = [{ type: 'text', text: prompt }]
  const withImage: Block[] = imageUrls.length
    ? [...baseContent, ...imageUrls.map((u) => ({ type: 'image' as const, source: { type: 'url' as const, url: u } }))]
    : baseContent

  async function callClaude(content: Block[]) {
    return fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] }),
    })
  }

  try {
    let res = await callClaude(withImage)
    if (!res.ok && imageUrls.length) res = await callClaude(baseContent)
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    }
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ error: '마인드맵 생성 결과를 해석하지 못했어요.' }, { status: 502 })
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return NextResponse.json({ error: '마인드맵 JSON 파싱 실패' }, { status: 502 })
    }
    // 나레이션은 AI 생성이 아니라 실제 영상 대본(transcript) 원문을 그대로 싣는다.
    parsed.narration = transcript || ''
    parsed.media = { url: ad.media_url ?? null, type: ad.media_type ?? null, poster: ad.poster_url ?? null }
    return NextResponse.json({ data: parsed })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
