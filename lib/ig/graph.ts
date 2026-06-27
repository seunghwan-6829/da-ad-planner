// Instagram Graph API (via Facebook Login for Business) — 호출 래퍼 + 버전 중앙관리 + 레이트리밋 백오프.
// ⚠️ 엔드포인트/필드/스코프/메트릭 이름은 메타가 분기마다 바꾼다. 구현 직전 developers.facebook.com 최신 문서로 재확인할 것.

export const GRAPH_VERSION = process.env.GRAPH_VERSION || 'v22.0'
export const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
export const FB_DIALOG = `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`

// 연동에 필요한 스코프(문서로 검증 후 사용). 안 쓰는 스코프 요청 금지.
export const OAUTH_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
]

export type GraphParams = Record<string, string | number | undefined>

export interface GraphError extends Error {
  status?: number
  code?: number
  subcode?: number
  appUsage?: string
}

function buildUrl(path: string, params: GraphParams): string {
  const base = path.startsWith('http') ? path : `${GRAPH_BASE}/${path.replace(/^\//, '')}`
  const url = new URL(base)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  return url.toString()
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// 재시도가 의미있는 레이트리밋/일시 오류 코드 (BUC: 4/17/32/613, 그 외 429)
const RETRYABLE_CODES = new Set([4, 17, 32, 613, 1, 2])

export interface GraphResult<T = any> {
  data: T
  calls: number
  appUsage?: string
}

// GET 호출. 429 및 레이트리밋 코드에서 지수 백오프 재시도. 헤더 X-App-Usage / X-Business-Use-Case-Usage 읽음.
export async function graphGet<T = any>(
  path: string,
  params: GraphParams,
  opts: { retries?: number; tag?: string } = {}
): Promise<GraphResult<T>> {
  const retries = opts.retries ?? 3
  let calls = 0
  let lastErr: GraphError | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    calls++
    let res: Response
    try {
      res = await fetch(buildUrl(path, params), { method: 'GET' })
    } catch (e) {
      lastErr = Object.assign(new Error(e instanceof Error ? e.message : '네트워크 오류'), { code: -1 }) as GraphError
      await sleep(500 * 2 ** attempt)
      continue
    }
    const appUsage = res.headers.get('x-app-usage') || res.headers.get('x-business-use-case-usage') || undefined
    const json: any = await res.json().catch(() => ({}))

    if (res.ok && !json.error) {
      return { data: json as T, calls, appUsage }
    }

    const err: GraphError = Object.assign(new Error(json.error?.message || `Graph ${res.status}`), {
      status: res.status,
      code: json.error?.code,
      subcode: json.error?.error_subcode,
      appUsage,
    })
    lastErr = err

    const retryable = res.status === 429 || (json.error?.code && RETRYABLE_CODES.has(json.error.code))
    if (!retryable || attempt === retries) break
    // 지수 백오프(+지터)
    await sleep(Math.min(30000, 800 * 2 ** attempt) + Math.random() * 400)
  }
  throw lastErr || new Error('Graph 요청 실패')
}
