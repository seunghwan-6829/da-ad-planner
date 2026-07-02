import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 편집 + on/off 토글 + 클라이언트 매핑. 보낸 필드만 갱신. (Next 15: params 는 Promise)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.label === 'string') patch.label = body.label.trim()
  if (typeof body.category === 'string') patch.category = body.category.trim() || '미분류'
  if (typeof body.country === 'string') patch.country = body.country.trim() || 'KR'
  // 투명성 센터 URL/AR ID 수정
  if (typeof body.url === 'string' && body.url.trim()) {
    const ar = body.url.match(/\/advertiser\/(AR[0-9A-Za-z_-]+)/) || body.url.trim().match(/^(AR[0-9A-Za-z_-]+)$/)
    if (!ar) return NextResponse.json({ error: '광고주 URL(…/advertiser/AR…)을 인식하지 못했어요.' }, { status: 400 })
    patch.advertiser_id = ar[1]
    const region = body.url.match(/[?&]region=([A-Za-z]{2,20})/)
    if (region) patch.country = region[1].toUpperCase()
  }
  // 클라이언트 매핑(여러 클라이언트 가능)
  if (Array.isArray(body.client_ids)) {
    patch.client_ids = body.client_ids.filter((x: unknown) => typeof x === 'string' && x)
  }

  const { data, error } = await supabaseAdmin.from('ga_targets').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 광고주 삭제 — 쌓인 광고는 FK on delete cascade 로 함께 정리.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('ga_targets').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
