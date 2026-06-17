import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 모달 열 때 지연 로딩: 목록에서 뺀 무거운 ai_analysis 만 단건 조회.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params
  const { data, error } = await supabaseAdmin
    .from('am_ads')
    .select('library_id, ai_analysis')
    .eq('library_id', libraryId)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 광고 메모 / AI 분석 저장. PATCH { memo?, ai_analysis? } — 보낸 필드만 갱신.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (typeof body.memo === 'string') patch.memo = body.memo
  if (typeof body.ai_analysis === 'string') patch.ai_analysis = body.ai_analysis

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '갱신할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('am_ads')
    .update(patch)
    .eq('library_id', libraryId)
    .select('library_id, memo, ai_analysis')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
