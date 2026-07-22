import { NextResponse } from 'next/server'
import { notify } from '@/lib/naver/notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* 알림 설정 확인용 테스트 발송.
   환경변수를 넣고 나서 "진짜 오는지"를 발행 없이 확인할 수 있게 한다.
   어디로 갔는지/왜 안 갔는지를 그대로 돌려주므로 설정이 틀렸을 때 바로 알 수 있다. */

/** Resend 가 흔히 돌려주는 실패를 사람 말로 바꿔준다(원문만 보면 뭘 고쳐야 할지 알기 어렵다). */
function hintFor(err: string): string | null {
  if (!err || err === 'sent' || err === 'skipped') return null
  if (/only send testing emails to your own/i.test(err))
    return '도메인 인증 전에는 Resend 가입 주소로만 보낼 수 있어요. 받는 주소(NC_NOTIFY_EMAIL)를 가입 주소로 바꾸거나, 인증된 도메인 발신 주소를 NC_NOTIFY_FROM 에 넣어주세요.'
  if (/domain is not verified|not verified/i.test(err))
    return 'NC_NOTIFY_FROM 의 발신 도메인이 이 Resend 계정에 인증돼 있지 않아요. 인증된 도메인 주소로 바꾸거나 값을 지워 기본 발신 주소를 쓰세요.'
  if (/HTTP 401|invalid.*api.*key|unauthorized/i.test(err))
    return 'RESEND_API_KEY 가 틀렸거나 만료됐어요. Resend 대시보드에서 키를 다시 발급해 넣어주세요.'
  if (/HTTP 403/i.test(err)) return '이 API 키에 발송 권한이 없어요. Full access 키인지 확인해 주세요.'
  if (/HTTP 429/i.test(err)) return '발송 한도에 걸렸어요. 잠시 후 다시 시도해 주세요.'
  return null
}

export async function POST() {
  const res = await notify(
    '🔔 알림 테스트\n· 이 메일이 보이면 알림 설정이 정상입니다.\n· 앞으로 발행 완료 · 실패 · 자동 중단 · 등록 직전 확인 알림이 이 주소로 옵니다.'
  )
  const configured = {
    email: !!process.env.RESEND_API_KEY && !!process.env.NC_NOTIFY_EMAIL,
    slack: !!process.env.NC_SLACK_WEBHOOK,
    to: process.env.NC_NOTIFY_EMAIL || null,
    from: process.env.NC_NOTIFY_FROM || '(기본 발신 주소)',
  }
  return NextResponse.json({ ok: true, configured, result: res, hint: hintFor(res.email) })
}
