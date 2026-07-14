import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { summarizeScraps, type Scrap, type ScrapMetric } from '@/lib/threads/scoring'
import { isAdminRequest } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const DRAFTS_PER_RUN = 3

// 쓰레드 초안 생성(원본 generate.py 포팅). 페르소나 + 스타일가이드 + viral 소재 → 내 목소리 재해석(≤500자, 해시태그 없음).
//   POST { brand_id, source_key }       → 그 소재로 1개 생성해 { text } 반환(폼 프리필, 큐 미적재)
//   POST { brand_id, auto:true, count? } → hot 소재로 N개 생성해 큐 적재, { made } 반환

async function draftOne(apiKey: string, persona: string, styleGuide: string, material: string): Promise<string> {
  const prompt = `너는 아래 페르소나로 활동하는 Threads 크리에이터야.

[페르소나]
${persona || '자연스러운 개인 계정'}

${styleGuide ? `[내 스타일 가이드]\n${styleGuide.slice(0, 1500)}\n` : ''}
[참고할 화제(바이럴 소재)]
${material.slice(0, 400)}

[작성 규칙]
- 위 소재를 그대로 베끼지 말고, 내 목소리로 재해석해 Threads 글 1개를 써.
- 500자 이내. 해시태그·이모지 남발 금지. 훅(첫 줄)이 강하게.
- 광고티 없이 자연스럽게. 본문만 출력(따옴표·머리말 없이).`
  const r = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`)
  return (j?.content?.[0]?.text || '').toString().trim().replace(/^["'“”]|["'“”]$/g, '').slice(0, 500)
}

export async function POST(req: Request) {
  // 관리자만(비인가 호출로 초안 대량 생성→자동 발행/비용 폭주 차단). UI가 Bearer 토큰을 보냄.
  if (!(await isAdminRequest(req))) return NextResponse.json({ error: '관리자 인증이 필요해요.' }, { status: 401 })
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key') || ''
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY(서버) 또는 사용자 키가 필요해요.' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  const brandId = (b.brand_id || '').toString()
  if (!brandId) return NextResponse.json({ error: '브랜드가 필요해요.' }, { status: 400 })

  const { data: brand } = await supabaseAdmin.from('th_brands').select('*').eq('id', brandId).maybeSingle()
  if (!brand) return NextResponse.json({ error: '브랜드를 찾을 수 없어요.' }, { status: 404 })
  const { data: sg } = await supabaseAdmin.from('th_style_guides').select('content').eq('brand_id', brandId).maybeSingle()
  const styleGuide = sg?.content || ''

  // 단일 소재 생성(폼 프리필)
  if (b.source_key) {
    const { data: scrap } = await supabaseAdmin.from('th_scraps').select('*').eq('key', b.source_key).maybeSingle()
    if (!scrap) return NextResponse.json({ error: '소재를 찾을 수 없어요.' }, { status: 404 })
    let topicTag = ''
    if (scrap.category_id) {
      const { data: cat } = await supabaseAdmin.from('th_categories').select('topic_tag').eq('id', scrap.category_id).maybeSingle()
      topicTag = cat?.topic_tag || ''
    }
    try {
      const text = await draftOne(apiKey, brand.persona, styleGuide, scrap.title)
      return NextResponse.json({ text, topic_tag: topicTag, source_key: scrap.key, source_title: scrap.title })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : '생성 실패' }, { status: 502 })
    }
  }

  // 자동: hot 소재로 N개 생성 후 큐 적재
  const count = Math.max(1, Math.min(10, Number(b.count) || DRAFTS_PER_RUN))
  const { data: scraps } = await supabaseAdmin.from('th_scraps').select('*').eq('brand_id', brandId).order('first_seen', { ascending: false }).limit(500)
  const keys = (scraps || []).map((s) => s.key)
  const { data: metrics } = keys.length
    ? await supabaseAdmin.from('th_scrap_metrics').select('scrap_key, ts, rank, views, likes, comments').in('scrap_key', keys)
    : { data: [] }
  const scored = summarizeScraps((scraps || []) as Scrap[], (metrics || []) as ScrapMetric[]).filter((s) => s.hot)

  // 이미 사용한 소재(source_key) 제외 — 큐 + 발행이력 모두
  const [{ data: usedQ }, { data: usedP }] = await Promise.all([
    supabaseAdmin.from('th_queue').select('source_key').eq('brand_id', brandId).not('source_key', 'is', null),
    supabaseAdmin.from('th_published').select('source_key').eq('brand_id', brandId).not('source_key', 'is', null),
  ])
  const usedKeys = new Set([...(usedQ || []), ...(usedP || [])].map((r) => r.source_key).filter(Boolean))
  const targets = scored.filter((s) => !usedKeys.has(s.key)).slice(0, count)
  if (!targets.length) return NextResponse.json({ ok: true, made: 0, reason: 'hot 소재 없음(수집이 더 필요하거나 12시간 경과 대기)' })

  // 카테고리 topic_tag 매핑
  const catIds = [...new Set(targets.map((t) => t.category_id).filter(Boolean))] as string[]
  const tagByCat: Record<string, string> = {}
  if (catIds.length) {
    const { data: cats } = await supabaseAdmin.from('th_categories').select('id, topic_tag').in('id', catIds)
    for (const c of cats || []) tagByCat[c.id] = c.topic_tag || ''
  }

  const results = await Promise.allSettled(targets.map((t) => draftOne(apiKey, brand.persona, styleGuide, t.title)))
  let made = 0
  for (let i = 0; i < targets.length; i++) {
    const r = results[i]
    if (r.status !== 'fulfilled' || !r.value) continue
    const t = targets[i]
    const { error } = await supabaseAdmin.from('th_queue').insert({
      brand_id: brandId, text: r.value, category_id: t.category_id,
      topic_tag: t.category_id ? tagByCat[t.category_id] || '' : '',
      status: 'queued', source_key: t.key, meta: { source_key: t.key, source_title: t.title, generated: true },
    })
    if (!error) made++
  }
  void usedP
  return NextResponse.json({ ok: true, made })
}
