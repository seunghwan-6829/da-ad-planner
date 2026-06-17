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
    .select('library_id, page_name, started_on, ad_text, media_type, media_url, media_urls')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  const isVideo = ad.media_type === 'video'
  const firstImage = !isVideo
    ? ad.media_url || (Array.isArray(ad.media_urls) && ad.media_urls.length ? ad.media_urls[0] : null)
    : null

  const prompt = `너는 퍼포먼스 마케팅 소재 분석가다. 아래 경쟁사 메타(페이스북/인스타그램) 광고 소재를 분석해, 마케터가 바로 참고할 수 있게 한국어로 정리해줘.

[소재 정보]
- 유형: ${isVideo ? '영상' : ad.media_type === 'carousel' ? '슬라이드(캐러셀)' : '이미지'}
- 게재 시작일: ${ad.started_on ?? '미상'}
- 본문/자막 텍스트(광고에서 추출): """${(ad.ad_text ?? '').slice(0, 1500)}"""
${firstImage ? '- 크리에이티브 이미지가 함께 첨부됨(분석에 반영).' : isVideo ? '- 영상 소재라 화면 프레임은 직접 보지 못함. 본문/자막 텍스트 기반으로 추정 분석할 것.' : ''}

아래 항목으로 간결하게(불릿) 분석해줘:
1. 소재 구조 (후킹 → 전개 → CTA 흐름. 영상이면 추정 대본 흐름)
2. 후킹 포인트 (첫 3초/첫 문장에서 시선을 잡는 요소)
3. 핵심 소구점 · 오퍼 (혜택, 할인, 이벤트 등)
4. 추정 타겟 고객
5. 잘된 점 (이 소재가 왜 효과적일 가능성이 큰지)
6. 우리가 바로 써먹을 실행 인사이트 1~2개`

  type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }
  const baseContent: Block[] = [{ type: 'text', text: prompt }]
  const withImage: Block[] = firstImage
    ? [...baseContent, { type: 'image', source: { type: 'url', url: firstImage } }]
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
    if (!res.ok && firstImage) {
      res = await callClaude(baseContent)
    }
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    }
    const analysis =
      data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''

    // 캐싱(컬럼 없으면 무시) — 다음에 다시 열 때 재분석 없이 표시
    await supabaseAdmin.from('am_ads').update({ ai_analysis: analysis }).eq('library_id', libraryId)

    return NextResponse.json({ analysis })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
