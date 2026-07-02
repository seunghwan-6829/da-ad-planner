import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 외부 공개용 단건 조회(로그인 불필요 — 공유 페이지가 사용). 메모(memo)만 내부 전용으로 제외.
export async function GET(_req: Request, { params }: { params: Promise<{ libraryId: string }> }) {
  const { libraryId } = await params

  const cols =
    'library_id, target_id, page_name, started_on, last_shown, first_seen_at, last_seen_at, ad_text, media_type, media_url, media_urls, poster_url, landing_url, source_url, format, status, ai_analysis, transcript'

  const { data: ad, error } = await supabaseAdmin.from('ga_ads').select(cols).eq('library_id', libraryId).single()
  if (error || !ad) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 광고주명(폴더 라벨)과 지역은 ga_targets 에서 보강.
  let brand: string | null = ad.page_name ?? null
  let country: string | null = null
  if (ad.target_id) {
    const { data: t } = await supabaseAdmin.from('ga_targets').select('label, country').eq('id', ad.target_id).single()
    if (t) {
      brand = t.label || brand
      country = t.country || null
    }
  }

  return NextResponse.json({ ...ad, brand, country })
}
