import { NextResponse } from 'next/server'
import { loadCreative } from '@/lib/creative-source'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { post_id } → 온드미디어(UGC) 콘텐츠 1개를 AI로 상세 분석. 메타광고 analyze 와 동일한
// 시각화용 JSON(phases/engagement/markers/segments/...) 을 반환(프론트의 AnalysisViz 와 호환).
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const postId: string | null = body.post_id ?? body.library_id ?? null
  if (!postId) return NextResponse.json({ error: 'post_id 필요' }, { status: 400 })

  const ad = await loadCreative(postId, 'om')
  if (!ad) return NextResponse.json({ error: '콘텐츠를 찾을 수 없습니다.' }, { status: 404 })

  const isVideo = ad.media_type === 'video'
  const frames: string[] = Array.isArray(ad.frames) ? ad.frames.filter(Boolean) : []
  const imageUrls: string[] = (
    isVideo
      ? frames.slice(0, 4)
      : [ad.media_url || (Array.isArray(ad.media_urls) && ad.media_urls.length ? ad.media_urls[0] : null)]
  ).filter(Boolean) as string[]

  const mediaNote = imageUrls.length
    ? isVideo
      ? `- 영상에서 추출한 실제 프레임 ${imageUrls.length}장이 시간 순서대로 첨부됨. 프레임을 보고 분석에 반영할 것.`
      : '- 크리에이티브 이미지가 첨부됨(분석에 반영).'
    : isVideo
      ? '- 영상이지만 프레임이 없어 자막/카피 기반 "추정"으로 작성.'
      : ''

  const prompt = `너는 숏폼/콘텐츠 분석가다. 아래 크리에이터의 UGC(온드미디어) 콘텐츠를 분석해서, 마케터가 한눈에 보는 "시각화용 구조 데이터"를 JSON으로만 출력해줘.

[콘텐츠 정보]
- 크리에이터: ${ad.page_name ?? '미상'}
- 유형: ${isVideo ? '영상' : ad.media_type === 'slide' ? '슬라이드' : '이미지'}
- 게시일: ${ad.started_on ?? '미상'}
- 제목/캡션: """${(ad.ad_text ?? '').slice(0, 1500)}"""
${ad.transcript ? `- 영상 나레이션 대본(실제 음성 받아쓰기): """${ad.transcript.slice(0, 1800)}"""` : ''}
${mediaNote}

규칙:
- phases: 콘텐츠를 흐름 구간으로 나눔(4~6개). 영상이면 시간 흐름, 이미지면 시선·정보 흐름. 각 weight는 대략적 비중(전부 합쳐 100). desc는 25자 이내.
  ⚠️ 각 구간의 name은 반드시 "서로 다른 단계"로 분배할 것. 누구나 바로 이해되는 쉬운 한국어로. 후보: 시선 끌기(후킹) / 문제 제기 / 정보·비밀 공개 / 근거·증명 / 후기·반응 / 제품 사용 장면 / 혜택 강조 / 행동 유도(CTA). 어려운 전문용어 금지. 절대 모든 구간을 '후킹'으로 만들지 말 것.
- engagement: 시청자 몰입/감정 흐름 추정 곡선(7~9개 포인트). t(0~100, 진행률), v(0~100, 몰입도).
- markers: 특히 잘된 지점(3~5개). t(0~100), 짧은 label, note(왜 좋은지, 35자 이내).
- segments: 시간 흐름을 구간별로 나눠 각 구간의 단계명(name)과 잘한 점(good)·아쉬운 점(bad)을 적음(4~6개, t 0~100 오름차순). good/bad는 각 30자 이내.
- 모든 한국어. 수치는 추정이어도 좋음.
- ⚠️ 반드시 끝까지 "완결된 JSON" 하나만 출력(잘리지 않게 간결히). 마크다운/설명 금지.

아래 JSON만 출력(다른 텍스트 절대 금지):
{"summary":"한 줄 총평","phases":[{"name":"후킹","weight":15,"desc":"이 구간 설명"},{"name":"문제 제기","weight":20,"desc":"설명"}],"engagement":[{"t":0,"v":60},{"t":15,"v":88}],"markers":[{"t":12,"label":"강한 후킹","note":"설명"}],"segments":[{"name":"후킹","t":0,"good":"질문형 자막으로 즉시 시선 고정","bad":"첫 프레임 정보량이 적음"},{"name":"CTA","t":85,"good":"행동 장벽 최소화","bad":"마감 압박 부재"}],"target":"추정 타겟","offer":"핵심 메시지/소구점","strengths":["잘된 점1","잘된 점2"]}`

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
    // 저장하지 않음 — 사용자가 모달에서 '저장'을 눌러야만 DB에 남는다.
    return NextResponse.json({ analysis })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
