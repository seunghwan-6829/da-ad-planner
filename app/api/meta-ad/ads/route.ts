import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 쌓인 광고 조회. ?target_id=... 로 특정 업체만, ?limit=... 로 개수 제한.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetId = searchParams.get('target_id')
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500)

  // 무겁게 누적되는 ai_analysis(JSON)·frames(배열)는 목록에서 제외 → 카드 클릭 시 따로 받는다.
  // (ad_text/memo 는 CSV 내보내기에 필요해 유지)
  // saved 컬럼은 마이그레이션 후 존재. 아직 없으면 빼고 재조회.
  const baseCols =
    'library_id, target_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, landing_url, memo, status, ended_at, first_seen_at, last_seen_at'

  const run = (cols: string) => {
    let q = supabaseAdmin.from('am_ads').select(cols).order('first_seen_at', { ascending: false }).limit(limit)
    if (targetId) q = q.eq('target_id', targetId)
    return q
  }

  let { data, error } = await run(`${baseCols}, saved`)
  if (error) ({ data, error } = await run(baseCols))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
