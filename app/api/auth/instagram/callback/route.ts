import { NextResponse } from 'next/server'
import { exchangeCodeForToken, exchangeForLongLived, resolveIgAccounts } from '@/lib/ig/tokens'
import { upsertAccountWithToken } from '@/lib/ig/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// OAuth 콜백: code → short-lived → long-lived → IG 계정 해석 → 암호화 토큰 upsert.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const origin = url.origin
  const back = (q: string) => NextResponse.redirect(`${origin}/instagram${q}`)

  const err = url.searchParams.get('error')
  if (err) return back(`?error=${encodeURIComponent(url.searchParams.get('error_description') || err)}`)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const cookieState = req.headers.get('cookie')?.match(/ig_oauth_state=([^;]+)/)?.[1]
  const linkClient = req.headers.get('cookie')?.match(/ig_link_client=([^;]+)/)?.[1] || null

  if (!code) return back('?error=no_code')
  if (!state || !cookieState || state !== cookieState) return back('?error=state_mismatch')

  try {
    const shortTok = await exchangeCodeForToken(code)
    const longTok = await exchangeForLongLived(shortTok.access_token)
    const expiresAt = new Date(Date.now() + (longTok.expires_in ?? 60 * 24 * 3600) * 1000).toISOString()

    const igAccounts = await resolveIgAccounts(longTok.access_token)
    if (!igAccounts.length) {
      return back('?error=no_ig_account') // 프로페셔널 계정+페이지 연결 안 됨 or 테스터 미승인
    }

    // 발견된 모든 IG 계정 저장(보통 1개). 동일 long-lived 토큰 사용.
    for (const ig of igAccounts) {
      await upsertAccountWithToken(
        {
          ig_user_id: ig.ig_user_id,
          ig_username: ig.username,
          name: ig.name,
          profile_picture_url: ig.profile_picture_url,
          fb_page_id: ig.fb_page_id,
          client_id: linkClient,
        },
        { access_token: longTok.access_token, token_type: 'long_lived', expires_at: expiresAt }
      )
    }

    const res = back(`?connected=${igAccounts.length}`)
    res.cookies.set('ig_oauth_state', '', { maxAge: 0, path: '/' })
    res.cookies.set('ig_link_client', '', { maxAge: 0, path: '/' })
    return res
  } catch (e) {
    return back(`?error=${encodeURIComponent(e instanceof Error ? e.message : 'oauth_failed')}`)
  }
}
