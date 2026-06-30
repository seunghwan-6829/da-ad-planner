import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

// 데이터 추적(Pulseboard) 수집 엔드포인트. 아임웹 사이트에 심긴 트래커가 이벤트를 POST.
// 공개(CORS *) 입구지만 pb_analytics_events 한 테이블에만 insert → service_role로만 접근(브라우저 차단).
export const dynamic = 'force-dynamic'

type AnalyticsEventPayload = {
  siteId: string
  sessionId: string
  visitorId: string
  eventType: string
  path?: string
  url?: string
  referrer?: string
  deviceType?: string
  pageRegion?: string
  elementLabel?: string
  scrollPercent?: number
  funnelStep?: string
  durationMs?: number
  maxScrollPercent?: number
  clickX?: number
  clickY?: number
  viewportWidth?: number
  viewportHeight?: number
  metadata?: Record<string, string | number | boolean | null>
}

function getRequestIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]?.trim() || null
  return request.headers.get('x-real-ip')
}

function isPayload(value: unknown): value is AnalyticsEventPayload {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return (
    typeof p.siteId === 'string' &&
    typeof p.sessionId === 'string' &&
    typeof p.visitorId === 'string' &&
    typeof p.eventType === 'string'
  )
}

function withCors(response: NextResponse) {
  response.headers.set('Access-Control-Allow-Origin', '*')
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  return response
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }))
}

export async function POST(request: Request) {
  const json = await request.json().catch(() => null)
  if (!isPayload(json)) {
    return withCors(NextResponse.json({ ok: false, error: 'Invalid event payload.' }, { status: 400 }))
  }

  const supabase = supabaseAdmin
  if (!supabase) {
    return withCors(
      NextResponse.json({ ok: true, stored: false, message: 'Supabase is not configured yet. Dry-run.' })
    )
  }

  const ipAddress = getRequestIp(request) ?? json.visitorId

  const { error } = await supabase.from('pb_analytics_events').insert({
    site_id: json.siteId,
    session_id: json.sessionId,
    visitor_id: json.visitorId,
    event_type: json.eventType,
    path: json.path ?? null,
    url: json.url ?? null,
    referrer: json.referrer ?? null,
    device_type: json.deviceType ?? null,
    page_region: json.pageRegion ?? null,
    element_label: json.elementLabel ?? null,
    scroll_percent: json.scrollPercent ?? null,
    funnel_step: json.funnelStep ?? null,
    duration_ms: json.durationMs ?? null,
    max_scroll_percent: json.maxScrollPercent ?? null,
    click_x: json.clickX ?? null,
    click_y: json.clickY ?? null,
    viewport_width: json.viewportWidth ?? null,
    viewport_height: json.viewportHeight ?? null,
    ip_address: ipAddress,
    metadata: json.metadata ?? {},
  })

  if (error) return withCors(NextResponse.json({ ok: false, error: error.message }, { status: 500 }))
  return withCors(NextResponse.json({ ok: true, stored: true }))
}
