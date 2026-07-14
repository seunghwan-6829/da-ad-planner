import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드 스타일 가이드(analyze 가 생성). GET ?brand_id=
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  if (!brandId) return NextResponse.json({ error: 'brand_id 필요' }, { status: 400 })
  const { data } = await supabaseAdmin.from('th_style_guides').select('*').eq('brand_id', brandId).maybeSingle()
  return NextResponse.json(data ?? null)
}
