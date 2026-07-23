import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { draftPost, reflowBody, POST_ARCHETYPES, type DraftCafe } from '@/lib/naver/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 관리자용 "정리 후 재생성": 아직 발행하지 않은(키핑 중인) 초안을 모두 비우고,
// 브랜드마다 새 톤(진짜 회원 글)으로 초안 N개를 다시 만든다.
//   POST { per_brand?=2, clear?=true }
//
// ⚠️ 미들웨어 PROTECTED_API 안(예외 아님) — 사람(관리자) 로그인 세션이 있어야 호출된다.
//    크론/에이전트/익명은 여기 못 온다. 파괴적 삭제라 인증 뒤에 두는 게 맞다.
//
// 삭제 범위: '발행 완료(published)'와 '발행 중(publishing)'은 건드리지 않는다(이력·진행 보호).
const PENDING = ['draft', 'approved', 'queued', 'preview', 'rejected', 'failed', 'saved']

type Row = Record<string, unknown>
const str = (v: unknown) => (v == null ? '' : String(v))

function toDraftCafe(cafe: Row, brand: Row | null): DraftCafe {
  const topics = str(cafe.topics) ||
    (Array.isArray(brand?.default_topics) ? (brand!.default_topics as string[]).join(', ') : '')
  return {
    name: str(cafe.name) || str(brand?.name),
    persona: str(cafe.persona) || str(cafe.tone) || str(brand?.persona) || '',
    topics,
    notes: str(cafe.notes),
    emphasis: Array.isArray(cafe.emphasis) ? (cafe.emphasis as string[])
      : (typeof cafe.emphasis === 'string' ? (cafe.emphasis as string).split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : []),
    selling_point: str(cafe.selling_point),
    rules: (cafe.rules as DraftCafe['rules']) || null,
  }
}

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 DB 연결이 설정되지 않았어요.' }, { status: 500 })
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key') || ''
  const b = await req.json().catch(() => ({}))
  const perBrand = Math.max(0, Math.min(5, Number(b.per_brand ?? 2) || 0))
  const doClear = b.clear !== false

  // ── 줄바꿈만 정리(내용은 그대로) — 이미 마음에 드는 초안의 가독성만 손볼 때 ──
  if (b.reflow_only === true) {
    const { data: rows, error } = await supabaseAdmin
      .from('nc_posts').select('id, body, kind').in('status', PENDING)
    if (error) return NextResponse.json({ error: '조회 실패: ' + error.message }, { status: 500 })
    let reflowed = 0
    for (const r of (rows || []) as Row[]) {
      if (r.kind === 'comment') continue // 댓글은 한 덩어리로 두므로 줄바꿈 정리 대상 아님
      const nb = reflowBody(str(r.body))
      if (nb && nb !== r.body) {
        const up = await supabaseAdmin.from('nc_posts').update({ body: nb, updated_at: new Date().toISOString() }).eq('id', r.id)
        if (!up.error) reflowed++
      }
    }
    return NextResponse.json({ ok: true, reflowed, total: (rows || []).length })
  }

  // ── 1) 미발행 초안 비우기 ──
  let cleared = 0
  if (doClear) {
    const del = await supabaseAdmin.from('nc_posts').delete().in('status', PENDING).select('id')
    if (del.error) return NextResponse.json({ error: '삭제 실패: ' + del.error.message }, { status: 500 })
    cleared = del.data?.length || 0
  }

  if (perBrand === 0) return NextResponse.json({ ok: true, cleared, seeded: 0, detail: [] })
  if (!apiKey) {
    return NextResponse.json({ ok: true, cleared, seeded: 0, detail: [], note: 'ANTHROPIC_API_KEY(서버)가 없어 생성은 건너뛰고 삭제만 했어요.' })
  }

  // ── 2) 브랜드별 새 초안 생성 ──
  const { claude } = await getNaverSettings()
  const [{ data: brands }, { data: cafes }] = await Promise.all([
    supabaseAdmin.from('nc_brands').select('*'),
    supabaseAdmin.from('nc_cafes').select('*').eq('enabled', true),
  ])
  const allCafes = (cafes || []) as Row[]

  // 단위(unit) 구성: 브랜드가 있으면 브랜드별로, 브랜드에 묶인 발행처가 하나도 없으면 발행처 자체를 단위로.
  const enabledBrands = ((brands || []) as Row[]).filter((br) => br.enabled !== false)
  type Unit = { name: string; brand: Row | null; cafes: Row[] }
  let units: Unit[] = enabledBrands
    .map((br) => ({ name: str(br.name) || '(이름 없는 브랜드)', brand: br, cafes: allCafes.filter((c) => c.brand_id === br.id) }))
    .filter((u) => u.cafes.length > 0)

  let fellBack = false
  if (units.length === 0) {
    // 브랜드↔발행처 연결이 없다 → 발행처 하나하나를 단위로(그래도 "각각 2개"를 만들 수 있게).
    fellBack = true
    units = allCafes.map((c) => ({ name: str(c.name) || '(이름 없는 발행처)', brand: null, cafes: [c] }))
  }

  const detail: { unit: string; seeded: number; titles?: string[]; reason?: string }[] = []
  let seeded = 0
  for (const u of units) {
    try {
      const results = await Promise.allSettled(
        Array.from({ length: perBrand }, (_, i) => {
          const cafe = u.cafes[i % u.cafes.length] // 발행처가 여럿이면 라운드로빈으로 분배
          const dc = toDraftCafe(cafe, u.brand)
          return draftPost(apiKey, dc, '', claude.model, claude.max_tokens, {
            archetypeKey: POST_ARCHETYPES[i % POST_ARCHETYPES.length].key,
          }).then((r) => ({ r, cafeId: cafe.id }))
        })
      )
      const titles: string[] = []
      for (const res of results) {
        if (res.status !== 'fulfilled' || !res.value.r.title) continue
        const { r, cafeId } = res.value
        const ins = await supabaseAdmin.from('nc_posts').insert({
          cafe_id: cafeId, kind: 'post', title: r.title, body: r.body,
          status: 'draft', origin: 'auto', created_by: 'reset-seed',
        })
        if (!ins.error) { seeded++; titles.push(r.title) }
      }
      detail.push({ unit: u.name, seeded: titles.length, titles })
    } catch (e) {
      detail.push({ unit: u.name, seeded: 0, reason: String(e instanceof Error ? e.message : e).slice(0, 120) })
    }
  }

  const skippedBrandless = !fellBack && allCafes.some((c) => !c.brand_id)
  return NextResponse.json({
    ok: true, cleared, seeded, detail,
    ...(fellBack ? { note: '브랜드에 연결된 발행처가 없어, 발행처마다 새로 생성했어요.' } : {}),
    ...(skippedBrandless ? { note2: '브랜드에 연결되지 않은 발행처는 건너뛰었어요(브랜드씩 생성).' } : {}),
  })
}
