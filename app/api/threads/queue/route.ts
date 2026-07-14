import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 발행 큐(초안/예약). status: queued → published | failed (발행은 서버 크론 tick).
//   GET ?brand_id=&status= / POST {brand_id, text, category_id?, topic_tag?, scheduled_at?, meta?, source_key?}
//   PATCH {id, text?, topic_tag?, scheduled_at?, status?} / DELETE ?id=

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  const status = searchParams.get('status')
  let q = supabaseAdmin.from('th_queue').select('*, th_categories(id, name)').order('created_at', { ascending: false }).limit(500)
  if (brandId) q = q.eq('brand_id', brandId)
  if (status && ['queued', 'published', 'failed'].includes(status)) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const brandId = (b.brand_id || '').toString()
  const text = (b.text || '').toString().trim()
  if (!brandId) return NextResponse.json({ error: '브랜드가 필요해요.' }, { status: 400 })
  if (!text) return NextResponse.json({ error: '내용이 필요해요.' }, { status: 400 })
  const row: Record<string, unknown> = {
    brand_id: brandId,
    text: text.slice(0, 500),
    category_id: b.category_id || null,
    topic_tag: (b.topic_tag || '').toString(),
    scheduled_at: b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null,
    meta: b.meta && typeof b.meta === 'object' ? b.meta : { manual: true },
    source_key: b.source_key || null,
    status: 'queued',
  }
  const { data, error } = await supabaseAdmin.from('th_queue').insert(row).select('*, th_categories(id, name)').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, item: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (typeof b.text === 'string') patch.text = b.text.slice(0, 500)
  if (typeof b.topic_tag === 'string') patch.topic_tag = b.topic_tag
  if (b.scheduled_at !== undefined) patch.scheduled_at = b.scheduled_at ? new Date(b.scheduled_at).toISOString() : null
  if (b.status === 'queued') { patch.status = 'queued'; patch.error = null } // 재시도(발행/실패는 서버 전용)
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_queue').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_queue').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
