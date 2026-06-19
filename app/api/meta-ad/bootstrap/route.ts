import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 페이지 진입용 통합 엔드포인트: targets + ads(목록 경량 컬럼) + 브랜드별 카운트를 한 번에.
// (기존 3개 호출 → 1개로 합쳐 서버리스 콜드스타트/왕복을 줄임)
export async function GET() {
  // saved 컬럼은 마이그레이션(meta-ad-swipe-schema.sql) 후 존재. 아직 없으면 빼고 다시 조회(페이지가 깨지지 않게).
  const baseCols =
    'library_id, target_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, landing_url, memo, status, ended_at, first_seen_at, last_seen_at'
  const adCols = `${baseCols}, saved`

  // 광고 전체를 로드: PostgREST 서버측 상한(db-max-rows, 보통 1000)은 .limit()으로 못 넘기므로
  // .range() 로 페이지네이션해 전부 가져온다(과거엔 500개로 잘려 "전체" 화면이 일부만 보였음).
  // 카운트(브랜드별 광고 수)도 이 전체에서 파생한다.
  async function fetchAllAds(): Promise<{ data: any[]; error: any }> {
    const PAGE = 1000
    const CAP = 5000 // 안전 상한(과도한 페이로드 방지). 넘어가면 추후 지연 로딩으로 전환.
    // saved 컬럼 존재 여부 1행으로 확인(마이그레이션 전이면 빼고 조회).
    let cols = adCols
    const probe = await supabaseAdmin.from('am_ads').select(adCols).limit(1)
    if (probe.error) cols = baseCols
    const all: any[] = []
    for (let from = 0; from < CAP; from += PAGE) {
      const { data, error } = await supabaseAdmin
        .from('am_ads')
        .select(cols)
        .order('first_seen_at', { ascending: false })
        .range(from, from + PAGE - 1)
      if (error) return { data: all, error }
      all.push(...((data as any[]) ?? []))
      if (!data || data.length < PAGE) break
    }
    return { data: all, error: null }
  }

  const [tRes, aRes, anRes] = await Promise.all([
    supabaseAdmin.from('am_targets').select('*').order('created_at', { ascending: false }),
    fetchAllAds(),
    // 저장된 AI 분석이 있는 소재 id만(가벼움) → 목록에 has_analysis 플래그로 표시
    supabaseAdmin.from('am_ads').select('library_id').not('ai_analysis', 'is', null),
  ])

  if (tRes.error) return NextResponse.json({ error: tRes.error.message }, { status: 500 })
  if (aRes.error) return NextResponse.json({ error: aRes.error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  for (const r of aRes.data ?? []) {
    if (!r.target_id) continue
    counts[r.target_id] = (counts[r.target_id] || 0) + 1
  }

  const analyzed = new Set((anRes && !anRes.error ? anRes.data ?? [] : []).map((r: any) => r.library_id))
  const ads = (aRes.data ?? []).map((a: any) => ({ ...a, has_analysis: analyzed.has(a.library_id) }))

  return NextResponse.json({ targets: tRes.data ?? [], ads, counts })
}
