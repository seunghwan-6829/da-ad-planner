import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 좌측 사이드바 알림 배지용: 최근 N일(기본 5일) 신규/종료 소재 수 + 변화 시그니처(latest).
// 가볍게 카운트만 — 사이드바가 매 진입 1회 호출.
export async function GET(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ newCount: 0, endedCount: 0, latest: null })

  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 5), 1), 30)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const [nRes, eRes] = await Promise.all([
    supabaseAdmin
      .from('am_ads')
      .select('first_seen_at')
      .gte('first_seen_at', since)
      .order('first_seen_at', { ascending: false }),
    supabaseAdmin
      .from('am_ads')
      .select('ended_at')
      .eq('status', 'ended')
      .gte('ended_at', since)
      .order('ended_at', { ascending: false }),
  ])

  const newRows = nRes.data ?? []
  const endedRows = eRes.data ?? []

  // 변화 시그니처: 가장 최근 변화 타임스탬프(닫기 dismiss 비교용)
  const stamps: string[] = []
  if (newRows[0]?.first_seen_at) stamps.push(newRows[0].first_seen_at)
  if (endedRows[0]?.ended_at) stamps.push(endedRows[0].ended_at)
  const latest = stamps.sort().reverse()[0] ?? null

  return NextResponse.json({
    newCount: newRows.length,
    endedCount: endedRows.length,
    latest,
    days,
  })
}
