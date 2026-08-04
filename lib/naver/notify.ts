import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMeta, setMeta } from '@/lib/naver/pacing'

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

/** 발행 성공 — 전역·해당 카페의 연속 실패 카운터를 0으로 되돌린다. */
export async function onPublishSuccess(title: string, cafeName: string, url?: string | null, cafeId?: string | null): Promise<void> {
  try {
    await supabaseAdmin.from('nc_agent').upsert({ id: 1, fail_streak: 0, last_event: `발행 완료 · ${cafeName} · ${title}`.slice(0, 300), last_event_at: new Date().toISOString() })
  } catch {}
  if (cafeId) { try { await setMeta(`failstreak:${cafeId}`, '0') } catch {} }
  await notify(`✅ 네이버 카페 발행 완료\n· ${cafeName}\n· ${title}${url ? `\n· ${url}` : ''}`)
}

/* 발행 실패 처리 — "한 카페 문제로 전체가 멈추지 않게" 2단 구조.

   ① 카페별 연속 실패(failstreak:{cafeId}) ≥ 상한
      → 그 발행처만 자동 일시정지(nc_meta pause:{cafeId}) 하고 나머지 발행은 계속.
        대기 글은 반려되지 않고 그대로 남는다(재개하면 이어서 발행). 전역 카운터는 0으로(원인 규명됨).
   ② 전역 연속 실패 ≥ 상한 — ①이 먼저 걸리므로 여기 닿는 건 '여러 발행처에 걸친' 실패뿐
      → 로그인 만료·브라우저 고장 같은 전역 문제 신호 → 기존처럼 전체 자동 중단.

   @returns { halted: 전체 중단됨, cafePaused: 이 발행처만 일시정지됨 } */
export async function onPublishFailure(
  title: string,
  cafeName: string,
  reason: string,
  haltAfter: number,
  cafeId?: string | null,
): Promise<{ halted: boolean; cafePaused: boolean }> {
  const limit = haltAfter > 0 ? haltAfter : 3
  const nowISO = new Date().toISOString()

  // ① 카페별 연속 실패 → 그 카페만 일시정지
  if (cafeId) {
    let cafeStreak = 1
    try { cafeStreak = (Number(await getMeta(`failstreak:${cafeId}`)) || 0) + 1 } catch {}
    try { await setMeta(`failstreak:${cafeId}`, String(cafeStreak)) } catch {}

    if (cafeStreak >= limit) {
      const pauseReason = `연속 ${cafeStreak}회 실패로 자동 일시정지 — ${reason}`.slice(0, 200)
      try { await setMeta(`pause:${cafeId}`, pauseReason) } catch {}
      try { await setMeta(`failstreak:${cafeId}`, '0') } catch {}
      // 실패 원인이 이 카페로 규명됐으니 전역 카운터는 리셋 — 다른 카페 발행은 계속된다.
      try {
        await supabaseAdmin.from('nc_agent').upsert({
          id: 1,
          fail_streak: 0,
          last_event: `발행처 일시정지 · ${cafeName} — ${reason}`.slice(0, 300),
          last_event_at: nowISO,
        })
      } catch {}
      await notify(
        `⏸️ 발행처 자동 일시정지\n"${cafeName}"에서 연속 ${cafeStreak}회 실패해 이 발행처만 멈췄습니다.\n· ${title}\n· ${reason}\n\n다른 발행처 발행은 계속됩니다. 원인 확인 후 카페 화면에서 [재개]를 눌러주세요.`
      )
      return { halted: false, cafePaused: true }
    }
  }

  // ② 전역 연속 실패 — 같은 카페 연속이면 ①이 먼저 걸리므로, 여기 닿으면 여러 발행처에 걸친 실패다.
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
    last_event_at: nowISO,
  }
  if (shouldHalt) {
    patch.halted = true
    patch.halted_at = nowISO
    patch.halt_reason = `여러 발행처에 걸쳐 연속 ${streak}회 실패 — 로그인 만료·브라우저 문제일 수 있어 전체 중단 (${reason})`.slice(0, 300)
  }
  try { await supabaseAdmin.from('nc_agent').upsert(patch) } catch {}

  await notify(
    shouldHalt
      ? `🛑 네이버 카페 전체 자동 중단\n여러 발행처에 걸쳐 연속 ${streak}회 실패했습니다 — 로그인 만료나 브라우저 문제일 수 있어요.\n· 마지막: ${cafeName} · ${title}\n· ${reason}\n\n원인을 확인한 뒤 대시보드에서 [재개]를 눌러주세요.`
      : `⚠️ 네이버 카페 발행 실패(전역 ${streak}회 연속)\n· ${cafeName}\n· ${title}\n· ${reason}`
  )
  return { halted: shouldHalt, cafePaused: false }
}
