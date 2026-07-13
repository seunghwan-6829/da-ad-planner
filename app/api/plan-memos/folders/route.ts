import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 기획 메모 폴더 CRUD (owner=email 로 본인 것만).
//   GET    ?owner=          → 폴더 목록(정렬순) + 각 폴더 메모 수
//   POST   {owner, name, color?} → 새 폴더
//   PATCH  {id, owner, name?, color?} → 이름/색 변경
//   DELETE ?id=&owner=      → 폴더 삭제(메모는 미분류로 남김)

export async function GET(req: Request) {
  const owner = new URL(req.url).searchParams.get('owner') || ''
  if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 })
  const [foldersRes, countRes] = await Promise.all([
    supabaseAdmin.from('plan_memo_folders').select('*').eq('owner', owner).order('sort_order', { ascending: true }),
    supabaseAdmin.from('plan_memos').select('folder_id').eq('owner', owner),
  ])
  if (foldersRes.error) return NextResponse.json({ error: foldersRes.error.message }, { status: 500 })
  const counts: Record<string, number> = {}
  for (const r of (countRes.data as { folder_id: string | null }[]) || []) {
    const k = r.folder_id || '__none__'
    counts[k] = (counts[k] || 0) + 1
  }
  return NextResponse.json({ folders: foldersRes.data ?? [], counts })
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const owner = (b.owner || '').toString().trim()
  if (!owner) return NextResponse.json({ error: 'owner 필요' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('plan_memo_folders')
    .insert({ owner, name: (b.name || '새 폴더').toString().slice(0, 60), color: (b.color || '#6366F1').toString(), sort_order: Number(b.sort_order) || 0 })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, folder: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  const owner = (b.owner || '').toString().trim()
  if (!id || !owner) return NextResponse.json({ error: 'id/owner 필요' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (typeof b.name === 'string') patch.name = b.name.slice(0, 60)
  if (typeof b.color === 'string') patch.color = b.color
  if (b.sort_order !== undefined) patch.sort_order = Number(b.sort_order) || 0
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('plan_memo_folders').update(patch).eq('id', id).eq('owner', owner)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const owner = searchParams.get('owner')
  if (!id || !owner) return NextResponse.json({ error: 'id/owner 필요' }, { status: 400 })
  // 메모는 folder_id=null(미분류)로 남기고 폴더만 삭제 (on delete set null)
  const { error } = await supabaseAdmin.from('plan_memo_folders').delete().eq('id', id).eq('owner', owner)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
