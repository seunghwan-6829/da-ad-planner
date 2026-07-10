import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 카페 글(초안 → 발행 대기 → 발행/실패).
//   GET ?status=            → 목록(카페 정보 포함, 최신순)
//   POST {cafe_id, title, body, status?, created_by} → 저장(기본 draft)
//   PATCH {id, title?, body?, status?}  → 수정/발행대기/취소/재시도
//   DELETE ?id=

const ALLOWED_STATUS = ['draft', 'queued', 'publishing', 'published', 'failed']

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  let q = supabaseAdmin
    .from('nc_posts')
    .select('*, nc_cafes(id, name, cafe_url, board_name)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status && ALLOWED_STATUS.includes(status)) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const cafeId = (b.cafe_id || '').toString()
  const title = (b.title || '').toString().trim()
  const body = (b.body || '').toString()
  if (!cafeId || !title) return NextResponse.json({ error: '카페와 제목이 필요해요.' }, { status: 400 })
  const status = b.status === 'queued' ? 'queued' : 'draft'
  const { data, error } = await supabaseAdmin
    .from('nc_posts')
    .insert({ cafe_id: cafeId, title, body, status, created_by: b.created_by ?? null })
    .select('*, nc_cafes(id, name, cafe_url, board_name)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, post: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b.title === 'string') patch.title = b.title
  if (typeof b.body === 'string') patch.body = b.body
  if (typeof b.status === 'string') {
    // 웹에서 바꿀 수 있는 상태만(발행중/발행완료는 에이전트 전용)
    if (!['draft', 'queued'].includes(b.status)) return NextResponse.json({ error: '허용되지 않는 상태' }, { status: 400 })
    patch.status = b.status
    if (b.status === 'queued') patch.error = null // 재시도 시 이전 오류 제거
  }
  const { error } = await supabaseAdmin.from('nc_posts').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('nc_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
