import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 좌측 사이드바 알림 배지 + 대시보드 '이번 주 신규' 용: 최근 N일(기본 5일) 신규/종료 소재 수 + 변화 시그니처(latest).
// ⚠️ 예전엔 행을 전부 받아 .length 로 셌는데 Supabase 요청당 1000행 캡에 걸려 신규가 1000에서 멈췄다.
//    → exact count(행 전송 없음)로 정확히 세고, latest(시그니처)만 최신 1행을 따로 조회.
export async function GET(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ newCount: 0, endedCount: 0, latest: null })

  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(Number(searchParams.get('days') ?? 5), 1), 30)
  const since = new Date(Date.now() - days * 86400000).toISOString()

  const [nCount, eCount, nLatest, eLatest] = await Promise.all([
    supabaseAdmin.from('am_ads').select('*', { count: 'exact', head: true }).gte('first_seen_at', since),
    supabaseAdmin.from('am_ads').select('*', { count: 'exact', head: true }).eq('status', 'ended').gte('ended_at', since),
    supabaseAdmin.from('am_ads').select('first_seen_at').gte('first_seen_at', since).order('first_seen_at', { ascending: false }).limit(1),
    supabaseAdmin.from('am_ads').select('ended_at').eq('status', 'ended').gte('ended_at', since).order('ended_at', { ascending: false }).limit(1),
  ])

  // 변화 시그니처: 가장 최근 변화 타임스탬프(닫기 dismiss 비교용)
  const stamps: string[] = []
  if (nLatest.data?.[0]?.first_seen_at) stamps.push(nLatest.data[0].first_seen_at)
  if (eLatest.data?.[0]?.ended_at) stamps.push(eLatest.data[0].ended_at)
  const latest = stamps.sort().reverse()[0] ?? null

  return NextResponse.json({
    newCount: nCount.count || 0,
    endedCount: eCount.count || 0,
    latest,
    days,
  })
}
