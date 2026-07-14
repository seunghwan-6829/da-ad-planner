import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 수집 워커(로컬 Playwright)가 스크랩 + 지표를 밀어넣는 엔드포인트.
//   POST { scraps:[{key, brand_id, category_id?, source_type, title, url, author?}], metrics:[{scrap_key, rank?, views?, likes?, comments?}] }
//   X-Agent-Token(TH_AGENT_TOKEN 설정 시) 필요. 스크랩은 key 충돌 시 무시(first_seen 보존), 지표는 항상 append.

function authOk(req: Request): boolean {
  const need = process.env.TH_AGENT_TOKEN || ''
  if (!need) return true
  return req.headers.get('x-agent-token') === need
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const scraps = Array.isArray(b.scraps) ? b.scraps : []
  const metrics = Array.isArray(b.metrics) ? b.metrics : []

  // 하트비트 겸용
  await supabaseAdmin.from('th_agent').upsert({ id: 1, last_seen: new Date().toISOString(), info: 'collector' })

  const scrapKeys = new Set<string>()
  let newScraps = 0
  if (scraps.length) {
    const rows = scraps
      .filter((s: Record<string, unknown>) => s.key && s.brand_id && s.source_type)
      .map((s: Record<string, unknown>) => {
        scrapKeys.add(String(s.key))
        return {
          key: String(s.key),
          brand_id: String(s.brand_id),
          category_id: s.category_id ? String(s.category_id) : null,
          source_type: String(s.source_type),
          title: String(s.title || '').slice(0, 1000),
          url: String(s.url || ''),
          author: String(s.author || ''),
        }
      })
    if (rows.length) {
      const { data, error } = await supabaseAdmin.from('th_scraps').upsert(rows, { onConflict: 'key', ignoreDuplicates: true }).select('key')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      newScraps = data?.length || 0
    }
  }

  let newMetrics = 0
  if (metrics.length) {
    // 이번 푸시에 함께 온(=방금 upsert 되어 존재가 보장되는) scrap_key 만 → FK 위반으로 배치 전체가 실패하는 것 방지.
    const rows = metrics
      .filter((m: Record<string, unknown>) => m.scrap_key && scrapKeys.has(String(m.scrap_key)))
      .map((m: Record<string, unknown>) => ({
        scrap_key: String(m.scrap_key),
        rank: m.rank == null ? null : Number(m.rank),
        views: m.views == null ? null : Number(m.views),
        likes: m.likes == null ? null : Number(m.likes),
        comments: m.comments == null ? null : Number(m.comments),
      }))
    if (rows.length) {
      const { error } = await supabaseAdmin.from('th_scrap_metrics').insert(rows)
      if (!error) newMetrics = rows.length
    }
  }

  return NextResponse.json({ ok: true, new_scraps: newScraps, metrics: newMetrics })
}
