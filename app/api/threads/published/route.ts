import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 발행 이력.
//   GET ?brand_id=&limit= → 최근 발행 목록

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  const limit = Math.min(200, Number(searchParams.get('limit')) || 100)
  let q = supabaseAdmin.from('th_published').select('*').order('published_at', { ascending: false }).limit(limit)
  if (brandId) q = q.eq('brand_id', brandId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
