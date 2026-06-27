import { NextResponse } from 'next/server'
import { syncAccount } from '@/lib/ig/sync'
import { listActiveAccounts, getDecryptedToken, saveRefreshedToken, setAccountStatus } from '@/lib/ig/store'
import { refreshLongLived } from '@/lib/ig/tokens'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 크론(CRON_SECRET 보호). ?job=sync(기본) | refresh
// - refresh: 만료 10일 이내 토큰 갱신
// - sync: 갱신-필요시-먼저 + 활성 계정 전체 스냅샷
const TEN_DAYS = 10 * 24 * 3600 * 1000

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const url = new URL(req.url)
  const q = url.searchParams.get('secret')
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  return q === secret || bearer === secret
}

async function refreshExpiring(): Promise<{ refreshed: number; failed: number }> {
  const accounts = await listActiveAccounts()
  let refreshed = 0
  let failed = 0
  for (const a of accounts) {
    const tk = await getDecryptedToken(a.id)
    if (!tk?.token) continue
    const exp = tk.expires_at ? new Date(tk.expires_at).getTime() : 0
    if (exp && exp - Date.now() > TEN_DAYS) continue // 아직 여유
    try {
      const fresh = await refreshLongLived(tk.token)
      const newExp = new Date(Date.now() + (fresh.expires_in ?? 60 * 24 * 3600) * 1000).toISOString()
      await saveRefreshedToken(a.id, fresh.access_token, newExp)
      refreshed++
    } catch {
      await setAccountStatus(a.id, 'token_expired')
      failed++
    }
  }
  return { refreshed, failed }
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const job = new URL(req.url).searchParams.get('job') || 'sync'

  if (job === 'refresh') {
    const r = await refreshExpiring()
    return NextResponse.json({ job, ...r })
  }

  // sync: 먼저 만료 임박 토큰 갱신 후 전체 동기화
  const refresh = await refreshExpiring()
  const accounts = await listActiveAccounts()
  const results: Record<string, unknown>[] = []
  for (const a of accounts) {
    const r = await syncAccount(a.id)
    results.push({ account_id: a.id, ig_username: a.ig_username, ...r })
  }
  return NextResponse.json({ job, refresh, synced: results.length, results })
}

export async function GET(req: Request) {
  return handle(req)
}
export async function POST(req: Request) {
  return handle(req)
}
