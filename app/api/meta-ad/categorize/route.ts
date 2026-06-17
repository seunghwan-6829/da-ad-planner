import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

const CATEGORIES = [
  '뷰티 & 에어케어',
  '패션 & 의류',
  '음식 & 음료',
  '리빙 & 인테리어',
  '육아 & 동물',
  '의료 & 건강',
  '교육 & 강의',
  'IT & 전자기기',
  '기타',
]

// POST { target_id } → 해당 브랜드의 최근 광고 텍스트 몇 개로 대분류를 자동 판정해 am_targets.category 갱신
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  const body = await req.json().catch(() => ({}))
  const targetId: string | null = body.target_id ?? null
  if (!targetId) return NextResponse.json({ error: 'target_id 필요' }, { status: 400 })

  // 최근 광고 텍스트 최대 8개
  const { data: ads } = await supabaseAdmin
    .from('am_ads')
    .select('ad_text, page_name')
    .eq('target_id', targetId)
    .order('first_seen_at', { ascending: false })
    .limit(8)

  if (!ads || ads.length === 0) {
    return NextResponse.json({ category: null, reason: 'no_ads' })
  }
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 없음' }, { status: 500 })
  }

  const sample = ads
    .map((a, i) => `[${i + 1}] ${(a.ad_text ?? '').replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n')

  const prompt = `아래는 한 광고주의 최근 메타 광고 소재 텍스트야. 이 브랜드가 무엇을 파는지 보고, 아래 대분류 중 가장 알맞은 하나만 골라줘.
대분류 후보: ${CATEGORIES.join(', ')}
반드시 JSON만: {"category":"후보 중 하나"}

--- 광고 텍스트 ---
${sample}`

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
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'AI 오류' }, { status: res.status })
    }
    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    let category = '기타'
    if (m) {
      try {
        const c = (JSON.parse(m[0]).category || '').toString().trim()
        category = CATEGORIES.includes(c) ? c : '기타'
      } catch {}
    }

    await supabaseAdmin.from('am_targets').update({ category }).eq('id', targetId)
    return NextResponse.json({ category })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
