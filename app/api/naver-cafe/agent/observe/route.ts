import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getMeta, setMeta } from '@/lib/naver/pacing'

/* 카페 관찰 — 워커(노트북)가 발행처 게시판에 들러 '실제로 올라오는 글 제목'을 수집한다.
   GET  → 지금 관찰할 카페 1곳(카페당 22시간에 1번만 배정 — 사람이 하루 한 번 눈팅하는 수준의 페이스)
   POST → 수집한 제목들 저장(nc_cafe_posts upsert)
   원고 생성이 이 데이터로 카페의 말투·소재 결을 맞춘다. 수집 실패해도 다음 배정(22h 후)에 재시도.
   ⚠️ /api/naver-cafe/agent/* 는 middleware 예외(워커는 사용자 세션이 없다) — x-agent-token 으로 인증. */

export const dynamic = 'force-dynamic'

const OBSERVE_GAP_MS = 22 * 60 * 60 * 1000 // 22시간 — 매일 다른 시각에 자연스럽게 돌게 딱 하루보다 짧게
const META_PREFIX = 'observe:'

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true // 토큰 미설정(로컬) → 개방
  return req.headers.get('x-agent-token') === need
}

// 카페 UI 라벨(전체글보기 등)이 제목으로 잘못 잡히는 걸 걸러낸다.
const UI_LABELS = /^(전체\s?글\s?보기|인기글|공지|카페\s?태그|멤버|출석|등업|가입인사|카페\s?정보|즐겨찾는\s?게시판|베스트\s?게시판)$/

function cleanTitle(raw: unknown): string {
  const t = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!t || t.length < 5 || t.length > 100) return ''
  if (UI_LABELS.test(t)) return ''
  return t
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })

  const { data: cafes } = await supabaseAdmin
    .from('nc_cafes')
    .select('id, name, cafe_url, club_id, board_id')
    .eq('enabled', true)
    .order('created_at', { ascending: true })
  const nowMs = Date.now()

  for (const cafe of cafes || []) {
    if (!cafe.cafe_url) continue
    const last = await getMeta(`${META_PREFIX}${cafe.id}`)
    const lastMs = last ? Date.parse(last) : NaN
    if (!Number.isNaN(lastMs) && nowMs - lastMs < OBSERVE_GAP_MS) continue
    // 배정 시각을 지금 기록 — 수집이 실패해도 22시간 뒤에나 재시도(같은 카페를 계속 두드리지 않게)
    await setMeta(`${META_PREFIX}${cafe.id}`, new Date(nowMs).toISOString())
    return NextResponse.json({ cafe })
  }
  return NextResponse.json({ none: true })
}

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const cafeId = (b.cafe_id || '').toString()
  const items = Array.isArray(b.items) ? b.items.slice(0, 30) : []
  if (!cafeId || !items.length) return NextResponse.json({ error: 'cafe_id/items 필요' }, { status: 400 })

  const nowISO = new Date().toISOString()
  const rows = []
  const seen = new Set<string>()
  for (const it of items) {
    const title = cleanTitle((it as { title?: unknown })?.title)
    if (!title || seen.has(title)) continue
    seen.add(title)
    const articleId = (it as { article_id?: unknown })?.article_id
    rows.push({ cafe_id: cafeId, title, article_id: articleId ? String(articleId) : null, last_seen: nowISO })
  }
  if (!rows.length) return NextResponse.json({ ok: true, stored: 0 })

  // (cafe_id, title) upsert — 이미 본 글은 last_seen 만 갱신, 새 글은 first_seen 자동.
  const { error } = await supabaseAdmin
    .from('nc_cafe_posts')
    .upsert(rows, { onConflict: 'cafe_id,title' })
  if (error) {
    const missing = /nc_cafe_posts/.test(error.message)
    return NextResponse.json(
      { ok: false, error: missing ? 'nc_cafe_posts 테이블이 없어요 — Supabase 에서 db/naver-cafe-observe.sql 실행 필요' : error.message },
      { status: missing ? 503 : 500 },
    )
  }
  return NextResponse.json({ ok: true, stored: rows.length })
}
