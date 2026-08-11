import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMeta } from '@/lib/naver/pacing'

/* 카페 관찰 데이터 조회(웹 UI 용, 보호 라우트 — /api/naver-cafe/* 는 middleware 가 지킨다).
   GET ?cafe_id= → 수집된 글 목록(판정 포함) + 판정별 개수 + 마지막 관찰 시각
   ⚠️ 광고로 판정된 글도 지우지 않고 그대로 내려준다 — 사장님이 무엇이 걸러졌는지 볼 수 있어야 하므로. */
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const cafeId = searchParams.get('cafe_id')
  if (!cafeId) return NextResponse.json({ error: 'cafe_id 필요' }, { status: 400 })

  // select('*') — 확장 컬럼(판정·증가폭) 마이그레이션 전이어도 에러 없이 동작.
  const { data, error } = await supabaseAdmin
    .from('nc_cafe_posts')
    .select('*')
    .eq('cafe_id', cafeId)
    .order('last_seen', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ ok: true, items: [], summary: null, tableMissing: true })

  const rows = (data as Record<string, unknown>[]) ?? []
  const summary = { keep: 0, drop: 0, ad: 0, noise: 0, unrated: 0, pending: 0, total: rows.length }
  const items = rows.map((r) => {
    const v = String(r.verdict ?? 'pending')
    const key = (['keep', 'drop', 'ad', 'noise', 'unrated'] as const).find((k) => k === v) ?? 'pending'
    summary[key] += 1
    return {
      title: String(r.title ?? ''),
      first_seen: String(r.first_seen ?? r.last_seen ?? ''),
      // UI 가 new Date() 로 바로 쓰므로 항상 문자열로 내려준다(null 이면 Invalid Date 표시됨)
      last_seen: String(r.last_seen ?? r.first_seen ?? ''),
      views: typeof r.views === 'number' ? r.views : null,
      comments: typeof r.comments === 'number' ? r.comments : null,
      views_delta: typeof r.views_delta === 'number' ? r.views_delta : null,
      comments_delta: typeof r.comments_delta === 'number' ? r.comments_delta : null,
      is_popular: r.is_popular === true,
      verdict: key,
      verdict_reason: r.verdict_reason ? String(r.verdict_reason) : null,
      score: typeof r.score === 'number' ? r.score : null,
    }
  })

  const observedAt = await getMeta(`observe:${cafeId}`)
  return NextResponse.json({ ok: true, items, summary, observed_at: observedAt })
}
