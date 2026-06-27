import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 계정 연동 해제: DELETE { account_id } → 토큰 삭제 + 상태 disconnected (스냅샷 이력은 보존).
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}))
  const accountId = (body.account_id || '').toString()
  if (!accountId) return NextResponse.json({ error: 'account_id 가 필요해요.' }, { status: 400 })
  await supabaseAdmin.from('ig_tokens').delete().eq('account_id', accountId)
  await supabaseAdmin.from('ig_accounts').update({ status: 'disconnected', updated_at: new Date().toISOString() }).eq('id', accountId)
  return NextResponse.json({ ok: true })
}
