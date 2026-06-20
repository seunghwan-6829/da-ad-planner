import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 모달 열 때 지연 로딩: 목록(경량)에서 뺀 본문(ad_text)·AI분석(ai_analysis)·대본(transcript)을 단건 조회.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params
  // transcript 컬럼이 아직 없는(마이그레이션 전) 환경에서도 깨지지 않게 폴백.
  let { data, error } = await supabaseAdmin
    .from('am_ads')
    .select('library_id, ai_analysis, ad_text, transcript')
    .eq('library_id', libraryId)
    .single()
  if (error) {
    ;({ data, error } = await supabaseAdmin
      .from('am_ads')
      .select('library_id, ai_analysis, ad_text')
      .eq('library_id', libraryId)
      .single())
  }
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
  if (typeof body.saved === 'boolean') patch.saved = body.saved

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
