import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { tokenEnvName, tokenFor } from '@/lib/threads/api'

export const dynamic = 'force-dynamic'

// 쓰레드 브랜드(페르소나). id = 슬러그(토큰 환경변수명에 사용).
//   GET → 목록(+토큰 등록여부, 카테고리 수) / POST / PATCH / DELETE ?id=

function slugify(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}
function normSlots(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []
  return arr.map((x) => String(x).trim()).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).slice(0, 12)
}

export async function GET() {
  const { data: brands, error } = await supabaseAdmin.from('th_brands').select('*').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { data: cats } = await supabaseAdmin.from('th_categories').select('id, brand_id')
  const counts: Record<string, number> = {}
  for (const c of cats || []) { const b = (c as { brand_id: string }).brand_id; counts[b] = (counts[b] || 0) + 1 }
  const out = (brands || []).map((b) => ({
    ...b,
    category_count: counts[b.id] || 0,
    token_env: tokenEnvName(b.id),
    token_ready: !!tokenFor(b.id),
  }))
  return NextResponse.json(out)
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const name = (b.name || '').toString().trim()
  if (!name) return NextResponse.json({ error: '브랜드 이름이 필요해요.' }, { status: 400 })
  let id = slugify(b.id || '') || slugify(name) || `brand_${Math.random().toString(36).slice(2, 8)}`
  const row = {
    id,
    name,
    persona: (b.persona || '').toString(),
    mode: b.mode === 'publish' ? 'publish' : 'collect',
    timezone: (b.timezone || 'Asia/Seoul').toString(),
    publish_slots: normSlots(b.publish_slots),
    max_posts_per_day: Math.max(1, Math.min(50, Number(b.max_posts_per_day) || 3)),
    enabled: b.enabled === false ? false : true,
  }
  let res = await supabaseAdmin.from('th_brands').insert(row).select().single()
  if (res.error && /duplicate|unique/i.test(res.error.message)) {
    id = `${id}_${Math.random().toString(36).slice(2, 5)}`
    res = await supabaseAdmin.from('th_brands').insert({ ...row, id }).select().single()
  }
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, brand: { ...res.data, token_env: tokenEnvName(id) } })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (typeof b.name === 'string') patch.name = b.name
  if (typeof b.persona === 'string') patch.persona = b.persona
  if (b.mode === 'publish' || b.mode === 'collect') patch.mode = b.mode
  if (typeof b.timezone === 'string') patch.timezone = b.timezone
  if (b.publish_slots !== undefined) patch.publish_slots = normSlots(b.publish_slots)
  if (b.max_posts_per_day !== undefined) patch.max_posts_per_day = Math.max(1, Math.min(50, Number(b.max_posts_per_day) || 3))
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_brands').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('th_brands').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
