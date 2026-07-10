import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 로컬 발행 에이전트(내 PC의 publish-agent.bat) 온라인 여부.
//   에이전트가 30초마다 nc_agent.last_seen 을 갱신 → 90초 내면 온라인.
export async function GET() {
  const { data } = await supabaseAdmin.from('nc_agent').select('last_seen').eq('id', 1).single()
  const last = data?.last_seen ? new Date(data.last_seen).getTime() : 0
  const online = Date.now() - last < 90_000
  return NextResponse.json({ online, last_seen: data?.last_seen ?? null })
}
