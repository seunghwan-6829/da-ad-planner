import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { tokenFor, getMe, getRecentThreads, getInsights } from '@/lib/threads/api'
import { cronAuthOk } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 내 글 성과(인사이트).
//   GET ?brand_id= → media_id 별 최신 스냅샷
//   POST { brand_id? } → 스냅샷 실행(원본 snapshot.py): 최근 14일 내 글의 조회/좋아요/댓글 등 수집·적재. 크론이 호출.
//   POST 는 서버 토큰(THREADS_TOKEN_<ID>)이 있는 브랜드만 처리.

const REPOST_FACADE = 'REPOST_FACADE'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const brandId = searchParams.get('brand_id')
  let q = supabaseAdmin.from('th_insights').select('*').order('ts', { ascending: false }).limit(1000)
  if (brandId) q = q.eq('brand_id', brandId)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // media_id 별 최신만
  const seen = new Set<string>()
  const latest: typeof data = []
  for (const row of data || []) {
    if (seen.has(row.media_id)) continue
    seen.add(row.media_id)
    latest.push(row)
  }
  return NextResponse.json(latest)
}

export async function POST(req: Request) {
  // 스냅샷은 크론 전용(Threads API 쿼터 보호). CRON_SECRET 미설정 시 개방(기존 크론 동작).
  if (!cronAuthOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const only = (b.brand_id || '').toString()
  let q = supabaseAdmin.from('th_brands').select('*').eq('enabled', true)
  if (only) q = q.eq('id', only)
  const { data: brands } = await q
  const detail: { brand: string; snapshots?: number; skipped?: string }[] = []

  for (const brand of brands || []) {
    const token = tokenFor(brand.id)
    if (!token) { detail.push({ brand: brand.id, skipped: 'no_token' }); continue }
    try {
      const me = await getMe(token)
      const threads = await getRecentThreads(token, me.id, 14)
      let n = 0
      for (const t of threads) {
        if ((t.text || '').includes(REPOST_FACADE)) continue
        try {
          const ins = await getInsights(token, t.id)
          await supabaseAdmin.from('th_insights').insert({
            brand_id: brand.id, media_id: t.id, text: (t.text || '').slice(0, 500),
            posted_at: t.timestamp, permalink: t.permalink,
            views: ins.views, likes: ins.likes, replies: ins.replies, reposts: ins.reposts, quotes: ins.quotes, shares: ins.shares,
          })
          n++
        } catch { /* 개별 글 실패는 건너뜀 */ }
      }
      detail.push({ brand: brand.id, snapshots: n })
    } catch (e) {
      detail.push({ brand: brand.id, skipped: String((e as Error).message || e).slice(0, 100) })
    }
  }
  return NextResponse.json({ ok: true, detail })
}
