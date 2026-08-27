import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMeta } from '@/lib/naver/pacing'
import { agentTokenConfigured } from '@/lib/naver/agent-auth'

export const dynamic = 'force-dynamic'

/* 에이전트 상태 상세 — 대시보드용.
   "왜 안 올라가지?"를 화면에서 바로 알 수 있게, 온라인 여부만이 아니라
   마지막 동작 / 다음 발행 예정 시각 / 연속 실패 / 자동 중단 여부까지 한 번에 준다.

   GET  → 상태
   POST → { resume: true } 자동 중단 해제(사람이 원인을 확인한 뒤 누른다) */

export async function GET() {
  const { data } = await supabaseAdmin
    .from('nc_agent')
    .select('last_seen, info, halted, halt_reason, halted_at, fail_streak, last_event, last_event_at')
    .eq('id', 1)
    .maybeSingle()

  const last = data?.last_seen ? new Date(data.last_seen).getTime() : 0
  const online = Date.now() - last < 90_000
  let nextActionAt: string | null = null
  try { nextActionAt = await getMeta('next_action_at') } catch {}

  return NextResponse.json({
    online,
    last_seen: data?.last_seen ?? null,
    info: data?.info ?? null,
    halted: !!data?.halted,
    halt_reason: data?.halt_reason ?? null,
    halted_at: data?.halted_at ?? null,
    fail_streak: Number(data?.fail_streak || 0),
    last_event: data?.last_event ?? null,
    last_event_at: data?.last_event_at ?? null,
    next_action_at: nextActionAt,
    /* 에이전트 엔드포인트 보호 여부 — NC_AGENT_TOKEN 이 비어 있으면 /api/naver-cafe/agent/* 가
       인터넷에 그대로 열린다(누구나 수집 데이터를 밀어넣거나 발행 작업을 가져갈 수 있다).
       코드에만 있던 위험이라 아무도 몰랐다 → 화면에서 보이게 내려준다. */
    token_configured: agentTokenConfigured(),
  })
}

export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}))
  if (!b.resume) return NextResponse.json({ error: 'resume 필요' }, { status: 400 })
  // 재개 = 중단 해제 + 연속 실패 카운터 초기화. 원인은 사람이 이미 확인했다고 본다.
  const { error } = await supabaseAdmin
    .from('nc_agent')
    .upsert({ id: 1, halted: false, halt_reason: null, halted_at: null, fail_streak: 0, last_event: '사람이 재개함', last_event_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
