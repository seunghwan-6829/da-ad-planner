import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 발행처(카페 보드) — 브랜드(페르소나)에 속함. 기존 v2 카페 필드 유지 + 리뉴얼 발행처 필드 가산.
//   GET → 목록 / POST {name, cafe_url, ...발행처 필드} / PATCH {id, ...} / DELETE ?id=

// 마이그레이션(v3 컬럼 추가 SQL) 전 환경에서도 죽지 않게, 컬럼-미존재 에러면 해당 컬럼을 빼고 재시도.
const V3_COLS = [
  'brand_id', 'club_id', 'board_id', 'require_prefix', 'prefix', 'emphasis',
  'allow_post', 'allow_comment', 'auto_mode', 'interval_days', 'auto_publish', 'rules',
]
const V2_EXTRA = ['selling_point', 'daily_drafts']

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  return []
}

// 요청 바디 → nc_cafes 행(신규/수정 공통 필드 빌더)
function buildRow(b: Record<string, unknown>, forInsert: boolean): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  const strField = (k: string) => { if (typeof b[k] === 'string') row[k] = b[k] }
  for (const k of ['name', 'cafe_url', 'board_name', 'tone', 'topics', 'notes', 'plan_schedule', 'publish_slot', 'selling_point', 'club_id', 'board_id', 'prefix']) strField(k)
  if (b.brand_id !== undefined) row.brand_id = b.brand_id ? String(b.brand_id) : null
  if (b.emphasis !== undefined) row.emphasis = toArray(b.emphasis)
  if (b.rules !== undefined && typeof b.rules === 'object' && b.rules) row.rules = b.rules
  for (const k of ['require_prefix', 'allow_post', 'allow_comment', 'auto_mode', 'auto_publish', 'enabled']) {
    if (typeof b[k] === 'boolean') row[k] = b[k]
  }
  if (b.daily_drafts !== undefined) row.daily_drafts = Math.max(0, Math.min(10, Number(b.daily_drafts) || 0))
  if (b.interval_days !== undefined) row.interval_days = Math.max(1, Number(b.interval_days) || 3)
  return row
}

async function insertWithFallback(row: Record<string, unknown>) {
  let res = await supabaseAdmin.from('nc_cafes').insert(row).select().single()
  if (res.error && new RegExp([...V3_COLS, ...V2_EXTRA].join('|')).test(res.error.message)) {
    const stripped = { ...row }
    for (const c of [...V3_COLS, ...V2_EXTRA]) delete stripped[c]
    res = await supabaseAdmin.from('nc_cafes').insert(stripped).select().single()
  }
  return res
}

async function updateWithFallback(id: string, patch: Record<string, unknown>) {
  let res = await supabaseAdmin.from('nc_cafes').update(patch).eq('id', id)
  if (res.error && new RegExp([...V3_COLS, ...V2_EXTRA].join('|')).test(res.error.message)) {
    const stripped = { ...patch }
    for (const c of [...V3_COLS, ...V2_EXTRA]) delete stripped[c]
    if (Object.keys(stripped).length) res = await supabaseAdmin.from('nc_cafes').update(stripped).eq('id', id)
  }
  return res
}

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
  const row = buildRow(b, true)
  row.name = name
  row.cafe_url = cafeUrl
  const { data, error } = await insertWithFallback(row)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, cafe: data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const patch = buildRow(b, false)
  if (!Object.keys(patch).length) return NextResponse.json({ error: '변경 내용 없음' }, { status: 400 })
  const { error } = await updateWithFallback(id, patch)
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
