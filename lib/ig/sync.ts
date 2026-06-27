// 클라이언트별 인스타 동기화 엔진. 멱등(스냅샷 누적), 방어적(메트릭 에러는 스킵+로깅), 레이트리밋 백오프(graphGet).
// ⚠️ 메트릭/필드 이름은 메타가 분기마다 바꾼다. 에러 나는 지표는 자동 스킵하므로 안전하지만, 주기적으로 최신 문서 확인 권장.
import { GRAPH_BASE, graphGet } from './graph'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getDecryptedToken, logSync, setAccountStatus, getAccount } from './store'

// 계정 단위 인사이트(최근 구조: 일부는 metric_type=total_value 필요). 후보 — 에러 나는 건 스킵.
const ACCOUNT_TOTAL_VALUE_METRICS = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'profile_links_taps']
// 미디어 타입별 가능한 메트릭(후보). 타입에 안 맞는 건 그래프가 에러 → 스킵.
const MEDIA_METRICS_BY_TYPE: Record<string, string[]> = {
  REELS: ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'views'],
  FEED: ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
  STORY: ['reach', 'replies', 'total_interactions'],
  DEFAULT: ['reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions'],
}

// 인사이트 항목에서 숫자값 읽기(total_value 구조 / values[] 구조 모두 대응)
function readInsightValue(item: any): number | null {
  if (item?.total_value?.value != null) return Number(item.total_value.value)
  if (Array.isArray(item?.values) && item.values.length) {
    const v = item.values[item.values.length - 1]?.value
    if (typeof v === 'number') return v
  }
  if (typeof item?.value === 'number') return item.value
  return null
}

interface SyncResult {
  status: 'ok' | 'partial' | 'error'
  calls: number
  skipped: string[]
  error?: string
}

// 계정 1개 전체 동기화
export async function syncAccount(accountId: string): Promise<SyncResult> {
  const acc = await getAccount(accountId)
  if (!acc) return { status: 'error', calls: 0, skipped: [], error: '계정 없음' }
  const tk = await getDecryptedToken(accountId)
  if (!tk?.token) {
    await setAccountStatus(accountId, 'token_expired')
    await logSync(accountId, 'error', 0, '토큰 없음/복호화 실패')
    return { status: 'error', calls: 0, skipped: [], error: '토큰 없음' }
  }
  const token = tk.token
  const igId = acc.ig_user_id
  let calls = 0
  const skipped: string[] = []

  try {
    // ── 1) 계정 기본 ──
    const basic = await graphGet<any>(igId, {
      fields: 'username,name,profile_picture_url,followers_count,follows_count,media_count',
      access_token: token,
    })
    calls += basic.calls
    const b = basic.data

    // ── 2) 계정 인사이트(방어적: 그룹 실패 시 개별 재시도, 그래도 실패면 스킵) ──
    const insightValues: Record<string, number | null> = {}
    let insightRaw: any = null
    try {
      const ins = await graphGet<any>(`${igId}/insights`, {
        metric: ACCOUNT_TOTAL_VALUE_METRICS.join(','),
        metric_type: 'total_value',
        period: 'day',
        access_token: token,
      })
      calls += ins.calls
      insightRaw = ins.data
      for (const it of ins.data?.data || []) insightValues[it.name] = readInsightValue(it)
    } catch {
      // 그룹 실패 → 메트릭별로 하나씩(어떤 게 deprecated인지 모르므로)
      for (const m of ACCOUNT_TOTAL_VALUE_METRICS) {
        try {
          const r = await graphGet<any>(`${igId}/insights`, { metric: m, metric_type: 'total_value', period: 'day', access_token: token })
          calls += r.calls
          const it = r.data?.data?.[0]
          if (it) insightValues[m] = readInsightValue(it)
        } catch {
          skipped.push(`account_insight:${m}`)
        }
      }
    }

    await supabaseAdmin.from('ig_account_snapshots').insert({
      account_id: accountId,
      followers_count: b.followers_count ?? null,
      follows_count: b.follows_count ?? null,
      media_count: b.media_count ?? null,
      reach: insightValues.reach ?? null,
      views: insightValues.views ?? null,
      accounts_engaged: insightValues.accounts_engaged ?? null,
      total_interactions: insightValues.total_interactions ?? null,
      profile_links_taps: insightValues.profile_links_taps ?? null,
      raw: insightRaw,
    })

    // 계정 메타 최신화(프사/유저명 변동 반영)
    await supabaseAdmin
      .from('ig_accounts')
      .update({ ig_username: b.username ?? acc.ig_username, name: b.name ?? acc.name, profile_picture_url: b.profile_picture_url ?? acc.profile_picture_url, status: 'active', updated_at: new Date().toISOString() })
      .eq('id', accountId)

    // ── 3) 팔로워 인구통계(100명 이상에서만, 상위 항목만). 미달/에러는 스킵 ──
    if ((b.followers_count ?? 0) >= 100) {
      for (const dim of ['city', 'country', 'age'] as const) {
        try {
          const d = await graphGet<any>(`${igId}/insights`, {
            metric: 'follower_demographics',
            period: 'lifetime',
            metric_type: 'total_value',
            breakdown: dim,
            access_token: token,
          })
          calls += d.calls
          const results = d.data?.data?.[0]?.total_value?.breakdowns?.[0]?.results || []
          const breakdown: Record<string, number> = {}
          for (const r of results) {
            const label = Array.isArray(r.dimension_values) ? r.dimension_values.join(' · ') : String(r.dimension_values ?? '')
            breakdown[label] = Number(r.value) || 0
          }
          if (Object.keys(breakdown).length) {
            await supabaseAdmin.from('ig_demographics_snapshots').insert({
              account_id: accountId,
              type: dim === 'age' ? 'age_gender' : dim,
              breakdown,
            })
          }
        } catch {
          skipped.push(`demographics:${dim}`)
        }
      }
    } else {
      skipped.push('demographics:followers<100')
    }

    // ── 4) 최근 미디어 ──
    const mediaRes = await graphGet<any>(`${igId}/media`, {
      fields: 'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
      limit: 25,
      access_token: token,
    })
    calls += mediaRes.calls
    const mediaList: any[] = mediaRes.data?.data || []

    for (const m of mediaList) {
      // 미디어 메타 upsert
      await supabaseAdmin.from('ig_media').upsert(
        {
          account_id: accountId,
          ig_media_id: m.id,
          media_type: m.media_type ?? null,
          media_product_type: m.media_product_type ?? null,
          caption: m.caption ?? null,
          permalink: m.permalink ?? null,
          thumbnail_url: m.thumbnail_url ?? null,
          media_url: m.media_url ?? null,
          timestamp: m.timestamp ?? null,
        },
        { onConflict: 'ig_media_id' }
      )

      // ── 5) 미디어 인사이트(타입별 메트릭, 방어적) ──
      const metricList = MEDIA_METRICS_BY_TYPE[m.media_product_type] || MEDIA_METRICS_BY_TYPE.DEFAULT
      const mv: Record<string, number | null> = {}
      let mRaw: any = null
      try {
        const mi = await graphGet<any>(`${m.id}/insights`, { metric: metricList.join(','), access_token: token })
        calls += mi.calls
        mRaw = mi.data
        for (const it of mi.data?.data || []) mv[it.name] = readInsightValue(it)
      } catch {
        // 타입에 안 맞는 메트릭이 섞이면 통째로 실패 → 개별 시도
        for (const mm of metricList) {
          try {
            const r = await graphGet<any>(`${m.id}/insights`, { metric: mm, access_token: token })
            calls += r.calls
            const it = r.data?.data?.[0]
            if (it) mv[mm] = readInsightValue(it)
          } catch {
            skipped.push(`media_insight:${m.media_product_type || m.media_type}:${mm}`)
          }
        }
      }

      await supabaseAdmin.from('ig_media_metrics').insert({
        ig_media_id: m.id,
        account_id: accountId,
        like_count: m.like_count ?? null,
        comments_count: m.comments_count ?? null,
        reach: mv.reach ?? null,
        saved: mv.saved ?? null,
        shares: mv.shares ?? null,
        views: mv.views ?? null,
        total_interactions: mv.total_interactions ?? null,
        raw: mRaw,
      })
    }

    const status: SyncResult['status'] = skipped.length ? 'partial' : 'ok'
    await logSync(accountId, status, calls, skipped.length ? `skipped: ${skipped.join(', ')}` : undefined)
    return { status, calls, skipped }
  } catch (e) {
    const msg = e instanceof Error ? e.message : '동기화 실패'
    // 토큰 만료(190 등) 감지
    if (/expired|session has been invalidated|code\s*1?90|access token/i.test(msg)) {
      await setAccountStatus(accountId, 'token_expired')
    }
    await logSync(accountId, 'error', calls, msg)
    return { status: 'error', calls, skipped, error: msg }
  }
}

export { readInsightValue }
