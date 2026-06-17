import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { library_id } → 해당 광고 소재를 AI로 상세 분석 (대본/후킹/소구점/타겟/잘된점/인사이트)
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const libraryId: string | null = body.library_id ?? null
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('am_ads')
    .select('library_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, frames')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  const isVideo = ad.media_type === 'video'
  // 비전에 첨부할 이미지: 영상=추출 프레임(최대 4, 시간순), 그 외=크리에이티브 이미지 1장
  const frames: string[] = Array.isArray(ad.frames) ? (ad.frames as string[]).filter(Boolean) : []
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

  const prompt = `너는 퍼포먼스 마케팅 소재 분석가다. 아래 경쟁사 메타(페이스북/인스타그램) 광고 소재를 분석해서, 마케터가 한눈에 보는 "시각화용 구조 데이터"를 JSON으로만 출력해줘.

[소재 정보]
- 유형: ${isVideo ? '영상' : ad.media_type === 'carousel' ? '슬라이드(캐러셀)' : '이미지'}
- 게재 시작일: ${ad.started_on ?? '미상'}
- 본문/자막 텍스트(광고에서 추출): """${(ad.ad_text ?? '').slice(0, 1500)}"""
${mediaNote}

규칙:
- phases: 소재를 흐름 구간으로 나눔. 영상이면 시간 흐름(예: 후킹→문제 제기→해결/원리→근거→CTA), 이미지면 시선·정보 흐름. 각 weight는 대략적 비중(전부 합쳐 100).
- engagement: 시청자 몰입/감정 흐름 추정 곡선. 포인트 6~10개. t(0~100, 진행률), v(0~100, 몰입도).
- markers: 특히 잘된 지점(강한 후킹/매력적 오퍼/사회적 증거/반전 등). t(0~100), 짧은 label, note(왜 좋은지).
- 모든 한국어. 수치는 추정이어도 좋음.

아래 JSON만 출력(다른 텍스트 절대 금지):
{"summary":"한 줄 총평","phases":[{"name":"후킹","weight":15,"desc":"이 구간 설명"}],"engagement":[{"t":0,"v":60},{"t":15,"v":88}],"markers":[{"t":12,"label":"강한 후킹","note":"설명"}],"target":"추정 타겟","offer":"핵심 오퍼/소구점","strengths":["잘된 점1","잘된 점2"]}`

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
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content }] }),
    })
  }

  try {
    let res = await callClaude(withImage)
    // 이미지(외부 URL) 로딩 실패 시 텍스트만으로 재시도
    if (!res.ok && imageUrls.length) {
      res = await callClaude(baseContent)
    }
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    }
    const text =
      data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
    // 시각화용 JSON 문자열만 추출(파싱 실패 시 원문 그대로 — 프론트가 텍스트로 폴백 표시)
    const m = text.match(/\{[\s\S]*\}/)
    const analysis = m ? m[0] : text

    // 저장하지 않음 — 사용자가 모달에서 '저장'을 눌러야만 DB에 남는다.
    return NextResponse.json({ analysis })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
