import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 큐 아이템(초안 → 승인/보관/반려 → 발행/실패). post/comment 공용.
//   GET ?status=&cafe_id=&kind=   → 목록(발행처 정보 포함, 최신순)
//   POST {cafe_id, kind?, title?, body, source_url?, status?, created_by}
//   PATCH {id, title?, body?, status?}  → 수정/승인/보관/반려/재시도
//   DELETE ?id=

// 필터/조회용(모든 상태). 웹이 직접 set 가능한 상태는 아래 WEB_SETTABLE 로 별도 제한.
const ALL_STATUS = ['draft', 'approved', 'queued', 'publishing', 'published', 'rejected', 'failed', 'saved']
// 웹(관리자 UI)에서 바꿀 수 있는 상태 — publishing/published/failed 는 에이전트 전용.
const WEB_SETTABLE = ['draft', 'approved', 'queued', 'rejected', 'saved']

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const cafeId = searchParams.get('cafe_id')
  const kind = searchParams.get('kind')
  let q = supabaseAdmin
    .from('nc_posts')
    .select('*, nc_cafes(id, name, cafe_url, board_name, brand_id)')
    .order('created_at', { ascending: false })
    .limit(500)
  if (status && ALL_STATUS.includes(status)) q = q.eq('status', status)
  if (cafeId) q = q.eq('cafe_id', cafeId)
  if (kind === 'post' || kind === 'comment') q = q.eq('kind', kind)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  const cafeId = (b.cafe_id || '').toString()
  const kind = b.kind === 'comment' ? 'comment' : 'post'
  const title = (b.title || '').toString().trim()
  const body = (b.body || '').toString()
  if (!cafeId) return NextResponse.json({ error: '발행처가 필요해요.' }, { status: 400 })
  if (kind === 'post' && !title) return NextResponse.json({ error: '제목이 필요해요.' }, { status: 400 })
  if (!body.trim()) return NextResponse.json({ error: '내용이 필요해요.' }, { status: 400 })

  const nowISO = new Date().toISOString()
  const reqStatus = WEB_SETTABLE.includes(b.status) ? b.status : 'draft'
  const row: Record<string, unknown> = {
    cafe_id: cafeId,
    kind,
    title,
    body,
    status: reqStatus,
    created_by: b.created_by ?? null,
  }
  if (typeof b.source_url === 'string') row.source_url = b.source_url
  if (reqStatus === 'approved' || reqStatus === 'queued') row.approved_at = nowISO

  // kind/source_url 컬럼 미존재(마이그레이션 전) 폴백
  let res = await supabaseAdmin
    .from('nc_posts')
    .insert(row)
    .select('*, nc_cafes(id, name, cafe_url, board_name, brand_id)')
    .single()
  if (res.error && /kind|source_url|approved_at/.test(res.error.message)) {
    for (const c of ['kind', 'source_url', 'approved_at']) delete row[c]
    res = await supabaseAdmin.from('nc_posts').insert(row).select('*, nc_cafes(id, name, cafe_url, board_name, brand_id)').single()
  }
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, post: res.data })
}

export async function PATCH(req: Request) {
  const b = await req.json().catch(() => ({}))
  // 단건(id) 또는 일괄(ids[]) — 일괄 승인/반려용. 최대 200건.
  const ids: string[] = Array.isArray(b.ids)
    ? b.ids.map((x: unknown) => String(x)).filter(Boolean).slice(0, 200)
    : (b.id ? [String(b.id)] : [])
  if (!ids.length) return NextResponse.json({ error: 'id 또는 ids 필요' }, { status: 400 })
  const id = ids[0]
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  /* 발행 전 미리보기 결정 — 'approve' 면 등록을 진행하도록 publishing 으로 되돌리고,
     'cancel' 이면 발행 대기(approved)로 되돌린다. 에이전트가 이 값을 폴링해서 움직인다. */
  if (b.preview_decision === 'approve' || b.preview_decision === 'cancel') {
    const decided = await supabaseAdmin
      .from('nc_posts')
      .update({
        preview_decision: b.preview_decision,
        status: b.preview_decision === 'approve' ? 'publishing' : 'approved',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'preview') // 미리보기 대기 상태에서만 (중복 클릭 방지)
      .select('id')
    if (decided.error) return NextResponse.json({ error: decided.error.message }, { status: 500 })
    if (!decided.data?.length) return NextResponse.json({ error: '이미 처리된 글이에요.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  /* 예약 발행 — not_before 이전에는 에이전트가 집어가지 않는다(기존 로직 그대로 활용).
     빈 문자열/null 이면 예약 해제. */
  if ('not_before' in b) {
    const v = b.not_before
    patch.not_before = v ? new Date(String(v)).toISOString() : null
  }
  if (typeof b.title === 'string') patch.title = b.title
  if (typeof b.body === 'string') patch.body = b.body
  if (typeof b.status === 'string') {
    if (!WEB_SETTABLE.includes(b.status)) return NextResponse.json({ error: '허용되지 않는 상태' }, { status: 400 })
    patch.status = b.status
    if (b.status === 'approved' || b.status === 'queued') {
      patch.approved_at = new Date().toISOString()
      patch.error = null // 재승인 시 이전 오류/실패 제거
      patch.fail_count = 0
    }
    // 대기 취소(초안 복귀) 시 '지금 발행' 예약도 함께 푼다 — 취소했는데 바로 나가면 안 되니까.
    if (b.status === 'draft' || b.status === 'saved' || b.status === 'rejected') patch.force_publish = false
  }
  /* 지금 바로 발행 — 페이스 게이트(활동시간·간격·상한)를 이 글 하나에 한해 건너뛴다.
     not_before 도 같이 풀어 예약 대기 상태를 해제한다. 승인 상태가 아니면 의미가 없으므로 함께 승인한다. */
  if (typeof b.force_publish === 'boolean') {
    patch.force_publish = b.force_publish
    if (b.force_publish) {
      patch.not_before = null
      patch.status = 'approved'
      patch.approved_at = new Date().toISOString()
      patch.error = null
      patch.fail_count = 0
    }
  }

  const run = () => supabaseAdmin.from('nc_posts').update(patch).in('id', ids)
  let res = await run()
  // force_publish 컬럼 미존재(마이그레이션 전) 폴백
  if (res.error && /force_publish/.test(res.error.message)) {
    delete patch.force_publish
    res = await run()
  }
  if (res.error && /approved_at|fail_count|not_before/.test(res.error.message)) {
    delete patch.approved_at; delete patch.fail_count; delete patch.not_before
    res = await run()
  }
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: ids.length })
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const { error } = await supabaseAdmin.from('nc_posts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
