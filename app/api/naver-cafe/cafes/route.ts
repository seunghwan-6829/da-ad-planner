import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 발행처(카페 보드) — 브랜드(페르소나)에 속함. 기존 v2 카페 필드 유지 + 리뉴얼 발행처 필드 가산.
//   GET → 목록 / POST {name, cafe_url, ...발행처 필드} / PATCH {id, ...} / DELETE ?id=

// 마이그레이션(v3 컬럼 추가 SQL) 전 환경에서도 죽지 않게, 컬럼-미존재 에러면 해당 컬럼을 빼고 재시도.
const V3_COLS = [
  'brand_id', 'club_id', 'board_id', 'require_prefix', 'prefix', 'emphasis',
  'allow_post', 'allow_comment', 'auto_mode', 'interval_days', 'auto_publish', 'rules', 'post_style',
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
  for (const k of ['cafe_url', 'board_name', 'tone', 'topics', 'notes', 'plan_schedule', 'publish_slot', 'selling_point', 'club_id', 'board_id', 'prefix', 'post_style']) strField(k)
  // 발행처 이름: 빈 값으로 덮어써지지 않게(수정 중 실수로 지움 방지) — 공백 아닌 문자열일 때만 반영. POST 는 아래에서 검증된 name 을 따로 세팅.
  if (typeof b.name === 'string' && b.name.trim()) row.name = b.name.trim()
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
  // 자동 일시정지 상태(nc_meta pause:{cafeId})를 겹쳐 UI 가 ⏸ 배지·[재개] 버튼을 보여줄 수 있게.
  let pauseMap = new Map<string, string>()
  try {
    const { data: metas } = await supabaseAdmin.from('nc_meta').select('key, value').like('key', 'pause:%')
    pauseMap = new Map((metas ?? []).map((m) => [String((m as { key: string }).key).slice('pause:'.length), String((m as { value?: string }).value || '')]))
  } catch {}
  return NextResponse.json((data ?? []).map((c) => ({ ...c, paused_reason: pauseMap.get(String((c as { id: string }).id)) ?? null })))
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
  // [재개] — 연속 실패로 자동 일시정지된 발행처를 다시 살린다(정지 사유·실패 카운터 삭제).
  if (b.resume_pause === true) {
    const { error } = await supabaseAdmin.from('nc_meta').delete().in('key', [`pause:${id}`, `failstreak:${id}`])
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, resumed: true })
  }
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
