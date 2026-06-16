import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 쌓인 광고 조회. ?target_id=... 로 특정 업체만, ?limit=... 로 개수 제한.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetId = searchParams.get('target_id')
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500)

  let q = supabaseAdmin
    .from('am_ads')
    .select('*')
    .order('first_seen_at', { ascending: false })
    .limit(limit)

  if (targetId) q = q.eq('target_id', targetId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
