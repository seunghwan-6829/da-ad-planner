import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 페이지 진입용 통합 엔드포인트: targets + ads(목록 경량 컬럼) + 브랜드별 카운트를 한 번에.
// (기존 3개 호출 → 1개로 합쳐 서버리스 콜드스타트/왕복을 줄임)
export async function GET() {
  const adCols =
    'library_id, target_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, landing_url, memo, status, ended_at, first_seen_at, last_seen_at'

  const [tRes, aRes, cRes] = await Promise.all([
    supabaseAdmin.from('am_targets').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('am_ads').select(adCols).order('first_seen_at', { ascending: false }).limit(500),
    supabaseAdmin.from('am_ads').select('target_id'),
  ])

  if (tRes.error) return NextResponse.json({ error: tRes.error.message }, { status: 500 })
  if (aRes.error) return NextResponse.json({ error: aRes.error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  for (const r of cRes.data ?? []) {
    if (!r.target_id) continue
    counts[r.target_id] = (counts[r.target_id] || 0) + 1
  }

  return NextResponse.json({ targets: tRes.data ?? [], ads: aRes.data ?? [], counts })
}
