import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { authOk } from '@/lib/naver/agent-auth'

export const dynamic = 'force-dynamic'

// 24h 반응 측정 큐(에이전트가 로그인 브라우저로 방문해 조회/좋아요/댓글 수집).
//   GET  → 측정 대기 목록[{id, published_url, title}] (track_due_at 지난 순, 최대 N)
//   POST {id, views, likes, comments} → 측정 결과 기록(tracked_at). X-Agent-Token(설정 시) 필요.


export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const { data } = await supabaseAdmin
    .from('nc_posts')
    .select('id, published_url, title')
    .not('published_url', 'is', null)
    .is('tracked_at', null)
    .lte('track_due_at', new Date().toISOString())
    .order('track_due_at', { ascending: true })
    .limit(5)
  return NextResponse.json(data ?? [])
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const id = (b.id ?? '').toString()
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })
  const num = (v: unknown) => (v == null || v === '' ? null : Number(v))
  await supabaseAdmin
    .from('nc_posts')
    .update({ views: num(b.views), likes: num(b.likes), comments: num(b.comments), tracked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
  return NextResponse.json({ ok: true })
}
