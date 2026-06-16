import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
// Claude 호출이 길어질 수 있으니 함수 타임아웃을 늘린다(플랜 한도 내).
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { target_id?: string }  → 해당 업체(또는 전체) 최근 광고를 AI 요약
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' },
      { status: 500 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const targetId: string | null = body.target_id ?? null

  // 최근 광고 최대 25개를 가져온다(토큰/시간 절약).
  let q = supabaseAdmin
    .from('am_ads')
    .select('library_id, page_name, started_on, ad_text, first_seen_at')
    .order('first_seen_at', { ascending: false })
    .limit(25)
  if (targetId) q = q.eq('target_id', targetId)

  const { data: ads, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!ads || ads.length === 0) {
    return NextResponse.json({ summary: '요약할 광고가 아직 없습니다.' })
  }

  const adList = ads
    .map(
      (a, i) =>
        `[${i + 1}] (시작일 ${a.started_on ?? '?'}) ${(a.ad_text ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 400)}`
    )
    .join('\n')

  const prompt = `다음은 한 광고주의 최근 메타(페이스북/인스타그램) 광고 소재 ${ads.length}개야.
마케팅 대행사 담당자가 경쟁사를 빠르게 파악할 수 있도록 한국어로 요약해줘.

다음 항목으로 정리:
1. 핵심 소구점/메시지 (반복되는 테마)
2. 주요 프로모션/오퍼 (할인, 이벤트 등이 보이면)
3. 추정 타겟 고객
4. 최근 새로 등장한 듯한 변화나 신규 소재 방향 (시작일 참고)
5. 우리가 참고할 만한 한 줄 인사이트

간결하게, 불릿으로.

--- 광고 소재 ---
${adList}`

  try {
    const res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message ?? 'Anthropic API 오류' },
        { status: res.status }
      )
    }

    const summary =
      data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
    return NextResponse.json({ summary, count: ads.length })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
