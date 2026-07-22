import { supabaseAdmin } from '@/lib/supabase-admin'

/* 발행 결과 알림 + 에이전트 상태(자동 중단) 관리.

   알림 경로 두 가지 — 설정된 것만 보낸다(둘 다 없으면 조용히 건너뛴다).
     · 메일   : Resend (RESEND_API_KEY + NC_NOTIFY_EMAIL)   ← 기본으로 쓰는 쪽
     · 슬랙   : NC_SLACK_WEBHOOK                              ← 선택
   알림은 부가 기능이지 발행의 전제조건이 아니다. 실패해도 절대 발행을 막지 않는다.
   또 어느 경로가 없더라도 nc_agent.last_event 에는 항상 남아 대시보드에서 볼 수 있다. */

const WEBHOOK = process.env.NC_SLACK_WEBHOOK || ''
const RESEND_KEY = process.env.RESEND_API_KEY || ''
const MAIL_TO = process.env.NC_NOTIFY_EMAIL || ''
// 도메인 인증 전에는 Resend 가 주는 기본 발신 주소를 쓴다(가입한 본인 주소로만 발송 가능).
const MAIL_FROM = process.env.NC_NOTIFY_FROM || '네이버 카페 자동화 <onboarding@resend.dev>'

export type NotifyResult = { email: 'sent' | 'skipped' | string; slack: 'sent' | 'skipped' | string }

/** 메일 본문 — 알림 텍스트를 그대로 읽기 좋게. 제목은 첫 줄을 쓴다. */
function toHtml(text: string): string {
  const [first, ...rest] = text.split('\n')
  const body = rest.map((l) => l.replace(/^· /, '')).filter(Boolean)
  return `<div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:14px;line-height:1.7;color:#111">
  <p style="font-size:16px;font-weight:700;margin:0 0 12px">${first}</p>
  ${body.map((l) => `<p style="margin:2px 0;color:#374151">${l}</p>`).join('')}
  <p style="margin-top:16px;font-size:12px;color:#9ca3af">컨텐츠 디벨로퍼 · 네이버 카페 자동화</p>
</div>`
}

async function sendEmail(text: string): Promise<string> {
  if (!RESEND_KEY || !MAIL_TO) return 'skipped'
  try {
    const subject = text.split('\n')[0].slice(0, 100)
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to: [MAIL_TO], subject, html: toHtml(text) }),
      signal: AbortSignal.timeout(8000),
    })
    if (r.ok) return 'sent'
    const detail = await r.text().catch(() => '')
    return `실패(HTTP ${r.status}) ${detail.slice(0, 160)}`
  } catch (e) {
    return `실패 ${String((e as Error).message || e).slice(0, 120)}`
  }
}

async function sendSlack(text: string): Promise<string> {
  if (!WEBHOOK) return 'skipped'
  try {
    const r = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    })
    return r.ok ? 'sent' : `실패(HTTP ${r.status})`
  } catch (e) {
    return `실패 ${String((e as Error).message || e).slice(0, 120)}`
  }
}

export async function notify(text: string): Promise<NotifyResult> {
  const [email, slack] = await Promise.all([sendEmail(text), sendSlack(text)])
  return { email, slack }
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
