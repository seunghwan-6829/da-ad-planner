import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { draftPost, splitTopics, POST_ARCHETYPES, type DraftCafe } from '@/lib/naver/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 카페별 자동 초안: 카페마다 설정한 개수(daily_drafts, 기본 3)까지 Claude(회사 공용 키)가 작성.
//   POST { cafe_id? }  → cafe_id 있으면 그 카페만, 없으면 enabled 카페 전체.
//   매일 아침 GitHub Actions(naver-cafe-drafts.yml)가 전체 호출 + 페이지 버튼으로 수동 호출.
//
// 생성 엔진은 lib/naver/generate.draftPost 단일 경로를 쓴다(수동 초안과 완전히 동일한 '진짜 회원' 톤).
// 원고마다 글 유형(아키타입)을 돌려가며 배정해 병렬 생성 시에도 형태가 겹치지 않게 한다.

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key') || ''
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY(서버) 또는 사용자 키가 필요해요.' }, { status: 401 })

  const b = await req.json().catch(() => ({}))
  let q = supabaseAdmin.from('nc_cafes').select('*').eq('enabled', true)
  if (b.cafe_id) q = q.eq('id', b.cafe_id)
  const { data: cafes, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!cafes?.length) return NextResponse.json({ ok: true, made: 0, detail: [] })

  const { claude } = await getNaverSettings()
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
      const avoidTitles = (recent || []).map((r) => r.title).filter(Boolean)
      const startIdx = todays?.length || 0

      const c = cafe as Record<string, unknown>
      const dc: DraftCafe = {
        name: String(c.name || '(이름 없음)'),
        persona: String(c.persona || c.tone || ''),
        topics: String(c.topics || ''),
        notes: String(c.notes || ''),
        emphasis: Array.isArray(c.emphasis) ? (c.emphasis as string[])
          : (typeof c.emphasis === 'string' ? (c.emphasis as string).split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : []),
        selling_point: String(c.selling_point || ''),
        rules: (c.rules as DraftCafe['rules']) || null,
      }

      // "주로 업로드하는 컨텐츠"를 소주제로 쪼개(예: 마케팅과 상세페이지 → [마케팅, 상세페이지])
      // 원고마다 소주제를 돌려가며 배정 → 한 주제에만 쏠리지 않게.
      const subjects = splitTopics(dc.topics || '')
      // 원고 N개 = API N개 병렬 호출(하나가 실패해도 나머지는 그대로). 유형·소주제를 돌려가며 배정.
      const results = await Promise.allSettled(
        Array.from({ length: need }, (_, i) =>
          draftPost(apiKey, dc, subjects.length ? subjects[(startIdx + i) % subjects.length] : '', claude.model, claude.max_tokens, {
            avoidTitles,
            archetypeKey: POST_ARCHETYPES[(startIdx + i) % POST_ARCHETYPES.length].key,
          })
        )
      )
      let made = 0
      for (const r of results) {
        if (r.status !== 'fulfilled' || !r.value.title) continue
        const { error: insErr } = await supabaseAdmin
          .from('nc_posts')
          .insert({ cafe_id: cafe.id, title: r.value.title, body: r.value.body, status: 'draft', origin: 'auto', created_by: 'auto-draft' })
        if (!insErr) made++
      }
      detail.push({ cafe: cafe.name, made })
    } catch (e) {
      detail.push({ cafe: cafe.name, made: 0, error: String(e instanceof Error ? e.message : e).slice(0, 120) })
    }
  }
  return NextResponse.json({ ok: true, made: detail.reduce((s, d) => s + d.made, 0), detail })
}
