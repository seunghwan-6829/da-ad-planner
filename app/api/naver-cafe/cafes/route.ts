import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 카페 관리(카페별 성질/말투/주제 설정).
//   GET → 목록 / POST {name, cafe_url, board_name, tone, topics, notes} / PATCH {id, ...} / DELETE ?id=

export async function GET() {
  const { data, error } = await supabaseAdmin.from('nc_cafes').select('*').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const name = (b.name || '').toString().trim()
  const cafeUrl = (b.cafe_url || '').toString().trim()
  if (!name || !/cafe\.naver\.com\//i.test(cafeUrl)) {
    return NextResponse.json({ error: '카페 이름과 cafe.naver.com 주소가 필요해요.' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('nc_cafes')
    .insert({
      name,
      cafe_url: cafeUrl,
      board_name: (b.board_name || '').toString(),
      tone: (b.tone || '').toString(),
      topics: (b.topics || '').toString(),
      notes: (b.notes || '').toString(),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, cafe: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'cafe_url', 'board_name', 'tone', 'topics', 'notes', 'plan_schedule', 'publish_slot'] as const) {
    if (typeof b[k] === 'string') patch[k] = b[k]
  }
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('nc_cafes').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('nc_cafes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
