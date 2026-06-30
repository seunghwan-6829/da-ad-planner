import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseCreatorUrl } from '@/lib/owned-media-url'

export const dynamic = 'force-dynamic'

// 편집 + on/off 토글 + 클라이언트 매핑 + 대분류. 보낸 필드만 갱신.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const patch: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.label === 'string') patch.label = body.label.trim()
  if (typeof body.category === 'string') patch.category = body.category.trim() || '미분류'
  // URL 수정 시 같은 파서로 재검증·정규화 → platform/handle/url 일관 갱신.
  if (typeof body.url === 'string' && body.url.trim()) {
    const parsed = parseCreatorUrl(body.url)
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    patch.url = parsed.url
    patch.platform = parsed.platform
    patch.handle = parsed.handle
  } else if (body.platform === 'youtube' || body.platform === 'instagram') {
    patch.platform = body.platform
  }
  // 클라이언트 매핑(여러 클라이언트 가능). uuid 문자열 배열만 허용.
  if (Array.isArray(body.client_ids)) {
    patch.client_ids = body.client_ids.filter((x: unknown) => typeof x === 'string' && x)
  }

  const { data, error } = await supabaseAdmin.from('om_creators').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 크리에이터 삭제 — 쌓인 콘텐츠는 FK on delete cascade 로 함께 정리됨.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { error } = await supabaseAdmin.from('om_creators').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
