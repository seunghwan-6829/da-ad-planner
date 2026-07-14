import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeScraps, type Scrap, type ScrapMetric } from '@/lib/threads/scoring'

export const dynamic = 'force-dynamic'

// 수집글(스크랩) — viral 스코어링 포함.
//   GET ?brand_id=&category_id=&limit= → 점수·hot 계산된 목록
//   DELETE ?brand_id=  (또는 ?all=1) → 초기화(지표는 cascade 삭제)

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  const categoryId = searchParams.get('category_id')
  const limit = Math.min(1000, Number(searchParams.get('limit')) || 500)

  let q = supabaseAdmin.from('th_scraps').select('*').order('first_seen', { ascending: false }).limit(limit)
  if (brandId) q = q.eq('brand_id', brandId)
  if (categoryId) q = q.eq('category_id', categoryId)
  const { data: scraps, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const keys = (scraps || []).map((s) => s.key)
  if (!keys.length) return NextResponse.json([])

  const { data: metrics } = await supabaseAdmin.from('th_scrap_metrics').select('scrap_key, ts, rank, views, likes, comments').in('scrap_key', keys)
  const scored = summarizeScraps((scraps || []) as Scrap[], (metrics || []) as ScrapMetric[])
  return NextResponse.json(scored)
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  const all = searchParams.get('all') === '1'
  if (!brandId && !all) return NextResponse.json({ error: 'brand_id 또는 all=1 이 필요해요.' }, { status: 400 })
  let q = supabaseAdmin.from('th_scraps').delete()
  q = brandId ? q.eq('brand_id', brandId) : q.neq('key', '')
  const { error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
