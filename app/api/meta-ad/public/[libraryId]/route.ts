import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 외부 공개용 단건 조회(로그인 불필요 — 클라이언트/프리랜서 공유 페이지가 사용).
// 메모(memo)만 내부 전용으로 제외하고, 메타데이터 / 링크 / AI분석 / 대본은 함께 노출.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params

  const cols =
    'library_id, target_id, page_name, started_on, first_seen_at, last_seen_at, ad_text, media_type, media_url, media_urls, poster_url, landing_url, status, ai_analysis'

  // transcript 컬럼이 없는(마이그레이션 전) 환경에서도 깨지지 않게 폴백.
  let { data: ad, error } = await supabaseAdmin
    .from('am_ads')
    .select(cols + ', transcript')
    .eq('library_id', libraryId)
    .single()
  if (error) {
    ;({ data: ad, error } = await supabaseAdmin
      .from('am_ads')
      .select(cols)
      .eq('library_id', libraryId)
      .single())
  }
  if (error || !ad) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // 브랜드명(폴더 라벨)과 국가는 am_targets 에서 보강(모달 헤더와 동일 표기).
  let brand: string | null = ad.page_name ?? null
  let country: string | null = null
  if (ad.target_id) {
    const { data: t } = await supabaseAdmin
      .from('am_targets')
      .select('label, country')
      .eq('id', ad.target_id)
      .single()
    if (t) {
      brand = t.label || brand
      country = t.country || null
    }
  }

  return NextResponse.json({ ...ad, brand, country })
}
