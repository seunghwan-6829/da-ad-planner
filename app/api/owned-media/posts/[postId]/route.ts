import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 콘텐츠 1개 전체(상세 모달 클릭 시). 캡션/AI분석/대본 등 무거운 필드 포함.
export async function GET(_req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const { data, error } = await supabaseAdmin.from('om_posts').select('*').eq('post_id', postId).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

// 메모 / AI분석 / 대본 / 스와이프(saved) 저장. 보낸 필드만 갱신.
export async function PATCH(req: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}

  if (typeof body.memo === 'string') patch.memo = body.memo
  if (typeof body.ai_analysis === 'string') patch.ai_analysis = body.ai_analysis
  if (typeof body.transcript === 'string') patch.transcript = body.transcript
  if (typeof body.saved === 'boolean') patch.saved = body.saved

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '변경할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin.from('om_posts').update(patch).eq('post_id', postId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
