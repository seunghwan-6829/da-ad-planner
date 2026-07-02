import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 페이지 진입용 통합 엔드포인트(메타광고 bootstrap 미러):
//  - targets (광고주 전체)
//  - counts  (광고주별 광고 수)
//  - ads     (최근 RECENT 개만 즉시) → 나머지는 클라이언트가 ads?light=1&offset 로 백그라운드 로드
const RECENT = 300

const LIGHT_COLS =
  'library_id, target_id, page_name, started_on, last_shown, media_type, media_url, media_urls, poster_url, landing_url, source_url, format, memo, status, ended_at, first_seen_at, last_seen_at'

// 광고주별 광고 수.
async function fetchCounts(): Promise<Record<string, number>> {
  // 1) 빠른 경로: DB 집계 RPC(crawler-perf-rpc.sql 실행 후). 1쿼리·행 전송 없음 → 데이터 양과 무관하게 빠름.
  try {
    const { data, error } = await supabaseAdmin.rpc('ga_ad_counts')
    if (!error && Array.isArray(data)) {
      const counts: Record<string, number> = {}
      for (const row of data as { target_id: string; n: number }[]) if (row.target_id) counts[row.target_id] = Number(row.n) || 0
      return counts
    }
  } catch {
    // RPC 미설치 → 폴백
  }
  // 2) 폴백(RPC 없을 때): 전체 target_id 페이지네이션 집계.
  const { count } = await supabaseAdmin.from('ga_ads').select('*', { count: 'exact', head: true })
  const total = count || 0
  const PAGE = 1000
  const reqs = []
  for (let from = 0; from < total; from += PAGE) {
    reqs.push(supabaseAdmin.from('ga_ads').select('target_id').range(from, from + PAGE - 1))
  }
  const results = await Promise.all(reqs)
  const counts: Record<string, number> = {}
  for (const r of results) {
    for (const row of ((r.data as { target_id: string | null }[]) ?? [])) {
      if (row.target_id) counts[row.target_id] = (counts[row.target_id] || 0) + 1
    }
  }
  return counts
}

export async function GET() {
  const recentCols = `${LIGHT_COLS}, ad_text` // 최근 것은 본문도(미리보기 200자)

  const [tRes, aRes, counts] = await Promise.all([
    supabaseAdmin.from('ga_targets').select('*').order('created_at', { ascending: false }),
    supabaseAdmin
      .from('ga_ads')
      .select(`${recentCols}, saved`)
      .order('first_seen_at', { ascending: false })
      .limit(RECENT),
    fetchCounts(),
  ])

  if (tRes.error) return NextResponse.json({ error: tRes.error.message }, { status: 500 })
  if (aRes.error) return NextResponse.json({ error: aRes.error.message }, { status: 500 })

  // 본문은 카드에 안 쓰이고 무거우니 미리보기 200자만. 전체 본문은 상세 클릭 시 따로.
  const ads = (aRes.data ?? []).map((a: Record<string, unknown>) => ({
    ...a,
    ad_text: a.ad_text ? String(a.ad_text).slice(0, 200) : a.ad_text,
  }))

  return NextResponse.json({ targets: tRes.data ?? [], ads, counts })
}
