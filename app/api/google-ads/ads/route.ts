import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 쌓인 광고 조회(메타 미러).
//  ?target_id=...  특정 광고주만
//  ?limit=...      개수(최대 1000)
//  ?offset=...     건너뛰기(백그라운드 전체 로드용)
//  ?light=1        본문(ad_text) 제외(경량)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetId = searchParams.get('target_id')
  const light = searchParams.get('light') === '1'
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 1000)
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0)

  const lightCols =
    'library_id, target_id, page_name, started_on, last_shown, media_type, media_url, media_urls, poster_url, landing_url, source_url, format, memo, status, ended_at, first_seen_at, last_seen_at, saved'
  const cols = light ? lightCols : `${lightCols}, ad_text`

  let q = supabaseAdmin
    .from('ga_ads')
    .select(cols)
    .order('first_seen_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (targetId) q = q.eq('target_id', targetId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
