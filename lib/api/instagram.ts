// 인스타 성과 — 브라우저 읽기(anon, RLS authenticated). 토큰 테이블(ig_tokens)은 읽지 않는다(서버 전용).
import { supabase } from '@/lib/supabase'
import { IgAccount, IgAccountSnapshot, IgDemographicsSnapshot, IgMedia, IgMediaMetric } from '@/lib/ig/types'

export async function getIgAccounts(): Promise<IgAccount[]> {
  const { data, error } = await supabase
    .from('ig_accounts')
    .select('*')
    .neq('status', 'disconnected')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as IgAccount[]) || []
}

export async function getAccountSnapshots(accountId: string, sinceISO?: string): Promise<IgAccountSnapshot[]> {
  let q = supabase.from('ig_account_snapshots').select('*').eq('account_id', accountId).order('captured_at', { ascending: true })
  if (sinceISO) q = q.gte('captured_at', sinceISO)
  const { data, error } = await q
  if (error) throw error
  return (data as IgAccountSnapshot[]) || []
}

export async function getMedia(accountId: string): Promise<IgMedia[]> {
  const { data, error } = await supabase
    .from('ig_media')
    .select('*')
    .eq('account_id', accountId)
    .order('timestamp', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data as IgMedia[]) || []
}

// 미디어별 "최신" 메트릭 1건씩 (captured_at desc 에서 첫 행)
export async function getLatestMediaMetrics(accountId: string): Promise<Map<string, IgMediaMetric>> {
  const { data, error } = await supabase
    .from('ig_media_metrics')
    .select('*')
    .eq('account_id', accountId)
    .order('captured_at', { ascending: false })
    .limit(500)
  if (error) throw error
  const map = new Map<string, IgMediaMetric>()
  for (const row of (data as IgMediaMetric[]) || []) {
    if (!map.has(row.ig_media_id)) map.set(row.ig_media_id, row) // 첫 번째(=최신)만
  }
  return map
}

// 타입별 "최신" 인구통계 스냅샷
export async function getLatestDemographics(accountId: string): Promise<Record<string, IgDemographicsSnapshot>> {
  const { data, error } = await supabase
    .from('ig_demographics_snapshots')
    .select('*')
    .eq('account_id', accountId)
    .order('captured_at', { ascending: false })
    .limit(50)
  if (error) throw error
  const out: Record<string, IgDemographicsSnapshot> = {}
  for (const row of (data as IgDemographicsSnapshot[]) || []) {
    if (!out[row.type]) out[row.type] = row
  }
  return out
}
