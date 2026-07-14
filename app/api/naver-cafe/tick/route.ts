import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNaverSettings } from '@/lib/naver/settings'
import { getMeta, setMeta } from '@/lib/naver/pacing'
import { draftPost, type DraftCafe } from '@/lib/naver/generate'
import { cronAuthOk } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 자동 스케줄 틱(리뉴얼 store.run_auto_schedules 포팅). GitHub Actions 크론이 주기적으로 호출.
// 발행처(auto_mode) 별 interval_days 도래 시 → 초안 1건 생성 → auto_publish 면 approved(승인 큐), 아니면 draft.
// PC(로컬 에이전트)가 꺼져 있어도 서버에서 생성되므로 초안이 계속 쌓인다.
// 사전 클레임(auto_last 먼저 기록)으로 잦은 호출에도 중복 생성 안 함.

function pickTopic(destTopics: string, brandTopics: unknown): string {
  const fromDest = (destTopics || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
  const fromBrand = Array.isArray(brandTopics) ? (brandTopics as unknown[]).map((x) => String(x).trim()).filter(Boolean) : []
  const pool = fromDest.length ? fromDest : fromBrand
  if (!pool.length) return ''
  return pool[Math.floor(Math.random() * pool.length)]
}

async function runAutoSchedules(apiKey: string) {
  const nowMs = Date.now()
  const nowISO = new Date().toISOString()
  const { claude } = await getNaverSettings()

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
    const interval = Math.max(1, Number((d as { interval_days?: number }).interval_days) || 3)
    const last = await getMeta(`auto_last:${d.id}`)
    const dueMs = last ? Date.parse(last) + interval * 86400_000 : 0
    if (!last || nowMs >= dueMs) due.push(d)
  }

  await Promise.allSettled(
    due.map(async (d) => {
      // 사전 클레임 — 생성 전에 먼저 기록(잦은 폴링에도 중복 생성 방지)
      await setMeta(`auto_last:${d.id}`, nowISO)
      try {
        const brand = (d as { nc_brands?: { default_topics?: unknown; persona?: string } }).nc_brands
        const topic = pickTopic((d as { topics?: string }).topics || '', brand?.default_topics)
        const cafe: DraftCafe = {
          name: (d as { name?: string }).name || '',
          persona: (d as { tone?: string }).tone || brand?.persona || '',
          topics: (d as { topics?: string }).topics || '',
          notes: (d as { notes?: string }).notes || '',
          emphasis: Array.isArray((d as { emphasis?: unknown }).emphasis) ? ((d as { emphasis?: string[] }).emphasis as string[]) : [],
          selling_point: (d as { selling_point?: string }).selling_point || '',
          rules: (d as { rules?: { promo_banned?: boolean } }).rules || null,
        }
        const { title, body } = await draftPost(apiKey, cafe, topic, claude.model, claude.max_tokens)
        if (!title) {
          detail.push({ dest: cafe.name, reason: '생성 실패' })
          return
        }
        const autoPublish = (d as { auto_publish?: boolean }).auto_publish === true
        const { data: ins } = await supabaseAdmin
          .from('nc_posts')
          .insert({
            cafe_id: d.id,
            kind: 'post',
            title,
            body,
            status: autoPublish ? 'approved' : 'draft',
            origin: 'auto',
            created_by: 'auto-schedule',
            approved_at: autoPublish ? nowISO : null,
          })
          .select('id')
          .single()
        detail.push({ dest: cafe.name, item_id: ins?.id, auto_publish: autoPublish })
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
