import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드(페르소나) — 여러 발행처(카페 보드)를 묶는 상위 개념.
//   GET → 목록(발행처 수 포함) / POST {name, description, persona, default_topics, enabled}
//   PATCH {id, ...} / DELETE ?id=

// default_topics 는 배열 또는 콤마 문자열 모두 허용 → 배열로 정규화.
function normTopics(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  return []
}

export async function GET() {
  const { data: brands, error } = await supabaseAdmin.from('nc_brands').select('*').order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 발행처 수 집계(브랜드별)
  const { data: cafes } = await supabaseAdmin.from('nc_cafes').select('id, brand_id')
  const counts: Record<string, number> = {}
  for (const c of cafes || []) {
    const bid = (c as { brand_id?: string | null }).brand_id
    if (bid) counts[bid] = (counts[bid] || 0) + 1
  }
  const out = (brands || []).map((b) => ({ ...b, cafe_count: counts[b.id] || 0 }))
  return NextResponse.json(out)
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const name = (b.name || '').toString().trim()
  if (!name) return NextResponse.json({ error: '브랜드 이름이 필요해요.' }, { status: 400 })
  const row = {
    name,
    description: (b.description || '').toString(),
    persona: (b.persona || '').toString(),
    default_topics: normTopics(b.default_topics),
    enabled: b.enabled === false ? false : true,
  }
  const { data, error } = await supabaseAdmin.from('nc_brands').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, brand: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  for (const k of ['name', 'description', 'persona'] as const) {
    if (typeof b[k] === 'string') patch[k] = b[k]
  }
  if (b.default_topics !== undefined) patch.default_topics = normTopics(b.default_topics)
  if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await supabaseAdmin.from('nc_brands').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  // 발행처의 brand_id 는 FK on delete set null → 발행처는 남고 '미지정'이 됨.
  const { error } = await supabaseAdmin.from('nc_brands').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
