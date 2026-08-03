import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { draftPost, splitTopics, archetypesForStyle, type DraftCafe } from '@/lib/naver/generate'
import { titleSimilarity } from '@/lib/naver/dedupe'
import { buildTasteProfile, cafeObservedTitles } from '@/lib/naver/taste'

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

  const { claude, options } = await getNaverSettings()
  /* 취향 학습(승인/반려 이력) — 프롬프트 가이드 + 생성 후 점수 필터의 원천.
     승인작은 '이미 발행된 글'이라 스타일 참고만 하고, 비슷하게 나온 후보는 아래 필터가 버린다. */
  const taste = await buildTasteProfile()
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const detail: { cafe: string; made: number; skipped?: number; taste_skipped?: number; error?: string }[] = []

  for (const cafe of cafes) {
    try {
      // 오늘 이미 만든 자동 초안 수 + 중복 방지용 최근 제목(모든 상태, dup 창=기본 30일)
      const { data: todays } = await supabaseAdmin
        .from('nc_posts').select('id').eq('cafe_id', cafe.id).eq('origin', 'auto')
        .gte('created_at', today.toISOString())
      const dupSince = new Date(Date.now() - Math.max(1, options.dup_window_days) * 86400_000).toISOString()
      const { data: recent } = await supabaseAdmin
        .from('nc_posts').select('title').eq('cafe_id', cafe.id)
        .gte('created_at', dupSince)
        .order('created_at', { ascending: false }).limit(60)
      const target = Math.max(0, Math.min(10, Number((cafe as { daily_drafts?: number }).daily_drafts ?? 3) || 0))
      // force: 하루 할당량을 무시하고 요청한 개수(기본 daily_drafts)만큼 지금 바로 생성 — 디벨롭 중 재생성용.
      const forced = b.force === true
      const wanted = Math.max(1, Math.min(10, Number(b.count) || target || 1))
      const need = forced ? wanted : Math.max(0, target - (todays?.length || 0))
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

      // 이 카페에 '실제로 올라오는 글'(워커가 매일 관찰 수집) — 카페 결에 맞게 쓰는 재료.
      const vibe = await cafeObservedTitles(String(cafe.id), 15)

      // "주로 업로드하는 컨텐츠"를 소주제로 쪼개(예: 마케팅과 상세페이지 → [마케팅, 상세페이지])
      // 원고마다 소주제를 돌려가며 배정 → 한 주제에만 쏠리지 않게.
      const subjects = splitTopics(dc.topics || '')
      // 발행처가 고른 '글 방향'(정보/질문/일상) 안에서만 유형을 돌려 쓴다. 미설정이면 전체 섞기.
      const stylePool = archetypesForStyle(String((c as { post_style?: string }).post_style || ''))
      // 원고 N개 = API N개 병렬 호출(하나가 실패해도 나머지는 그대로). 유형·소주제를 돌려가며 배정.
      // '지금 다시 생성'(force)은 중복차단에 다 막혀 0개가 나오는 걸 막으려 몇 라운드 더 시도한다
      // — 매 라운드 지금까지 채택/회피한 제목을 회피 목록에 실어(generate 가 도입을 벌림) 새 제목을 뽑는다.
      let made = 0, skipped = 0, tasteSkipped = 0
      const seen = [...avoidTitles] // 최근 창 제목 + 이번에 채택한 제목(계속 누적 → 회피 목록)
      const maxRounds = forced ? 3 : 1
      for (let round = 0; round < maxRounds && made < need; round++) {
        const batch = need - made
        const results = await Promise.allSettled(
          Array.from({ length: batch }, (_, i) => {
            const idx = startIdx + made + i + round * 7 // 유형·소주제가 라운드마다 다르게 돌도록 오프셋
            return draftPost(apiKey, dc, subjects.length ? subjects[idx % subjects.length] : '', claude.model, claude.max_tokens, {
              avoidTitles: seen.slice(-40),
              archetypeKey: stylePool[idx % stylePool.length].key,
              taste: taste.active ? { active: true, approvedSamples: taste.approvedSamples, rejectedSamples: taste.rejectedSamples, guidance: taste.guidance } : undefined,
              cafeVibe: vibe,
            })
          })
        )
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value.title) continue
          const t = r.value.title
          // 최근 창 안에 비슷한 제목이 있으면 아예 만들지 않는다 — 같은 글 반복 방지.
          if (seen.some((old) => titleSimilarity(t, old) >= options.dup_similarity)) { skipped++; continue }
          /* 취향 점수 필터:
             ① 사장님이 반려했던 제목과 비슷하면 버림(싫어하는 결 재생산 방지)
             ② 승인·발행된 제목과 비슷해도 버림 — 승인 = 이미 포스팅됨. 좋았다고 또 쓰면 반려 대상(사장님 룰)
             ③ 이 카페에 실제 있는 남의 글 제목과 비슷하면 버림(따라 쓴 티) */
          if (taste.active && taste.rejectedTitles.some((rt) => titleSimilarity(t, rt) >= 0.5)) { tasteSkipped++; continue }
          if (taste.approvedTitles.some((at) => titleSimilarity(t, at) >= options.dup_similarity)) { tasteSkipped++; continue }
          if (vibe.some((vt) => titleSimilarity(t, vt) >= 0.75)) { tasteSkipped++; continue }
          seen.push(t)
          const { error: insErr } = await supabaseAdmin
            .from('nc_posts')
            .insert({ cafe_id: cafe.id, title: t, body: r.value.body, status: 'draft', origin: 'auto', created_by: 'auto-draft' })
          if (!insErr) made++
          if (made >= need) break
        }
      }
      detail.push({ cafe: cafe.name, made, ...(skipped ? { skipped } : {}), ...(tasteSkipped ? { taste_skipped: tasteSkipped } : {}) })
    } catch (e) {
      detail.push({ cafe: cafe.name, made: 0, error: String(e instanceof Error ? e.message : e).slice(0, 120) })
    }
  }
  return NextResponse.json({
    ok: true,
    made: detail.reduce((s, d) => s + d.made, 0),
    skipped: detail.reduce((s, d) => s + (d.skipped || 0), 0),
    detail,
  })
}
