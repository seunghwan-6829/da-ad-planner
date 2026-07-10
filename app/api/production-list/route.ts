import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 제작 리스트 CRUD.
//   GET    ?source=&status=          → 목록(최신순, 필터는 옵션)
//   POST   {source, ref_id, brand, thumb, media_type, created_by} → 담기(중복이면 dupe:true)
//   PATCH  {id, status?, note?}      → 상태/메모 수정
//   DELETE ?id=                      → 제거

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source')
  const status = searchParams.get('status')

  let q = supabaseAdmin.from('production_list').select('*').order('created_at', { ascending: false }).limit(2000)
  if (source) q = q.eq('source', source)
  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const source = (body.source || '').toString()
  const refId = (body.ref_id || '').toString().trim()
  if (!['meta', 'google', 'owned'].includes(source) || !refId) {
    return NextResponse.json({ error: 'source/ref_id 필요' }, { status: 400 })
  }

  const row = {
    source,
    ref_id: refId,
    brand: body.brand ?? null,
    thumb: body.thumb ?? null,
    media_type: body.media_type ?? null,
    created_by: body.created_by ?? null,
  }
  const { data, error } = await supabaseAdmin.from('production_list').insert(row).select().single()
  if (error) {
    // 23505 = unique 위반 → 이미 담겨 있음(정상 흐름)
    if (error.code === '23505') return NextResponse.json({ dupe: true })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, item: data })
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}))
  const id = (body.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.status === 'string' && ['todo', 'doing', 'done'].includes(body.status)) patch.status = body.status
  if (typeof body.note === 'string') patch.note = body.note
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })

  const { error } = await supabaseAdmin.from('production_list').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const { error } = await supabaseAdmin.from('production_list').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
