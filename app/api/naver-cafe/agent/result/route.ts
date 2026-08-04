import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { logActivity, scheduleNext } from '@/lib/naver/pacing'
import { onPublishSuccess, onPublishFailure } from '@/lib/naver/notify'

export const dynamic = 'force-dynamic'

// 발행 결과 보고(리뉴얼 server.api_agent_result 포팅).
//   요청: {id, ok, kind?, cafe_id?, note?, published_url?}
//   ok=true  → published + published_at, 활동 로그(페이스 카운트), 다음 랜덤 간격 예약, (published_url 시) 24h 반응 예약
//   ok=false → fail_count++; >=3 → failed 격리, 아니면 approved 복귀
const MAX_FAIL = 3

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true
  return req.headers.get('x-agent-token') === need
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const id = (b.id ?? '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const ok = !!b.ok
  const kind: string = b.kind === 'comment' ? 'comment' : 'post'
  const cafeId = (b.cafe_id || '').toString() || null
  const note = (b.note || '').toString().slice(0, 500)
  const nowISO = new Date().toISOString()

  if (ok) {
    const patch: Record<string, unknown> = {
      status: 'published',
      published_at: nowISO,
      updated_at: nowISO,
      note: note || null,
      error: null,
      fail_count: 0,
    }
    if (typeof b.published_url === 'string' && b.published_url) {
      patch.published_url = b.published_url
      patch.track_due_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString() // 발행 +24h → 반응 측정
    }
    /* ★ 이미 published 인 경우만 건너뛴다(중복 성공 보고 멱등).
       publishing 으로 한정하면, 그 사이 사람이 대시보드에서 '되돌리기'를 눌렀거나 상태가 바뀌었을 때
       **실제로 올라간 글의 URL·발행시각이 통째로 버려진다** — 그러면 나중에 다시 승인돼 이중 발행된다. */
    const { data: flipped } = await supabaseAdmin
      .from('nc_posts')
      .update(patch)
      .eq('id', id)
      .neq('status', 'published')
      .select('id, title, nc_cafes(name)')
    if (flipped?.length) {
      await logActivity(kind, cafeId) // 페이스 카운트 원천(성공 1회당 1행)
      const { pacing } = await getNaverSettings()
      await scheduleNext(pacing) // 다음 동작 허용 시각 랜덤 예약
      // 알림 + 연속 실패 카운터 초기화
      const row = flipped[0] as { title?: string; nc_cafes?: { name?: string } }
      await onPublishSuccess(row.title || '', row.nc_cafes?.name || '', typeof b.published_url === 'string' ? b.published_url : null, cafeId)

      /* 이번에 실제로 쓰인 게시판 이름을 발행처 설정에 채운다(비어 있을 때만).
         한 번 성공하면 다음부터는 이름으로 정확히 고를 수 있어, 새 카페를 추가해도 저절로 자리를 잡는다. */
      const detected = (b.board_name || '').toString().trim().slice(0, 60)
      if (detected && cafeId) {
        try {
          const { data: cafe } = await supabaseAdmin.from('nc_cafes').select('board_name').eq('id', cafeId).maybeSingle()
          if (cafe && !cafe.board_name) await supabaseAdmin.from('nc_cafes').update({ board_name: detected }).eq('id', cafeId)
        } catch {}
      }
    }
    // 이미 처리된 항목이면 조용히 ok(에이전트가 재시도를 멈추도록)
  } else {
    /* ★ 처리 중(publishing) 이거나 등록 직전 확인 대기(preview) 일 때만 실패 처리.
       preview 를 빼면, 확인 시간이 지나 취소된 글이 preview 상태로 영원히 남아
       아무도 집어가지 못한다(next 는 approved/queued 만 본다). */
    const { data: cur } = await supabaseAdmin.from('nc_posts').select('fail_count, status, title, nc_cafes(name)').eq('id', id).maybeSingle()
    if (cur?.status === 'publishing' || cur?.status === 'preview') {
      const fc = (((cur?.fail_count as number) || 0) + 1)
      await supabaseAdmin
        .from('nc_posts')
        .update({ status: fc >= MAX_FAIL ? 'failed' : 'approved', fail_count: fc, error: note || null, note: note || null, preview_decision: null, updated_at: nowISO })
        .eq('id', id)
        .in('status', ['publishing', 'preview'])
      const { pacing, options } = await getNaverSettings()
      await scheduleNext(pacing) // 재시도도 사람처럼 간격(25~90분) — 20초 재시도 폭주 방지
      /* 실패 처리 2단: 같은 카페 연속 실패 → 그 발행처만 자동 일시정지(나머지는 계속),
         여러 발행처에 걸친 연속 실패(로그인 만료류) → 기존처럼 전체 중단. */
      const cafeName = (cur as { nc_cafes?: { name?: string } }).nc_cafes?.name || ''
      const { halted, cafePaused } = await onPublishFailure(cur.title || '', cafeName, note || '알 수 없는 오류', options.halt_after_failures, cafeId)
      return NextResponse.json({ ok: true, halted, cafePaused })
    }
  }
  return NextResponse.json({ ok: true })
}
