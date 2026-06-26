import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 외부 공개용 단건 조회(로그인 불필요 — 클라이언트/프리랜서 공유 페이지가 사용).
// 내부 전용 필드(memo / ai_analysis / transcript)는 노출하지 않는다.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params
  const { data, error } = await supabaseAdmin
    .from('am_ads')
    .select(
      'library_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, landing_url, status'
    )
    .eq('library_id', libraryId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json(data)
}
