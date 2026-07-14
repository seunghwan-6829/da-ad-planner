import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { tokenFor, getMe, publishText } from '@/lib/threads/api'
import { cronAuthOk } from '@/lib/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 쓰레드 발행 틱(원본 publish.py 포팅). GitHub Actions 크론이 주기적으로 호출.
//   - 예약(scheduled_at ≤ now, 24h grace) + 슬롯(mode=publish & 슬롯 ±60분) 발행
//   - 브랜드별 일 상한(max_posts_per_day, 브랜드 타임존 기준)
//   - queued→publishing 낙관적 잠금(이중발행 방지) → Threads API 2-step 발행

const SCHED_GRACE_MS = 24 * 3600_000
const SLOT_WINDOW_MIN = 60

type Brand = { id: string; timezone: string; mode: string; publish_slots: string[]; max_posts_per_day: number }
type Item = { id: string; brand_id: string; text: string; topic_tag: string; category_id: string | null; scheduled_at: string | null; created_at: string; status: string; source_key: string | null }

function safeTz(tz: string): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz || 'Asia/Seoul' }); return tz || 'Asia/Seoul' } catch { return 'Asia/Seoul' }
}

function brandLocal(tz: string) {
  const now = Date.now()
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(now)).map((p) => [p.type, p.value])
  )
  const hour = Number(parts.hour) % 24
  const minute = Number(parts.minute)
  const second = Number(parts.second)
  const minutesOfDay = hour * 60 + minute
  const dayStartUTCms = now - (minutesOfDay * 60 + second) * 1000
  return { minutesOfDay, dayStartUTCms }
}

// 발행 시각을 브랜드 로컬 벽시계 문자열로(published_at_local 표시용).
function brandLocalString(tz: string): string {
  try { return new Date().toLocaleString('sv-SE', { timeZone: safeTz(tz) }).replace(' ', 'T') } catch { return new Date().toISOString() }
}

function inSlotWindow(slots: string[], minutesOfDay: number): boolean {
  for (const s of slots || []) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s)
    if (!m) continue
    const slotMin = Number(m[1]) * 60 + Number(m[2])
    let diff = Math.abs(minutesOfDay - slotMin)
    diff = Math.min(diff, 1440 - diff) // 자정 넘김 고려
    if (diff <= SLOT_WINDOW_MIN) return true
  }
  return false
}

async function publishBrand(brand: Brand, items: Item[]) {
  const token = tokenFor(brand.id)
  if (!token) return { brand: brand.id, skipped: 'no_token' }
  const local = brandLocal(brand.timezone)

  const { count: pubCount } = await supabaseAdmin
    .from('th_published').select('id', { count: 'exact', head: true })
    .eq('brand_id', brand.id).gte('published_at', new Date(local.dayStartUTCms).toISOString())
  let remaining = Math.max(0, (brand.max_posts_per_day || 3) - (pubCount || 0))
  if (remaining <= 0) return { brand: brand.id, published: 0, reason: 'daily_cap' }

  const now = Date.now()
  const scheduled = items
    .filter((i) => i.scheduled_at && Date.parse(i.scheduled_at) <= now && now - Date.parse(i.scheduled_at) <= SCHED_GRACE_MS)
    .sort((a, b) => Date.parse(a.scheduled_at!) - Date.parse(b.scheduled_at!))
  const slotItems = brand.mode === 'publish' && inSlotWindow(brand.publish_slots || [], local.minutesOfDay)
    ? items.filter((i) => !i.scheduled_at).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    : []
  const eligible = [...scheduled, ...slotItems].slice(0, remaining)

  let meId: string | null = null
  const results: { id: string; ok: boolean; media_id?: string; error?: string }[] = []
  for (const item of eligible) {
    if (remaining <= 0) break
    // 낙관적 잠금: queued → publishing (경합 시 0행이면 스킵)
    const { data: locked } = await supabaseAdmin.from('th_queue')
      .update({ status: 'publishing' }).eq('id', item.id).eq('status', 'queued').select('id')
    if (!locked?.length) continue
    // ★ 멱등: 이미 발행 이력이 있으면 재발행 금지(응답 유실로 재시도된 경우 등). 발행 이력과 큐 상태만 정합화.
    const { data: already } = await supabaseAdmin.from('th_published').select('id').eq('queue_id', item.id).limit(1)
    if (already?.length) {
      await supabaseAdmin.from('th_queue').update({ status: 'published', error: null }).eq('id', item.id)
      continue
    }
    try {
      if (!meId) meId = (await getMe(token)).id
      const mediaId = await publishText(token, meId, item.text, item.topic_tag)
      const nowISO = new Date().toISOString()
      // 발행 이력 먼저 기록(멱등키 queue_id 유니크) → 큐 published 로.
      await supabaseAdmin.from('th_published').insert({
        brand_id: brand.id, queue_id: item.id, media_id: mediaId, text: item.text,
        category: item.category_id, topic_tag: item.topic_tag, source_key: item.source_key || null,
        published_at: nowISO, published_at_local: brandLocalString(brand.timezone),
      })
      await supabaseAdmin.from('th_queue').update({ status: 'published', media_id: mediaId, error: null }).eq('id', item.id)
      results.push({ id: item.id, ok: true, media_id: mediaId })
      remaining--
    } catch (e) {
      const msg = String((e as Error).message || e).slice(0, 300)
      // 발행 단계에서 응답이 유실됐을 수 있음 → 재시도 전 Threads에서 중복 여부 확인 권장.
      await supabaseAdmin.from('th_queue').update({ status: 'failed', error: msg }).eq('id', item.id)
      results.push({ id: item.id, ok: false, error: msg.slice(0, 120) })
    }
  }
  return { brand: brand.id, published: results.filter((r) => r.ok).length, results }
}

async function handle(req: Request) {
  if (!cronAuthOk(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { data: items } = await supabaseAdmin.from('th_queue').select('*').eq('status', 'queued').order('created_at', { ascending: true }).limit(200)
  if (!items?.length) return NextResponse.json({ ok: true, published: 0, detail: [] })
  const { data: brands } = await supabaseAdmin.from('th_brands').select('*').eq('enabled', true)
  const brandMap = new Map<string, Brand>((brands || []).map((b) => [b.id, b as Brand]))
  const byBrand = new Map<string, Item[]>()
  for (const it of items as Item[]) { const arr = byBrand.get(it.brand_id) || []; arr.push(it); byBrand.set(it.brand_id, arr) }

  const detail: unknown[] = []
  for (const [bid, list] of byBrand) {
    const brand = brandMap.get(bid)
    if (!brand) continue
    try { detail.push(await publishBrand(brand, list)) }
    catch (e) { detail.push({ brand: bid, error: String((e as Error).message || e).slice(0, 120) }) }
  }
  const published = detail.reduce((s: number, d) => s + ((d as { published?: number }).published || 0), 0)
  return NextResponse.json({ ok: true, published, detail })
}

export async function GET(req: Request) { return handle(req) }
export async function POST(req: Request) { return handle(req) }
