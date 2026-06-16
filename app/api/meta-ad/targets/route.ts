import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 타겟 목록
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('am_targets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 타겟 추가
export async function POST(req: Request) {
  const body = await req.json()
  const type = body.type === 'keyword' ? 'keyword' : 'page'

  const row = {
    label: (body.label || '').trim() || '(이름없음)',
    category: (body.category || '').trim() || '미분류',
    type,
    page_id: type === 'page' ? (body.page_id || '').trim() : null,
    query: type === 'keyword' ? (body.query || '').trim() : null,
    country: (body.country || 'KR').trim(),
    enabled: true,
  }

  if (type === 'page' && !row.page_id) {
    return NextResponse.json({ error: 'page_id 가 필요합니다.' }, { status: 400 })
  }
  if (type === 'keyword' && !row.query) {
    return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('am_targets')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
