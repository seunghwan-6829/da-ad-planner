import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { getMeta, setMeta } from '@/lib/naver/pacing'
import { draftPost, splitTopics, archetypesForStyle, type DraftCafe } from '@/lib/naver/generate'
import { titleSimilarity } from '@/lib/naver/dedupe'
import { buildTasteProfile, cafeObservedTitles, cafePopularPosts } from '@/lib/naver/taste'
import { cronAuthOk } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 자동 스케줄 틱(리뉴얼 store.run_auto_schedules 포팅). GitHub Actions 크론이 주기적으로 호출.
// 발행처(auto_mode) 별 interval_days 도래 시 → 초안 1건 생성 → auto_publish 면 approved(승인 큐), 아니면 draft.
// PC(로컬 에이전트)가 꺼져 있어도 서버에서 생성되므로 초안이 계속 쌓인다.
// 사전 클레임(auto_last 먼저 기록)으로 잦은 호출에도 중복 생성 안 함.

function pickTopic(destTopics: string, brandTopics: unknown): string {
  // "마케팅과 상세페이지 관련" 같은 문자열도 소주제로 쪼개(splitTopics) 한 주제 쏠림 방지.
  const fromDest = splitTopics(destTopics || '')
  const fromBrand = Array.isArray(brandTopics) ? (brandTopics as unknown[]).flatMap((x) => splitTopics(String(x))) : []
  const pool = fromDest.length ? fromDest : fromBrand
  if (!pool.length) return ''
  return pool[Math.floor(Math.random() * pool.length)]
}

async function runAutoSchedules(apiKey: string) {
  const nowMs = Date.now()
  const nowISO = new Date().toISOString()
  const { claude, options } = await getNaverSettings()

  // auto_mode + allow_post + enabled 발행처 + (활성 브랜드)
  const { data: dests } = await supabaseAdmin
    .from('nc_cafes')
    .select('*, nc_brands(id, enabled, default_topics, persona)')
    .eq('auto_mode', true)
    .eq('enabled', true)
    .eq('allow_post', true)
  const detail: { dest: string; item_id?: string; auto_publish?: boolean; reason?: string }[] = []

  const due: typeof dests = []
  for (const d of dests || []) {
    // 브랜드가 있고 비활성이면 스킵
    const brand = (d as { nc_brands?: { enabled?: boolean } }).nc_brands
    if (brand && brand.enabled === false) continue
    // 연속 실패로 자동 일시정지된 발행처는 생성도 쉰다(재개 전까지 쌓이기만 하는 낭비 방지)
    if (await getMeta(`pause:${d.id}`)) continue
    const interval = Math.max(1, Number((d as { interval_days?: number }).interval_days) || 3)
    const last = await getMeta(`auto_last:${d.id}`)
    const dueMs = last ? Date.parse(last) + interval * 86400_000 : 0
    if (last && nowMs < dueMs) continue

    /* 큐 깊이 가드 — 이 발행처에 발행을 기다리는 글이 있으면 '클레임을 소모하지 않고' 이번 틱은 쉰다.
       (카페당 대기 글 최대 1개 유지 → 에이전트가 며칠 꺼졌다 켜져도 밀린 글이 몰아서 나갈 수 없다.
        발행이 끝나면 다음 틱에 바로 생성돼 주기 손실도 없다) */
    const { count: pendingCnt } = await supabaseAdmin
      .from('nc_posts').select('id', { count: 'exact', head: true })
      .eq('cafe_id', d.id).in('status', ['approved', 'queued', 'publishing'])
    if ((pendingCnt ?? 0) > 0) {
      detail.push({ dest: (d as { name?: string }).name || '', reason: '대기 글 있음 — 발행 완료 후 다음 틱에 생성(몰아서 발행 방지)' })
      continue
    }
    due.push(d)
  }

  // 취향 학습(승인/반려 이력) — 완전 자동일수록 사장님 취향 반영이 중요하다.
  const taste = await buildTasteProfile()

  await Promise.allSettled(
    due.map(async (d) => {
      // 사전 클레임 — 생성 전에 먼저 기록(잦은 폴링에도 중복 생성 방지)
      await setMeta(`auto_last:${d.id}`, nowISO)
      try {
        const name = (d as { name?: string }).name || ''

        /* 신뢰 게이트 — '생성 즉시 승인(완전 자동)'은 이 발행처에서 사람 검수를 거쳐 발행된 글이
           autopilot_min_published(기본 3)개 이상일 때만 작동. 그 전엔 켜도 초안(검수 대기)으로만. */
        const wantAuto = (d as { auto_publish?: boolean }).auto_publish === true
        let qualified = false
        if (wantAuto) {
          const { count: pubCnt } = await supabaseAdmin
            .from('nc_posts').select('id', { count: 'exact', head: true })
            .eq('cafe_id', d.id).eq('status', 'published')
          qualified = (pubCnt ?? 0) >= options.autopilot_min_published
        }
        const autoPublish = wantAuto && qualified

        const brand = (d as { nc_brands?: { default_topics?: unknown; persona?: string } }).nc_brands
        const topic = pickTopic((d as { topics?: string }).topics || '', brand?.default_topics)
        const cafe: DraftCafe = {
          name,
          persona: (d as { tone?: string }).tone || brand?.persona || '',
          topics: (d as { topics?: string }).topics || '',
          notes: (d as { notes?: string }).notes || '',
          emphasis: Array.isArray((d as { emphasis?: unknown }).emphasis) ? ((d as { emphasis?: string[] }).emphasis as string[]) : [],
          selling_point: (d as { selling_point?: string }).selling_point || '',
          rules: (d as { rules?: { promo_banned?: boolean } }).rules || null,
        }

        // 회피 제목(중복 방지)·카페 결·인기글 시드 — 수동 생성(auto-drafts)과 같은 품질 재료를 쓴다.
        const dupSince = new Date(nowMs - Math.max(1, options.dup_window_days) * 86400_000).toISOString()
        const { data: recentT } = await supabaseAdmin
          .from('nc_posts').select('title').eq('cafe_id', d.id).gte('created_at', dupSince)
          .order('created_at', { ascending: false }).limit(60)
        const avoidTitles = (recentT || []).map((r) => r.title).filter(Boolean) as string[]
        const vibe = await cafeObservedTitles(String(d.id), 12)
        const populars = await cafePopularPosts(String(d.id), 5)

        // 발행처가 고른 '글 방향'(정보/질문/일상) 안에서 유형을 하나 뽑는다(미설정이면 전체 섞기).
        const stylePool = archetypesForStyle((d as { post_style?: string }).post_style)
        const arch = stylePool[Math.floor(Math.random() * stylePool.length)]
        const { title, body } = await draftPost(apiKey, cafe, topic, claude.model, claude.max_tokens, {
          archetypeKey: arch.key,
          avoidTitles,
          taste: taste.active ? { active: true, approvedSamples: taste.approvedSamples, rejectedSamples: taste.rejectedSamples, guidance: taste.guidance } : undefined,
          cafeVibe: vibe,
          // 인기글 시드는 가끔만(40%) — 완전 자동에서 시드 티가 나지 않게 자유 소재를 기본으로 둔다.
          remakeSeed: populars.length && Math.random() < 0.4 ? populars[Math.floor(Math.random() * populars.length)] : undefined,
          // 검수 없이 나가는 글은 '대충 쓴 일상글' 톤(소구점·강조어 무시, 짧게) — 광고 오인 방지.
          casual: autoPublish,
        })
        if (!title) {
          detail.push({ dest: name, reason: '생성 실패' })
          return
        }

        /* 품질 필터(완전 자동일수록 엄격하게) — 하나라도 걸리면 이번 주기는 건너뛴다(다음 주기 재시도).
           ① 최근 창 안 비슷한 제목(같은 글 반복 방지) ② 사장님이 반려했던 결 ③ 승인작 복제 ④ 카페 남의 글 유사 */
        if (avoidTitles.some((t) => titleSimilarity(title, t) >= options.dup_similarity)) {
          detail.push({ dest: name, reason: '중복(최근 비슷한 글) — 건너뜀' })
          return
        }
        if (taste.active && taste.rejectedTitles.some((rt) => titleSimilarity(title, rt) >= 0.5)) {
          detail.push({ dest: name, reason: '반려됐던 결과 유사 — 건너뜀' })
          return
        }
        if (taste.approvedTitles.some((at) => titleSimilarity(title, at) >= options.dup_similarity)) {
          detail.push({ dest: name, reason: '승인작과 유사(복제 방지) — 건너뜀' })
          return
        }
        if (vibe.some((vt) => titleSimilarity(title, vt) >= 0.75)) {
          detail.push({ dest: name, reason: '카페 기존 글과 유사 — 건너뜀' })
          return
        }

        const { data: ins } = await supabaseAdmin
          .from('nc_posts')
          .insert({
            cafe_id: d.id,
            kind: 'post',
            title,
            body,
            status: autoPublish ? 'approved' : 'draft',
            origin: 'auto',
            created_by: autoPublish ? 'autopilot' : 'auto-schedule',
            approved_at: autoPublish ? nowISO : null,
          })
          .select('id')
          .single()
        detail.push({
          dest: name,
          item_id: ins?.id,
          auto_publish: autoPublish,
          ...(wantAuto && !qualified ? { reason: `자동 발행 자격 전(사람 검수 발행 ${options.autopilot_min_published}개 필요) — 초안으로 생성` } : {}),
        })
      } catch (e) {
        detail.push({ dest: (d as { name?: string }).name || '', reason: String(e instanceof Error ? e.message : e).slice(0, 120) })
      }
    })
  )
  return detail
}

async function handle(req: Request) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const apiKey = process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) return NextResponse.json({ ok: false, error: 'ANTHROPIC_API_KEY(서버) 미설정 — 자동 생성 불가', made: 0, detail: [] }, { status: 200 })
  const detail = await runAutoSchedules(apiKey)
  const made = detail.filter((d) => d.item_id).length
  return NextResponse.json({ ok: true, made, detail })
}

export async function GET(req: Request) {
  return handle(req)
}
export async function POST(req: Request) {
  return handle(req)
}
