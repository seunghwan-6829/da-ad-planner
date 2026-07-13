import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 기획 메모장 CRUD. owner(email)로 본인 것만.
//   GET    ?owner=            → 목록(최신 수정순)
//   POST   {owner, title?}    → 새 메모 생성(빈 내용)
//   PATCH  {id, owner, title?, content?, variations?} → 실시간 저장
//   DELETE ?id=&owner=

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const owner = searchParams.get('owner') || ''
  const folder = searchParams.get('folder') // 폴더 id / 'none'(미분류) / 없으면 전체
  if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 })
  let q = supabaseAdmin
    .from('plan_memos')
    .select('id, folder_id, title, content, variations, created_at, updated_at')
    .eq('owner', owner)
    .order('updated_at', { ascending: false })
    .limit(500)
  if (folder === 'none') q = q.is('folder_id', null)
  else if (folder) q = q.eq('folder_id', folder)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const owner = (b.owner || '').toString().trim()
  if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 })
  const row: Record<string, unknown> = { owner, title: (b.title || '무제 메모').toString().slice(0, 120) }
  if (b.folder_id) row.folder_id = b.folder_id // 특정 폴더에 생성
  let { data, error } = await supabaseAdmin.from('plan_memos').insert(row).select().single()
  if (error && /folder_id/.test(error.message)) {
    // folder_id 컬럼 보강 SQL 실행 전 폴백
    delete row.folder_id
    ;({ data, error } = await supabaseAdmin.from('plan_memos').insert(row).select().single())
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, memo: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  const owner = (b.owner || '').toString().trim()
  if (!id || !owner) return NextResponse.json({ error: 'id/owner 필요' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof b.title === 'string') patch.title = b.title.slice(0, 120)
  if (typeof b.content === 'string') patch.content = b.content
  if (Array.isArray(b.variations)) patch.variations = b.variations
  if ('folder_id' in b) patch.folder_id = b.folder_id ?? null // 폴더 이동/해제
  const { error } = await supabaseAdmin.from('plan_memos').update(patch).eq('id', id).eq('owner', owner)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const owner = searchParams.get('owner')
  if (!id || !owner) return NextResponse.json({ error: 'id/owner 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('plan_memos').delete().eq('id', id).eq('owner', owner)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
