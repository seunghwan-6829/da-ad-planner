import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 카테고리(수집 소스). threads_topic(키워드/태그) | css(외부 게시판).
//   GET ?brand_id= → 목록 / POST / PATCH / DELETE ?id=

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  let q = supabaseAdmin.from('th_categories').select('*').order('created_at', { ascending: true })
  if (brandId) q = q.eq('brand_id', brandId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

function buildRow(b: Record<string, unknown>): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const k of ['name', 'keyword', 'topic_tag', 'url', 'preset'] as const) if (typeof b[k] === 'string') row[k] = b[k]
  if (b.type === 'threads_topic' || b.type === 'css') row.type = b.type
  return row
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const brandId = (b.brand_id || '').toString()
  const name = (b.name || '').toString().trim()
  if (!brandId || !name) return NextResponse.json({ error: '브랜드와 카테고리 이름이 필요해요.' }, { status: 400 })
  const row = { brand_id: brandId, type: 'threads_topic', ...buildRow(b), name }
  const { data, error } = await supabaseAdmin.from('th_categories').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, category: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch = buildRow(b)
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_categories').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_categories').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
