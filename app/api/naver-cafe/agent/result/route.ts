import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { logActivity, scheduleNext } from '@/lib/naver/pacing'

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
    // ★ publishing 상태일 때만 flip → 중복 성공 보고(재시도)에도 활동 이중 카운트/간격 재-roll 방지(멱등).
    const { data: flipped } = await supabaseAdmin.from('nc_posts').update(patch).eq('id', id).eq('status', 'publishing').select('id')
    if (flipped?.length) {
      await logActivity(kind, cafeId) // 페이스 카운트 원천(성공 1회당 1행)
      const { pacing } = await getNaverSettings()
      await scheduleNext(pacing) // 다음 동작 허용 시각 랜덤 예약
    }
    // 이미 처리된 항목이면 조용히 ok(에이전트가 재시도를 멈추도록)
  } else {
    // ★ publishing 상태일 때만 실패 처리(중복/지연 실패 보고 무시).
    const { data: cur } = await supabaseAdmin.from('nc_posts').select('fail_count, status').eq('id', id).maybeSingle()
    if (cur?.status === 'publishing') {
      const fc = (((cur?.fail_count as number) || 0) + 1)
      await supabaseAdmin
        .from('nc_posts')
        .update({ status: fc >= MAX_FAIL ? 'failed' : 'approved', fail_count: fc, error: note || null, note: note || null, updated_at: nowISO })
        .eq('id', id)
        .eq('status', 'publishing')
      const { pacing } = await getNaverSettings()
      await scheduleNext(pacing) // 재시도도 사람처럼 간격(25~90분) — 20초 재시도 폭주 방지
    }
  }
  return NextResponse.json({ ok: true })
}
