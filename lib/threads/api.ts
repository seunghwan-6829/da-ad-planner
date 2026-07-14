// Meta Threads API(공식 Graph). 발행은 순수 HTTP라 서버(크론)에서 실행 가능.
// 토큰: 브랜드별 THREADS_TOKEN_<BRANDID大문자> 환경변수(장기 토큰, 60일). 절대 클라이언트 노출 금지.
// 원본 threads_api.py / publish.py 포팅.

const BASE = 'https://graph.threads.net/v1.0'

export function tokenEnvName(brandId: string): string {
  return 'THREADS_TOKEN_' + String(brandId).toUpperCase().replace(/[^A-Z0-9]/g, '_')
}
export function tokenFor(brandId: string): string | null {
  return process.env[tokenEnvName(brandId)] || null
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.set(k, String(v))
  return u.toString()
}

async function apiGet(path: string, params: Record<string, string | number | undefined>) {
  const r = await fetch(`${BASE}${path}?${qs(params)}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Threads GET ${path} ${r.status}`)
  return j
}
async function apiPost(path: string, params: Record<string, string | number | undefined>) {
  // Graph API 는 POST 도 쿼리스트링 파라미터를 받는다(원본 requests.post(params=) 와 동일).
  const r = await fetch(`${BASE}${path}?${qs(params)}`, { method: 'POST' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Threads POST ${path} ${r.status}`)
  return j
}

export interface ThreadsMe { id: string; username: string }
export async function getMe(token: string): Promise<ThreadsMe> {
  const j = await apiGet('/me', { fields: 'id,username', access_token: token })
  return { id: j.id, username: j.username }
}

// 태그 정리: '.', '&', '#' 제거 + 50자 제한(원본과 동일)
export function sanitizeTopicTag(tag: string | null | undefined): string {
  return (tag || '').replace(/[.&#]/g, '').trim().slice(0, 50)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 텍스트 발행(2-step: 컨테이너 생성 → 상태 폴링 → publish). 성공 시 media id 반환.
export async function publishText(token: string, meId: string, text: string, topicTag?: string): Promise<string> {
  const params: Record<string, string | number | undefined> = { media_type: 'TEXT', text: text.slice(0, 500), access_token: token }
  const tag = sanitizeTopicTag(topicTag)
  if (tag) params.topic_tag = tag
  const created = await apiPost(`/${meId}/threads`, params)
  const creationId = created.id
  if (!creationId) throw new Error('컨테이너 생성 실패(creation_id 없음)')
  // 상태 폴링(최대 8회 x 2s)
  for (let i = 0; i < 8; i++) {
    try {
      const st = await apiGet(`/${creationId}`, { fields: 'status', access_token: token })
      const status = (st.status || '').toString().toUpperCase()
      if (status === 'FINISHED') break
      if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`컨테이너 상태 ${status}`)
    } catch (e) {
      if (String((e as Error).message).includes('컨테이너 상태')) throw e
      // 조회 실패는 잠깐 후 재시도
    }
    await sleep(2000)
  }
  const published = await apiPost(`/${meId}/threads_publish`, { creation_id: creationId, access_token: token })
  if (!published.id) throw new Error('발행 실패(media id 없음)')
  return published.id
}

export interface RecentThread { id: string; text: string; timestamp: string; media_type: string; permalink: string }
export async function getRecentThreads(token: string, meId: string, sinceDays = 14): Promise<RecentThread[]> {
  const sinceSec = Math.floor((Date.now() - sinceDays * 86400_000) / 1000)
  const j = await apiGet(`/${meId}/threads`, { fields: 'id,text,timestamp,media_type,permalink', since: sinceSec, limit: 50, access_token: token })
  return (j.data || []) as RecentThread[]
}

export interface InsightMetrics { views: number; likes: number; replies: number; reposts: number; quotes: number; shares: number }
export async function getInsights(token: string, mediaId: string): Promise<InsightMetrics> {
  const j = await apiGet(`/${mediaId}/insights`, { metric: 'views,likes,replies,reposts,quotes,shares', access_token: token })
  const out: InsightMetrics = { views: 0, likes: 0, replies: 0, reposts: 0, quotes: 0, shares: 0 }
  for (const m of j.data || []) {
    const name = (m.name || '') as keyof InsightMetrics
    const val = m.values?.[0]?.value ?? m.total_value?.value ?? 0
    if (name in out) out[name] = Number(val) || 0
  }
  return out
}

// 장기 토큰 갱신(24h 후 ~ 만료 전). 새 토큰/만료(초) 반환.
export async function refreshLongLivedToken(token: string): Promise<{ access_token: string; expires_in: number }> {
  const r = await fetch(`https://graph.threads.net/refresh_access_token?${qs({ grant_type: 'th_refresh_token', access_token: token })}`)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `refresh ${r.status}`)
  return { access_token: j.access_token, expires_in: Number(j.expires_in) || 0 }
}
