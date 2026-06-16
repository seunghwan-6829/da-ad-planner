import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 편집(EDIT) + on/off 토글. 보낸 필드만 갱신. (Next 15: params 는 Promise)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.label === 'string') patch.label = body.label.trim()
  if (typeof body.category === 'string') patch.category = body.category.trim() || '미분류'
  if (body.type === 'page' || body.type === 'keyword') patch.type = body.type
  if (typeof body.page_id === 'string') patch.page_id = body.page_id.trim() || null
  if (typeof body.query === 'string') patch.query = body.query.trim() || null
  if (typeof body.country === 'string') patch.country = body.country.trim() || 'KR'

  const { data, error } = await supabaseAdmin
    .from('am_targets')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 타겟 삭제 (쌓인 광고는 target_id 가 null 로 남음)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('am_targets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
