import { supabaseAdmin } from '@/lib/supabase-admin'

/* 발행 결과 알림 + 에이전트 상태(자동 중단) 관리.

   알림은 슬랙 웹훅으로 보낸다. 환경변수 NC_SLACK_WEBHOOK 이 없으면 조용히 건너뛴다
   (기능이 죽지 않게 — 알림은 부가 기능이지 발행의 전제조건이 아니다).
   웹훅이 없어도 nc_agent.last_event 에 항상 남으므로 대시보드에서는 볼 수 있다. */

const WEBHOOK = process.env.NC_SLACK_WEBHOOK || ''

export async function notify(text: string): Promise<void> {
  if (!WEBHOOK) return
  try {
    await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    /* 알림 실패가 발행을 막으면 안 된다 */
  }
}

/** 대시보드에 보여줄 '최근 동작' 기록. 알림 실패와 무관하게 항상 남긴다. */
export async function recordEvent(text: string): Promise<void> {
  try {
    await supabaseAdmin.from('nc_agent').upsert({ id: 1, last_event: text.slice(0, 300), last_event_at: new Date().toISOString() })
  } catch {}
}

export type AgentState = { halted: boolean; halt_reason: string | null; fail_streak: number }

export async function getAgentState(): Promise<AgentState> {
  try {
    const { data } = await supabaseAdmin.from('nc_agent').select('halted, halt_reason, fail_streak').eq('id', 1).maybeSingle()
    return { halted: !!data?.halted, halt_reason: data?.halt_reason ?? null, fail_streak: Number(data?.fail_streak || 0) }
  } catch {
    return { halted: false, halt_reason: null, fail_streak: 0 }
  }
}

/** 발행 성공 — 연속 실패 카운터를 0으로 되돌린다. */
export async function onPublishSuccess(title: string, cafeName: string, url?: string | null): Promise<void> {
  try {
    await supabaseAdmin.from('nc_agent').upsert({ id: 1, fail_streak: 0, last_event: `발행 완료 · ${cafeName} · ${title}`.slice(0, 300), last_event_at: new Date().toISOString() })
  } catch {}
  await notify(`✅ 네이버 카페 발행 완료\n· ${cafeName}\n· ${title}${url ? `\n· ${url}` : ''}`)
}

/**
 * 발행 실패 — 연속 실패를 세고, 상한(haltAfter)에 닿으면 에이전트를 자동 중단한다.
 * 같은 실패를 무한히 반복하며 카페에 이상한 흔적을 남기는 것을 막는 장치다.
 * @returns 이번 실패로 중단됐는지
 */
export async function onPublishFailure(title: string, cafeName: string, reason: string, haltAfter: number): Promise<boolean> {
  let streak = 1
  try {
    const { data } = await supabaseAdmin.from('nc_agent').select('fail_streak').eq('id', 1).maybeSingle()
    streak = Number(data?.fail_streak || 0) + 1
  } catch {}

  const shouldHalt = haltAfter > 0 && streak >= haltAfter
  const patch: Record<string, unknown> = {
    id: 1,
    fail_streak: streak,
    last_event: `발행 실패(${streak}회 연속) · ${cafeName} · ${title} — ${reason}`.slice(0, 300),
    last_event_at: new Date().toISOString(),
  }
  if (shouldHalt) {
    patch.halted = true
    patch.halted_at = new Date().toISOString()
    patch.halt_reason = `연속 ${streak}회 실패로 자동 중단 — ${reason}`.slice(0, 300)
  }
  try { await supabaseAdmin.from('nc_agent').upsert(patch) } catch {}

  await notify(
    shouldHalt
      ? `🛑 네이버 카페 자동 중단\n연속 ${streak}회 실패해서 발행을 멈췄습니다.\n· ${cafeName}\n· ${title}\n· ${reason}\n\n원인을 확인한 뒤 대시보드에서 [재개]를 눌러주세요.`
      : `⚠️ 네이버 카페 발행 실패(${streak}회 연속)\n· ${cafeName}\n· ${title}\n· ${reason}`
  )
  return shouldHalt
}
