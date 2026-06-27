import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { FB_DIALOG, OAUTH_SCOPES } from '@/lib/ig/graph'

export const dynamic = 'force-dynamic'

// 연동 시작: FB 인가 URL로 리다이렉트. ?client_id= 로 기존 광고주(clients)와 연결 가능(선택).
export async function GET(req: Request) {
  const appId = process.env.META_APP_ID
  const redirect = process.env.OAUTH_REDIRECT_URI
  const origin = new URL(req.url).origin
  if (!appId || !redirect) {
    return NextResponse.redirect(`${origin}/instagram?error=config`)
  }
  const url = new URL(req.url)
  const linkClient = url.searchParams.get('client_id') || ''
  const state = crypto.randomBytes(16).toString('hex')

  const authUrl = new URL(FB_DIALOG)
  authUrl.searchParams.set('client_id', appId)
  authUrl.searchParams.set('redirect_uri', redirect)
  authUrl.searchParams.set('scope', OAUTH_SCOPES.join(','))
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('state', state)

  const res = NextResponse.redirect(authUrl.toString())
  // CSRF 방지용 state + 연결할 광고주 id 를 httpOnly 쿠키로 보관(콜백에서 검증)
  res.cookies.set('ig_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  if (linkClient) res.cookies.set('ig_link_client', linkClient, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
