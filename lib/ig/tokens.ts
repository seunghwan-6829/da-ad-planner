// OAuth 토큰 라이프사이클: code → short-lived → long-lived(60일) → 만료 전 갱신.
// 그리고 연결된 페이지에서 Instagram 비즈니스 계정(ig_user_id) 해석.
import { GRAPH_BASE, graphGet } from './graph'

const APP_ID = () => process.env.META_APP_ID || ''
const APP_SECRET = () => process.env.META_APP_SECRET || ''
const REDIRECT = () => process.env.OAUTH_REDIRECT_URI || ''

export interface TokenInfo {
  access_token: string
  expires_in?: number // 초
}

// 1) 인가 코드 → short-lived 사용자 토큰
export async function exchangeCodeForToken(code: string): Promise<TokenInfo> {
  const { data } = await graphGet<any>(`${GRAPH_BASE}/oauth/access_token`, {
    client_id: APP_ID(),
    client_secret: APP_SECRET(),
    redirect_uri: REDIRECT(),
    code,
  })
  if (!data.access_token) throw new Error('토큰 교환 실패(코드 무효/리다이렉트 불일치)')
  return { access_token: data.access_token, expires_in: data.expires_in }
}

// 2) short-lived → long-lived(약 60일) 토큰
export async function exchangeForLongLived(shortToken: string): Promise<TokenInfo> {
  const { data } = await graphGet<any>(`${GRAPH_BASE}/oauth/access_token`, {
    grant_type: 'fb_exchange_token',
    client_id: APP_ID(),
    client_secret: APP_SECRET(),
    fb_exchange_token: shortToken,
  })
  if (!data.access_token) throw new Error('long-lived 토큰 교환 실패')
  return { access_token: data.access_token, expires_in: data.expires_in ?? 60 * 24 * 3600 }
}

// 3) long-lived 토큰 갱신(만료 임박 시 재교환). 동일 grant 로 새 60일 토큰 발급.
export async function refreshLongLived(currentToken: string): Promise<TokenInfo> {
  return exchangeForLongLived(currentToken)
}

export interface ResolvedIgAccount {
  ig_user_id: string
  username?: string
  name?: string
  profile_picture_url?: string
  fb_page_id?: string
}

// 4) 사용자 토큰으로 연결된 페이지들에서 instagram_business_account 해석.
//    프로페셔널 계정 + 페이지 연결된 것만 잡힌다. 첫 번째 유효 계정을 반환(여러 개면 추후 선택 UI로 확장 가능).
export async function resolveIgAccounts(userToken: string): Promise<ResolvedIgAccount[]> {
  const { data } = await graphGet<any>(`${GRAPH_BASE}/me/accounts`, {
    fields: 'id,name,instagram_business_account{id,username,name,profile_picture_url}',
    access_token: userToken,
    limit: 100,
  })
  const pages: any[] = data?.data || []
  const out: ResolvedIgAccount[] = []
  for (const p of pages) {
    const ig = p.instagram_business_account
    if (ig?.id) {
      out.push({
        ig_user_id: ig.id,
        username: ig.username,
        name: ig.name,
        profile_picture_url: ig.profile_picture_url,
        fb_page_id: p.id,
      })
    }
  }
  return out
}
