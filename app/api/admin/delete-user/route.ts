import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 사용자 강퇴(완전 삭제). Auth 계정까지 지워 다시 로그인할 수 없게 한다.
// 보안: 호출자가 '관리자'인지 서버에서 검증(프론트만으로는 막히지 않으므로 필수).
export async function POST(req: Request) {
  // 1) 호출자 인증 (Authorization: Bearer <access_token>)
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) {
    return NextResponse.json({ error: '인증 토큰이 없습니다.' }, { status: 401 })
  }
  const { data: userData, error: uErr } = await supabaseAdmin.auth.getUser(token)
  const caller = userData?.user
  if (uErr || !caller) {
    return NextResponse.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 })
  }

  // 2) 관리자 검증
  const { data: callerProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('id', caller.id)
    .single()
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 사용자를 삭제할 수 있습니다.' }, { status: 403 })
  }

  // 3) 대상 검증
  const body = await req.json().catch(() => ({}))
  const userId = (body.userId || '').toString().trim()
  if (!userId) {
    return NextResponse.json({ error: 'userId 가 필요합니다.' }, { status: 400 })
  }
  if (userId === caller.id) {
    return NextResponse.json({ error: '자기 자신은 삭제할 수 없습니다.' }, { status: 400 })
  }

  // 4) 의존 데이터 정리(Auth 삭제를 막는 FK 방지) → Auth 계정 삭제 → 프로필 삭제(목록에서 사라지게)
  await supabaseAdmin.from('user_settings').delete().eq('user_id', userId)
  await supabaseAdmin.from('client_permissions').delete().eq('user_id', userId)

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId)
  if (delErr) {
    return NextResponse.json({ error: 'Auth 계정 삭제 실패: ' + delErr.message }, { status: 500 })
  }

  await supabaseAdmin.from('user_profiles').delete().eq('id', userId)

  return NextResponse.json({ ok: true })
}
