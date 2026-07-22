import { NextResponse } from 'next/server'
import { notify } from '@/lib/naver/notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* 알림 설정 확인용 테스트 발송.
   환경변수를 넣고 나서 "진짜 오는지"를 발행 없이 확인할 수 있게 한다.
   어디로 갔는지/왜 안 갔는지를 그대로 돌려주므로 설정이 틀렸을 때 바로 알 수 있다. */

export async function POST() {
  const res = await notify(
    '🔔 알림 테스트\n· 이 메일이 보이면 알림 설정이 정상입니다.\n· 앞으로 발행 완료 · 실패 · 자동 중단 · 등록 직전 확인 알림이 이 주소로 옵니다.'
  )
  const configured = {
    email: !!process.env.RESEND_API_KEY && !!process.env.NC_NOTIFY_EMAIL,
    slack: !!process.env.NC_SLACK_WEBHOOK,
    to: process.env.NC_NOTIFY_EMAIL || null,
  }
  return NextResponse.json({ ok: true, configured, result: res })
}
