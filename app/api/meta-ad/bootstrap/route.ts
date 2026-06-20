import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 페이지 진입용 통합 엔드포인트(빠른 첫 화면용):
//  - targets (브랜드 전체)
//  - counts  (브랜드별 광고 수 — target_id 만 병렬로 모아 집계)
//  - ads     (최근 RECENT 개만 즉시) → 나머지는 클라이언트가 ads?light=1&offset 로 백그라운드 로드
// 데이터가 아무리 쌓여도 첫 응답 크기가 일정하게 유지된다.
const RECENT = 300

const LIGHT_COLS =
  'library_id, target_id, page_name, started_on, media_type, media_url, media_urls, poster_url, landing_url, memo, status, ended_at, first_seen_at, last_seen_at'

// 브랜드별 광고 수.
async function fetchCounts(): Promise<Record<string, number>> {
  // 1) 빠른 경로: DB 집계 함수(RPC). meta-ad-counts-rpc.sql 실행 후 동작(1쿼리·서버측 GROUP BY·행 전송 없음 → 데이터 양과 무관하게 빠름).
  try {
    const { data, error } = await supabaseAdmin.rpc('am_ad_counts')
    if (!error && Array.isArray(data)) {
      const counts: Record<string, number> = {}
      for (const row of data as any[]) if (row.target_id) counts[row.target_id] = Number(row.n) || 0
      return counts
    }
  } catch {
    // RPC 미설치 → 폴백
  }
  // 2) 폴백(RPC 없을 때): 총 개수를 구한 뒤 target_id 만 병렬 페이지네이션으로 모아 집계.
  const { count } = await supabaseAdmin.from('am_ads').select('*', { count: 'exact', head: true })
  const total = count || 0
  const PAGE = 1000
  const reqs = []
  for (let from = 0; from < total; from += PAGE) {
    reqs.push(supabaseAdmin.from('am_ads').select('target_id').range(from, from + PAGE - 1))
  }
  const results = await Promise.all(reqs)
  const counts: Record<string, number> = {}
  for (const r of results) {
    for (const row of ((r.data as any[]) ?? [])) {
      if (row.target_id) counts[row.target_id] = (counts[row.target_id] || 0) + 1
    }
  }
  return counts
}

export async function GET() {
  const recentCols = `${LIGHT_COLS}, ad_text` // 최근 것은 본문도(미리보기용 200자로 잘라 전송)

  const [tRes, aRes, anRes, counts] = await Promise.all([
    supabaseAdmin.from('am_targets').select('*').order('created_at', { ascending: false }),
    supabaseAdmin
      .from('am_ads')
      .select(`${recentCols}, saved`)
      .order('first_seen_at', { ascending: false })
      .limit(RECENT),
    // 저장된 AI 분석이 있는 소재 id만(가벼움) → 목록에 has_analysis 플래그로 표시
    supabaseAdmin.from('am_ads').select('library_id').not('ai_analysis', 'is', null),
    fetchCounts(),
  ])

  if (tRes.error) return NextResponse.json({ error: tRes.error.message }, { status: 500 })

  // saved 컬럼은 마이그레이션(meta-ad-swipe-schema.sql) 후 존재. 없으면 빼고 재조회.
  let rows = aRes.data
  if (aRes.error) {
    const retry = await supabaseAdmin
      .from('am_ads')
      .select(recentCols)
      .order('first_seen_at', { ascending: false })
      .limit(RECENT)
    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 })
    rows = retry.data
  }

  const analyzed = new Set((anRes && !anRes.error ? anRes.data ?? [] : []).map((r: any) => r.library_id))
  // 본문(ad_text)은 카드엔 안 쓰이고 무거우니 미리보기 200자만. 전체 본문은 상세 클릭 시 openDetail 이 따로 받는다.
  const ads = (rows ?? []).map((a: any) => ({
    ...a,
    ad_text: a.ad_text ? String(a.ad_text).slice(0, 200) : a.ad_text,
    has_analysis: analyzed.has(a.library_id),
  }))

  return NextResponse.json({ targets: tRes.data ?? [], ads, counts })
}
