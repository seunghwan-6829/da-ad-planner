import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// 카페별 자동 초안: 카페마다 설정한 개수(daily_drafts, 기본 3)까지, 활동 컨셉/소구점에 맞춰 Claude(회사 공용 키)가 작성.
//   POST { cafe_id? }  → cafe_id 있으면 그 카페만, 없으면 enabled 카페 전체.
//   매일 아침 GitHub Actions(naver-cafe-drafts.yml)가 전체 호출 + 페이지 버튼으로 수동 호출.

async function draftOne(apiKey: string, cafe: { name: string; tone: string; topics: string; notes: string; selling_point?: string | null }, avoidTitles: string[]) {
  const prompt = `네이버 카페에 올릴 글의 초안을 작성해줘.

[카페] ${cafe.name}
[활동 컨셉(이 인물이 쓴 것처럼)] ${cafe.tone || '자연스러운 일반 회원'}
[채널 소구점(글이 궁극적으로 쌓아야 할 것)] ${cafe.selling_point || '(없음)'}
[주로 업로드하는 컨텐츠] ${cafe.topics || '(자유 주제 — 카페 성격에 맞게)'}
[주의사항] ${cafe.notes || '(없음)'}
[이미 쓴 제목(겹치지 않게)] ${avoidTitles.slice(0, 15).join(' / ') || '(없음)'}

[규칙]
- 커뮤니티 회원이 자연스럽게 쓴 글. 광고티/과장/반복 CTA 금지, 페르소나의 말투 유지.
- 제목은 클릭을 부르되 낚시 금지. 본문 300~700자, 문단 구분, 일반 텍스트만.
JSON 으로만 응답: {"title":"...","body":"..."}`
  const r = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`)
  const text: string = j?.content?.[0]?.text || ''
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('응답 형식 오류')
  const parsed = JSON.parse(m[0])
  return { title: String(parsed.title || '').slice(0, 100), body: String(parsed.body || '').slice(0, 4000) }
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key') || ''
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY(서버) 또는 사용자 키가 필요해요.' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  let q = supabaseAdmin.from('nc_cafes').select('*').eq('enabled', true)
  if (b.cafe_id) q = q.eq('id', b.cafe_id)
  const { data: cafes, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!cafes?.length) return NextResponse.json({ ok: true, made: 0, detail: [] })

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const detail: { cafe: string; made: number; error?: string }[] = []

  for (const cafe of cafes) {
    try {
      // 오늘 이미 만든 자동 초안 수 + 최근 제목(중복 방지)
      const { data: todays } = await supabaseAdmin
        .from('nc_posts').select('id').eq('cafe_id', cafe.id).eq('origin', 'auto')
        .gte('created_at', today.toISOString())
      const { data: recent } = await supabaseAdmin
        .from('nc_posts').select('title').eq('cafe_id', cafe.id).order('created_at', { ascending: false }).limit(15)
      const target = Math.max(0, Math.min(10, Number((cafe as { daily_drafts?: number }).daily_drafts ?? 3) || 0))
      const need = Math.max(0, target - (todays?.length || 0))
      let made = 0
      const avoid = (recent || []).map((r) => r.title).filter(Boolean)
      for (let i = 0; i < need; i++) {
        const d = await draftOne(apiKey, cafe, avoid)
        if (!d.title) continue
        avoid.unshift(d.title)
        const { error: insErr } = await supabaseAdmin
          .from('nc_posts')
          .insert({ cafe_id: cafe.id, title: d.title, body: d.body, status: 'draft', origin: 'auto', created_by: 'auto-draft' })
        if (!insErr) made++
      }
      detail.push({ cafe: cafe.name, made })
    } catch (e) {
      detail.push({ cafe: cafe.name, made: 0, error: String(e instanceof Error ? e.message : e).slice(0, 120) })
    }
  }
  return NextResponse.json({ ok: true, made: detail.reduce((s, d) => s + d.made, 0), detail })
}
