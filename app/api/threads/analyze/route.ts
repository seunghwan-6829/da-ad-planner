import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeScraps, type Scrap, type ScrapMetric } from '@/lib/threads/scoring'
import { isAdminRequest } from '@/lib/admin-auth'
import { cronAuthOk } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// 주간 분석(원본 analyze.py 포팅): 브랜드별 스타일 가이드(AI) 생성/갱신 + hot 소재 주간 리포트.
//   POST { brand_id? } → { report, guides:[{brand_id, ok}] }. 크론(주1)이 호출.

interface InsightRow { media_id: string; text: string; views: number | null; permalink: string; ts: string }

async function buildStyleGuide(apiKey: string, persona: string, mine: InsightRow[]): Promise<string> {
  const sorted = mine.slice().sort((a, b) => (b.views || 0) - (a.views || 0))
  // 상/하위 표본이 겹치지 않게 n 을 길이의 절반 이하로 제한.
  const n = Math.min(Math.max(3, Math.floor(sorted.length / 4)), Math.floor(sorted.length / 2)) || 1
  const top = sorted.slice(0, n)
  const bottom = sorted.slice(sorted.length - n)
  const fmt = (arr: InsightRow[]) => arr.map((p) => `- (조회 ${p.views ?? 0}) ${(p.text || '').replace(/\n/g, ' ').slice(0, 120)}`).join('\n')
  const prompt = `내 Threads 계정의 글 성과 데이터야. 아래를 분석해 "스타일 가이드"를 마크다운으로 작성해줘.

[페르소나]
${persona || '(없음)'}

[조회수 상위 글]
${fmt(top) || '(데이터 없음)'}

[조회수 하위 글]
${fmt(bottom) || '(데이터 없음)'}

[요구]
- 잘 되는 훅 패턴, 이상적인 길이, 톤, 잘 먹히는 주제, 피해야 할 패턴을 항목별로 정리.
- 다음 글 작성 시 바로 참고할 수 있게 구체적으로. 마크다운.`
  const r = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`)
  return (j?.content?.[0]?.text || '').toString().trim()
}

export async function POST(req: Request) {
  // 관리자(UI) 또는 크론(CRON_SECRET). CRON_SECRET 미설정 시 크론은 개방(기존 크론 동작 유지).
  if (!(await isAdminRequest(req)) && !cronAuthOk(req)) return NextResponse.json({ error: '인증이 필요해요.' }, { status: 401 })
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key') || ''
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY(서버) 또는 사용자 키가 필요해요.' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const only = (b.brand_id || '').toString()

  let bq = supabaseAdmin.from('th_brands').select('*').eq('enabled', true)
  if (only) bq = bq.eq('id', only)
  const { data: brands } = await bq

  const reportLines: string[] = [`# 주간 리포트`]
  const guides: { brand_id: string; ok: boolean; error?: string }[] = []

  for (const brand of brands || []) {
    // 1) hot 소재 요약(리포트)
    const { data: scraps } = await supabaseAdmin.from('th_scraps').select('*').eq('brand_id', brand.id).order('first_seen', { ascending: false }).limit(500)
    const keys = (scraps || []).map((s) => s.key)
    const { data: metrics } = keys.length
      ? await supabaseAdmin.from('th_scrap_metrics').select('scrap_key, ts, rank, views, likes, comments').in('scrap_key', keys)
      : { data: [] }
    const scored = summarizeScraps((scraps || []) as Scrap[], (metrics || []) as ScrapMetric[]).filter((s) => s.hot).slice(0, 30)
    reportLines.push(`\n## ${brand.name} — 🔥 hot 소재 ${scored.length}건`)
    for (const s of scored.slice(0, 10)) reportLines.push(`- [${s.signal}] ${s.title.slice(0, 80)}`)

    // 2) 스타일 가이드(내 글 성과 기반)
    const { data: insights } = await supabaseAdmin.from('th_insights').select('media_id, text, views, permalink, ts').eq('brand_id', brand.id).order('ts', { ascending: false }).limit(1000)
    const seen = new Set<string>()
    const mine: InsightRow[] = []
    for (const row of (insights || []) as InsightRow[]) { if (seen.has(row.media_id)) continue; seen.add(row.media_id); mine.push(row) }
    if (mine.length >= 3) {
      try {
        const content = await buildStyleGuide(apiKey, brand.persona, mine)
        await supabaseAdmin.from('th_style_guides').upsert({ brand_id: brand.id, content, updated_at: new Date().toISOString() })
        guides.push({ brand_id: brand.id, ok: true })
      } catch (e) {
        guides.push({ brand_id: brand.id, ok: false, error: String((e as Error).message || e).slice(0, 100) })
      }
    } else {
      guides.push({ brand_id: brand.id, ok: false, error: '내 글 데이터 부족(3개 미만)' })
    }
  }

  return NextResponse.json({ ok: true, report: reportLines.join('\n'), guides })
}
