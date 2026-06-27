import { NextResponse } from 'next/server'
import { syncAccount } from '@/lib/ig/sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// 수동 동기화: POST { account_id } → 해당 계정 즉시 스냅샷 수집.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const accountId = (body.account_id || '').toString()
  if (!accountId) return NextResponse.json({ error: 'account_id 가 필요해요.' }, { status: 400 })
  const result = await syncAccount(accountId)
  const status = result.status === 'error' ? 500 : 200
  return NextResponse.json(result, { status })
}
