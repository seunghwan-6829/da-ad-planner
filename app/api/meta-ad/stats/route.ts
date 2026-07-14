import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드별 누적 광고 수. { counts: { [target_id]: number }, total }
// ⚠️ 예전엔 select('target_id') 로 행을 모두 받아 세었는데, Supabase 는 요청당 기본 1000행이 최대라
//    데이터가 1000개를 넘으면 total·counts 가 1000에서 멈춰버렸다. → DB 집계(RPC)/exact count 로 교체.

// 브랜드별 광고 수(bootstrap 과 동일 방식). RPC 우선, 없으면 target_id 페이지네이션 폴백.
async function fetchCounts(): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabaseAdmin.rpc('am_ad_counts')
    if (!error && Array.isArray(data)) {
      const counts: Record<string, number> = {}
      for (const row of data as { target_id?: string; n?: number }[]) if (row.target_id) counts[row.target_id] = Number(row.n) || 0
      return counts
    }
  } catch {
    // RPC 미설치 → 폴백
  }
  // 폴백: 전체 개수를 구한 뒤 target_id 만 1000행씩 페이지네이션으로 모아 집계(캡 우회).
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
    for (const row of ((r.data as { target_id?: string }[]) ?? [])) {
      if (row.target_id) counts[row.target_id] = (counts[row.target_id] || 0) + 1
    }
  }
  return counts
}

export async function GET() {
  if (!supabaseAdmin) return NextResponse.json({ counts: {}, total: 0 })
  const [totalRes, counts] = await Promise.all([
    supabaseAdmin.from('am_ads').select('*', { count: 'exact', head: true }), // 전체 수집 광고(정확, 행 전송 없음)
    fetchCounts(),
  ])
  return NextResponse.json({ counts, total: totalRes.count || 0 })
}
