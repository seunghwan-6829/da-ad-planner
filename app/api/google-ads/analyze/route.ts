import { NextResponse } from 'next/server'
import { loadCreative } from '@/lib/creative-source'
import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = MODELS.standard

// POST { library_id } → 구글 광고 소재 1개를 AI로 상세 분석(메타 analyze 미러).
// 시각화용 JSON(phases/engagement/markers/segments/...) — 프론트 AnalysisViz 호환.
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const libraryId: string | null = body.library_id ?? null
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const ad = await loadCreative(libraryId, 'ga')
  if (!ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  const isVideo = ad.media_type === 'video'
  const frames: string[] = Array.isArray(ad.frames) ? ad.frames.filter(Boolean) : []
  const imageUrls: string[] = (
    isVideo
      ? frames.slice(0, 4).length
        ? frames.slice(0, 4)
        : [ad.poster_url]
      : [ad.media_url || (Array.isArray(ad.media_urls) && ad.media_urls.length ? ad.media_urls[0] : null)]
  ).filter(Boolean) as string[]

  const mediaNote = imageUrls.length
    ? isVideo
      ? `- 영상 광고의 프레임/포스터 ${imageUrls.length}장이 첨부됨. 반드시 보고 분석에 반영할 것.`
      : '- 크리에이티브 이미지가 첨부됨(분석에 반영).'
    : '- 이미지가 없어 카피 기반 "추정"으로 작성.'

  const prompt = `너는 퍼포먼스 마케팅 소재 분석가다. 아래 경쟁사 구글 광고(검색/유튜브/디스플레이) 소재를 분석해서, 마케터가 한눈에 보는 "시각화용 구조 데이터"를 JSON으로만 출력해줘.

[소재 정보]
- 광고주: ${ad.page_name ?? '미상'}
- 유형: ${isVideo ? '영상(유튜브)' : ad.media_type === 'text' ? '텍스트(검색 광고)' : '이미지(디스플레이)'}
- 첫 게재일: ${ad.started_on ?? '미상'}
- 카피/문구(수집된 것): """${(ad.ad_text ?? '').slice(0, 1500)}"""
${ad.transcript ? `- 영상 나레이션 대본(실제 음성 받아쓰기): """${ad.transcript.slice(0, 1800)}"""` : ''}
${mediaNote}

규칙:
- phases: 소재를 흐름 구간으로 나눔(4~6개). 영상이면 시간 흐름, 이미지/텍스트면 시선·정보 흐름. 각 weight는 대략적 비중(전부 합쳐 100). desc는 25자 이내.
  ⚠️ 각 구간의 name은 반드시 "서로 다른 단계"로 분배할 것. 쉬운 한국어: 시선 끌기(후킹) / 문제 제기 / 정보·비밀 공개 / 근거·증명 / 후기·반응 / 제품 사용 장면 / 혜택·가격 강조 / 구매 유도(CTA). 전문용어 금지. 모든 구간 '후킹' 금지.
- engagement: 시청자 몰입/감정 흐름 추정 곡선(7~9개 포인트). t(0~100), v(0~100).
- markers: 특히 잘된 지점(3~5개). t(0~100), 짧은 label, note(35자 이내).
- segments: 구간별 단계명(name)과 잘한 점(good)·아쉬운 점(bad)(4~6개, t 오름차순). 각 30자 이내.
- 모든 한국어. 수치는 추정이어도 좋음.
- ⚠️ 반드시 끝까지 "완결된 JSON" 하나만 출력. 마크다운/설명 금지.

아래 JSON만 출력(다른 텍스트 절대 금지):
{"summary":"한 줄 총평","phases":[{"name":"후킹","weight":15,"desc":"이 구간 설명"}],"engagement":[{"t":0,"v":60},{"t":15,"v":88}],"markers":[{"t":12,"label":"강한 후킹","note":"설명"}],"segments":[{"name":"후킹","t":0,"good":"질문형 카피로 즉시 시선 고정","bad":"첫 화면 정보량 적음"}],"target":"추정 타겟","offer":"핵심 오퍼/소구점","strengths":["잘된 점1","잘된 점2"]}`

  type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }
  const baseContent: Block[] = [{ type: 'text', text: prompt }]
  const withImage: Block[] = imageUrls.length
    ? [...baseContent, ...imageUrls.map((u) => ({ type: 'image' as const, source: { type: 'url' as const, url: u } }))]
    : baseContent

  async function callClaude(content: Block[]) {
    return fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey as string, 'anthropic-version': '2023-06-01' },
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
    const analysis = m ? m[0] : text
    // 저장하지 않음 — 모달에서 '저장'을 눌러야 DB에 남는다(자동저장은 프론트 처리).
    return NextResponse.json({ analysis })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
