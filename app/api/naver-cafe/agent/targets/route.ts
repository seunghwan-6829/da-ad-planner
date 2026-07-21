import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

/* 에이전트 자가검사(self-check.bat)용 발행처 목록.
   에이전트는 관리자 로그인 세션이 없으므로 /api/naver-cafe/cafes 를 못 읽는다.
   여기서는 검사에 필요한 최소 정보만(비밀 없음) 에이전트 토큰으로 내려준다. */

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true // 토큰 미설정(로컬) → 개방
  return req.headers.get('x-agent-token') === need
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 설정 오류' }, { status: 500 })

  const { data, error } = await supabaseAdmin
    .from('nc_cafes')
    .select('id, name, cafe_url, club_id, board_id, board_name, require_prefix, prefix, allow_post, allow_comment, enabled')
    .eq('enabled', true)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cafes: data || [] })
}
