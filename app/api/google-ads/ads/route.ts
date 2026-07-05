import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 쌓인 광고 조회(메타 미러).
//  ?target_id=...  특정 광고주만
//  ?limit=...      개수(최대 1000)
//  ?offset=...     건너뛰기(백그라운드 전체 로드용)
//  ?light=1        본문(ad_text) 제외(경량)
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const targetId = searchParams.get('target_id')
  const light = searchParams.get('light') === '1'
  const limit = Math.min(Number(searchParams.get('limit') ?? 100), 1000)
  const offset = Math.max(Number(searchParams.get('offset') ?? 0), 0)

  // 그리드에 실제 필요한 컬럼만(대량 sync 경량화). 캐러셀(media_urls)·원본(source_url)·format 은 상세 모달에서 단건 조회.
  // landing_url 은 '소재 변주 그룹핑'이 전체 광고 기준으로 써서 남겨둠.
  const lightCols =
    'library_id, target_id, page_name, started_on, last_shown, media_type, media_url, poster_url, landing_url, memo, status, ended_at, first_seen_at, saved'
  const fullCols =
    'library_id, target_id, page_name, started_on, last_shown, media_type, media_url, media_urls, poster_url, landing_url, source_url, format, memo, status, ended_at, first_seen_at, last_seen_at, saved'
  const cols = light ? lightCols : `${fullCols}, ad_text`

  let q = supabaseAdmin
    .from('ga_ads')
    .select(cols)
    .order('first_seen_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (targetId) q = q.eq('target_id', targetId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
