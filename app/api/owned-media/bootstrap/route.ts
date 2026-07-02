import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 페이지 진입용 통합 엔드포인트(메타광고 bootstrap 미러):
//  - creators (크리에이터 전체)
//  - counts   (크리에이터별 콘텐츠 수)
//  - posts    (최근 RECENT 개만 즉시) → 나머지는 클라이언트가 posts?light=1&offset 로 백그라운드 로드
const RECENT = 300

const LIGHT_COLS =
  'post_id, creator_id, creator_name, platform, post_url, media_type, media_url, media_urls, poster_url, posted_at, views, likes, comments, shares, saves, memo, saved, status, ended_at, first_seen_at, last_seen_at'

// 크리에이터별 콘텐츠 수.
async function fetchCounts(): Promise<Record<string, number>> {
  // 1) 빠른 경로: DB 집계 RPC(crawler-perf-rpc.sql 실행 후). 1쿼리·행 전송 없음.
  try {
    const { data, error } = await supabaseAdmin.rpc('om_post_counts')
    if (!error && Array.isArray(data)) {
      const counts: Record<string, number> = {}
      for (const row of data as { creator_id: string; n: number }[]) if (row.creator_id) counts[row.creator_id] = Number(row.n) || 0
      return counts
    }
  } catch {
    // RPC 미설치 → 폴백
  }
  // 2) 폴백(RPC 없을 때): 전체 creator_id 페이지네이션 집계.
  const { count } = await supabaseAdmin.from('om_posts').select('*', { count: 'exact', head: true })
  const total = count || 0
  const PAGE = 1000
  const reqs = []
  for (let from = 0; from < total; from += PAGE) {
    reqs.push(supabaseAdmin.from('om_posts').select('creator_id').range(from, from + PAGE - 1))
  }
  const results = await Promise.all(reqs)
  const counts: Record<string, number> = {}
  for (const r of results) {
    for (const row of ((r.data as { creator_id: string | null }[]) ?? [])) {
      if (row.creator_id) counts[row.creator_id] = (counts[row.creator_id] || 0) + 1
    }
  }
  return counts
}

export async function GET() {
  const recentCols = `${LIGHT_COLS}, caption`

  const [cRes, pRes, counts] = await Promise.all([
    supabaseAdmin.from('om_creators').select('*').order('created_at', { ascending: false }),
    supabaseAdmin.from('om_posts').select(recentCols).order('first_seen_at', { ascending: false }).limit(RECENT),
    fetchCounts(),
  ])

  if (cRes.error) return NextResponse.json({ error: cRes.error.message }, { status: 500 })
  if (pRes.error) return NextResponse.json({ error: pRes.error.message }, { status: 500 })

  // 캡션은 카드에 안 쓰이고 무거우니 미리보기 200자만. 전체는 상세 클릭 시 따로 받는다.
  const posts = (pRes.data ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    caption: p.caption ? String(p.caption).slice(0, 200) : p.caption,
  }))

  return NextResponse.json({ creators: cRes.data ?? [], posts, counts })
}
