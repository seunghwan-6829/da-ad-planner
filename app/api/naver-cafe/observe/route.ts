import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMeta } from '@/lib/naver/pacing'

/* 카페 관찰 데이터 조회(웹 UI 용, 보호 라우트 — /api/naver-cafe/* 는 middleware 가 지킨다).
   GET ?cafe_id= → 그 카페에서 수집된 최근 글 제목 목록 + 마지막 관찰 시각 */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const cafeId = searchParams.get('cafe_id')
  if (!cafeId) return NextResponse.json({ error: 'cafe_id 필요' }, { status: 400 })

  // select('*') — 인기글 컬럼(views/comments/is_popular) 마이그레이션 전이어도 에러 없이 동작.
  const { data, error } = await supabaseAdmin
    .from('nc_cafe_posts')
    .select('*')
    .eq('cafe_id', cafeId)
    .order('last_seen', { ascending: false })
    .limit(30)
  if (error) return NextResponse.json({ ok: true, items: [], tableMissing: true })

  const observedAt = await getMeta(`observe:${cafeId}`)
  return NextResponse.json({ ok: true, items: data ?? [], observed_at: observedAt })
}
