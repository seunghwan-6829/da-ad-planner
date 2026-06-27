import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 사용자 활동(마지막 로그인/가입일). Auth 계정의 last_sign_in_at 은 admin API 로만 조회 가능.
// 보안: 관리자만.
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return NextResponse.json({ error: '인증 토큰이 없습니다.' }, { status: 401 })

  const { data: userData, error: uErr } = await supabaseAdmin.auth.getUser(token)
  const caller = userData?.user
  if (uErr || !caller) return NextResponse.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 })

  const { data: profile } = await supabaseAdmin.from('user_profiles').select('role').eq('id', caller.id).single()
  if (profile?.role !== 'admin') return NextResponse.json({ error: '관리자 전용입니다.' }, { status: 403 })

  // 전체 사용자 활동 수집(팀 규모 가정 → 1페이지로 충분)
  const activity: Record<string, { last_sign_in_at: string | null; created_at: string | null; email: string | null }> = {}
  try {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    for (const u of data.users) {
      activity[u.id] = {
        last_sign_in_at: u.last_sign_in_at ?? null,
        created_at: u.created_at ?? null,
        email: u.email ?? null,
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '조회 실패' }, { status: 500 })
  }

  return NextResponse.json({ activity })
}
