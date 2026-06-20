import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 쌓인 광고 조회.
//  ?target_id=...  특정 업체만
//  ?limit=...      개수(최대 1000)
//  ?offset=...     건너뛰기(.range 페이지네이션 — 백그라운드 전체 로드용)
//  ?light=1        본문(ad_text) 제외(경량). 전체 본문은 단일 조회([libraryId])에서.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetId = searchParams.get('target_id')
  const light = searchParams.get('light') === '1'
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 1000)
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0)

  // ai_analysis(JSON)·frames(배열)는 목록에서 제외(무거움) → 카드 클릭 시 따로 받는다.
  const lightCols =
    'library_id, target_id, page_name, started_on, media_type, media_url, media_urls, poster_url, landing_url, memo, status, ended_at, first_seen_at, last_seen_at'
  const baseCols = light ? lightCols : `${lightCols}, ad_text`

  const run = (cols: string) => {
    let q = supabaseAdmin
      .from('am_ads')
      .select(cols)
      .order('first_seen_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (targetId) q = q.eq('target_id', targetId)
    return q
  }

  // saved 컬럼은 마이그레이션 후 존재. 아직 없으면 빼고 재조회.
  let { data, error } = await run(`${baseCols}, saved`)
  if (error) ({ data, error } = await run(baseCols))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
