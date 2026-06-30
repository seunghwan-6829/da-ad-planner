import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 콘텐츠 목록(가벼움). 백그라운드 전체 로드 / 크리에이터별 로드용.
//   ?light=1&limit=&offset=        → 최신순 페이지네이션
//   ?light=1&creator_id=&limit=    → 특정 크리에이터 전체
const LIGHT_COLS =
  'post_id, creator_id, creator_name, platform, post_url, media_type, media_url, media_urls, poster_url, posted_at, views, likes, comments, shares, saves, memo, saved, status, ended_at, first_seen_at, last_seen_at'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const limit = Math.min(1000, Math.max(1, Number(searchParams.get('limit')) || 300))
  const offset = Math.max(0, Number(searchParams.get('offset')) || 0)
  const creatorId = searchParams.get('creator_id')

  let q = supabaseAdmin.from('om_posts').select(LIGHT_COLS).order('first_seen_at', { ascending: false })
  if (creatorId) q = q.eq('creator_id', creatorId)
  q = q.range(offset, offset + limit - 1)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
