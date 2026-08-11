import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { OBSERVE_GAP_MS, OBSERVE_GLOBAL_GAP_MS, EVAL_AFTER_MS, resolveClubId, cafeArticleUrl } from '@/lib/naver/observe-rules'

/* '글 수집 현황' 전용 페이지가 쓰는 집계 API(보호 라우트 — /api/naver-cafe/* 는 middleware 가 지킨다).
   카페별 수집 상태 + 판정 분포 + 최근 활동 + 워커/평가 상태를 한 번에 준다.

   설계 메모
   - 화면이 15초마다 갱신하므로 쿼리 수를 5개로 고정하고 결과를 8초 캐시한다(탭 여러 개 열려도 부담 없음).
   - 판정 분포는 (cafe_id, verdict) 같은 가벼운 컬럼만 통째로 읽어 JS 에서 센다
     — 카페×판정마다 count 쿼리를 날리면 수십 번이 된다.
   - 간격 상수는 수집 라우트와 같은 것을 import 한다(각자 들고 있으면 '다음 수집 예정'이 실제와 어긋난다). */

export const dynamic = 'force-dynamic'

const CACHE_TTL_MS = 8_000
const AGENT_ONLINE_MS = 90_000 // 마지막 신호가 90초 이내면 동작 중으로 본다(하트비트 30초 주기)
const ROWS_LIMIT = 5000
const FEED_LIMIT = 60

type Counts = { total: number; today: number; keep: number; drop: number; ad: number; noise: number; unrated: number; pending: number; dueEval: number }
const zero = (): Counts => ({ total: 0, today: 0, keep: 0, drop: 0, ad: 0, noise: 0, unrated: 0, pending: 0, dueEval: 0 })

let cache: { at: number; body: unknown } | null = null

function kstTodayStartMs(nowMs: number): number {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(nowMs))
  return Date.parse(`${key}T00:00:00+09:00`)
}

export async function GET() {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return NextResponse.json(cache.body)
  try {
    return NextResponse.json(await build())
  } catch (e) {
    // 예외가 나도 화면이 '무응답'이 되지 않게 항상 JSON 을 돌려준다.
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 200) : '집계 실패' }, { status: 500 })
  }
}

async function build() {
  const nowMs = Date.now()
  const todayStart = kstTodayStartMs(nowMs)
  const evalDueBefore = nowMs - EVAL_AFTER_MS

  const [cafesRes, metaRes, statsRes, feedRes, agentRes, lastEvalRes] = await Promise.all([
    supabaseAdmin.from('nc_cafes').select('id, name, cafe_url, club_id, enabled, brand_id').order('created_at', { ascending: true }),
    supabaseAdmin.from('nc_meta').select('key, value').limit(1000),
    /* 집계는 DB 에서 (카페 × 판정) 으로 접어 받는다 — 결과가 수십 행뿐이라 글이 수십 배 늘어도 응답이 일정하다.
       (마이그레이션 전 환경에서는 아래 폴백이 예전처럼 행을 훑는다) */
    supabaseAdmin.rpc('nc_observe_stats'),
    supabaseAdmin.from('nc_cafe_posts').select('*').order('last_seen', { ascending: false }).limit(FEED_LIMIT),
    supabaseAdmin.from('nc_agent').select('last_seen, halted, halt_reason, last_event, last_event_at').eq('id', 1).maybeSingle(),
    // 평가 크론이 실제로 돌고 있는지 — 마지막 판정 시각(멈추면 판정 대기만 쌓인다)
    supabaseAdmin.from('nc_cafe_posts').select('evaluated_at').not('evaluated_at', 'is', null).order('evaluated_at', { ascending: false }).limit(1).maybeSingle(),
  ])

  const cafes = (cafesRes.data ?? []) as { id: string; name: string; cafe_url: string | null; club_id: string | null; enabled: boolean | null; brand_id: string | null }[]
  const meta = new Map((metaRes.data ?? []).map((m) => [String((m as { key: string }).key), String((m as { value?: string }).value ?? '')]))

  const perCafe = new Map<string, Counts & { lastCollectedAt: string | null }>()
  for (const c of cafes) perCafe.set(c.id, { ...zero(), lastCollectedAt: null })
  const totals = zero()
  const bucket = (v: string) => (['keep', 'drop', 'ad', 'noise', 'unrated'] as const).find((k) => k === v) ?? 'pending'

  let tableMissing = false
  let truncated = false

  if (!statsRes.error && Array.isArray(statsRes.data)) {
    // ── 빠른 경로: DB 집계(정확한 전체 카운트, 행 수와 무관하게 일정한 비용) ──
    for (const r of statsRes.data as { cafe_id: string; verdict: string; cnt: number; today_cnt: number; due_cnt: number; last_collected: string | null }[]) {
      const slot = perCafe.get(String(r.cafe_id))
      if (!slot) continue // 삭제된 발행처의 잔여 행은 집계에서 제외
      const key = bucket(String(r.verdict ?? 'pending'))
      const cnt = Number(r.cnt) || 0
      const today = Number(r.today_cnt) || 0
      const due = Number(r.due_cnt) || 0
      slot[key] += cnt; slot.total += cnt; slot.today += today; slot.dueEval += due
      totals[key] += cnt; totals.total += cnt; totals.today += today; totals.dueEval += due
      if (r.last_collected && (!slot.lastCollectedAt || r.last_collected > slot.lastCollectedAt)) slot.lastCollectedAt = r.last_collected
    }
  } else {
    /* ── 폴백: 집계 함수(nc_observe_stats)가 아직 없는 환경 ──
       예전처럼 최근 행을 훑는다. 느리고 상한이 있어 truncated 로 알린다(최신 SQL 을 실행하면 위 경로로 간다). */
    const scan = await supabaseAdmin
      .from('nc_cafe_posts')
      .select('cafe_id, verdict, first_seen, last_seen, first_metric_at')
      .order('last_seen', { ascending: false })
      .limit(ROWS_LIMIT)
    tableMissing = !!scan.error
    const rawRows = (scan.data ?? []) as Record<string, unknown>[]
    truncated = rawRows.length >= ROWS_LIMIT
    for (const raw of rawRows) {
      const slot = perCafe.get(String(raw.cafe_id ?? ''))
      if (!slot) continue
      const key = bucket(String(raw.verdict ?? 'pending'))
      slot[key] += 1; slot.total += 1
      totals[key] += 1; totals.total += 1

      const firstSeenMs = raw.first_seen ? Date.parse(String(raw.first_seen)) : NaN
      if (!Number.isNaN(firstSeenMs) && firstSeenMs >= todayStart) { slot.today += 1; totals.today += 1 }

      const fmaMs = raw.first_metric_at ? Date.parse(String(raw.first_metric_at)) : NaN
      if (key === 'pending' && !Number.isNaN(fmaMs) && fmaMs <= evalDueBefore) { slot.dueEval += 1; totals.dueEval += 1 }

      const lastSeen = raw.last_seen ? String(raw.last_seen) : null
      if (lastSeen && (!slot.lastCollectedAt || lastSeen > slot.lastCollectedAt)) slot.lastCollectedAt = lastSeen
    }
  }

  const cafeRows = cafes.map((c) => {
    const s = perCafe.get(c.id) ?? { ...zero(), lastCollectedAt: null }
    const observedAt = meta.get(`observe:${c.id}`) || null
    const observedMs = observedAt ? Date.parse(observedAt) : NaN
    const pausedReason = meta.get(`pause:${c.id}`) || null
    // 주소가 없으면 워커가 방문할 수 없다 → 화면에서 원인으로 표시
    const collectable = !!c.cafe_url && c.enabled !== false && !pausedReason
    return {
      id: c.id,
      name: c.name,
      cafe_url: c.cafe_url,
      enabled: c.enabled !== false,
      paused_reason: pausedReason,
      collectable,
      blocked_reason: !c.cafe_url ? '게시판 URL 없음' : c.enabled === false ? '발행처 비활성' : pausedReason ? '연속 실패로 일시정지' : null,
      observed_at: observedAt,
      next_observe_at: Number.isNaN(observedMs) ? null : new Date(observedMs + OBSERVE_GAP_MS).toISOString(),
      last_collected_at: s.lastCollectedAt,
      counts: { total: s.total, today: s.today, keep: s.keep, drop: s.drop, ad: s.ad, noise: s.noise, unrated: s.unrated, pending: s.pending, dueEval: s.dueEval },
    }
  })

  const cafeNames = new Map(cafes.map((c) => [c.id, c.name]))
  const cafeClubs = new Map(cafes.map((c) => [c.id, resolveClubId(c.cafe_url, c.club_id)]))
  const recent = tableMissing
    ? []
    : ((feedRes.data ?? []) as Record<string, unknown>[])
        .filter((r) => cafeNames.has(String(r.cafe_id ?? '')))
        .map((r) => ({
          cafe_id: String(r.cafe_id ?? ''),
          cafe_name: cafeNames.get(String(r.cafe_id ?? '')) ?? '',
          // 원문 주소 — 목록에서 바로 카페 글을 열어볼 수 있게
          url: cafeArticleUrl(cafeClubs.get(String(r.cafe_id ?? '')) ?? null, r.article_id ? String(r.article_id) : null),
          title: String(r.title ?? ''),
          verdict: String(r.verdict ?? 'pending'),
          verdict_reason: r.verdict_reason ? String(r.verdict_reason) : null,
          views: typeof r.views === 'number' ? r.views : null,
          comments: typeof r.comments === 'number' ? r.comments : null,
          views_delta: typeof r.views_delta === 'number' ? r.views_delta : null,
          comments_delta: typeof r.comments_delta === 'number' ? r.comments_delta : null,
          is_popular: r.is_popular === true,
          first_seen: String(r.first_seen ?? r.last_seen ?? ''),
          last_seen: String(r.last_seen ?? r.first_seen ?? ''),
          evaluated_at: r.evaluated_at ? String(r.evaluated_at) : null,
          // 오늘 '처음 발견한' 글인지 — 피드에서 새 글과 다시 본 글을 구분해 보여준다.
          is_new_today: r.first_seen ? Date.parse(String(r.first_seen)) >= todayStart : false,
        }))

  const agentRow = agentRes.data as { last_seen?: string; halted?: boolean; halt_reason?: string; last_event?: string; last_event_at?: string } | null
  const agentLastMs = agentRow?.last_seen ? Date.parse(agentRow.last_seen) : NaN

  const lastAnyMs = Date.parse(meta.get('observe_last_any') || '')
  const body = {
    ok: true,
    tableMissing,
    truncated,
    now: new Date(nowMs).toISOString(),
    rules: {
      observe_gap_hours: Math.round(OBSERVE_GAP_MS / 3600_000),
      global_gap_min: Math.round(OBSERVE_GLOBAL_GAP_MS / 60_000),
      eval_after_hours: Math.round(EVAL_AFTER_MS / 3600_000),
    },
    agent: {
      online: !Number.isNaN(agentLastMs) && nowMs - agentLastMs < AGENT_ONLINE_MS,
      last_seen: agentRow?.last_seen ?? null,
      halted: agentRow?.halted === true,
      halt_reason: agentRow?.halt_reason ?? null,
      last_event: agentRow?.last_event ?? null,
      last_event_at: agentRow?.last_event_at ?? null,
    },
    // 카페 간 간격이 끝나는 시각(이 전에는 어떤 카페도 배정되지 않는다)
    next_slot_at: Number.isNaN(lastAnyMs) ? null : new Date(lastAnyMs + OBSERVE_GLOBAL_GAP_MS).toISOString(),
    last_evaluated_at: (lastEvalRes.data as { evaluated_at?: string } | null)?.evaluated_at ?? null,
    totals: { ...totals, cafes: cafes.length, collectable: cafeRows.filter((c) => c.collectable).length },
    cafes: cafeRows,
    recent,
  }

  cache = { at: Date.now(), body }
  return body
}
