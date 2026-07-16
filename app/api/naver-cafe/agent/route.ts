import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 로컬 발행 에이전트 온라인 상태 + 하트비트.
//   GET  → { online, last_seen }  (에이전트가 90초 내 하트비트 보냈으면 online)
//   POST → 하트비트 갱신(nc_agent.last_seen). X-Agent-Token(설정 시) 필요.

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true
  return req.headers.get('x-agent-token') === need
}

export async function GET() {
  const { data } = await supabaseAdmin.from('nc_agent').select('last_seen').eq('id', 1).maybeSingle()
  const last = data?.last_seen ? new Date(data.last_seen).getTime() : 0
  const online = Date.now() - last < 90_000
  return NextResponse.json({ online, last_seen: data?.last_seen ?? null })
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  await supabaseAdmin.from('nc_agent').upsert({ id: 1, last_seen: new Date().toISOString(), info: (b.info || 'pc-agent').toString().slice(0, 100) })
  return NextResponse.json({ ok: true })
}
