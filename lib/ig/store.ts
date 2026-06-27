// 서버 전용 DB 헬퍼(service_role). 토큰 암복호화 포함. 브라우저에서 import 금지.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { encryptToken, decryptToken } from './crypto'
import { IgAccount } from './types'

export interface UpsertAccountInput {
  ig_user_id: string
  ig_username?: string
  name?: string
  profile_picture_url?: string
  fb_page_id?: string
  client_id?: string | null
  created_by?: string | null
}

// 계정 upsert(ig_user_id 기준) + 토큰 암호화 저장
export async function upsertAccountWithToken(
  acc: UpsertAccountInput,
  token: { access_token: string; token_type?: string; expires_at?: string }
): Promise<IgAccount> {
  const { data: row, error } = await supabaseAdmin
    .from('ig_accounts')
    .upsert(
      {
        ig_user_id: acc.ig_user_id,
        ig_username: acc.ig_username ?? null,
        name: acc.name ?? null,
        profile_picture_url: acc.profile_picture_url ?? null,
        fb_page_id: acc.fb_page_id ?? null,
        client_id: acc.client_id ?? null,
        created_by: acc.created_by ?? null,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'ig_user_id' }
    )
    .select()
    .single()
  if (error) throw error

  const { error: tErr } = await supabaseAdmin.from('ig_tokens').upsert(
    {
      account_id: row.id,
      access_token_enc: encryptToken(token.access_token),
      token_type: token.token_type ?? 'long_lived',
      expires_at: token.expires_at ?? null,
      last_refreshed_at: new Date().toISOString(),
    },
    { onConflict: 'account_id' }
  )
  if (tErr) throw tErr
  return row as IgAccount
}

export async function getAccount(accountId: string): Promise<IgAccount | null> {
  const { data } = await supabaseAdmin.from('ig_accounts').select('*').eq('id', accountId).single()
  return (data as IgAccount) ?? null
}

export async function listActiveAccounts(): Promise<IgAccount[]> {
  const { data } = await supabaseAdmin.from('ig_accounts').select('*').neq('status', 'disconnected')
  return (data as IgAccount[]) ?? []
}

// 복호화된 액세스 토큰 가져오기(서버 전용)
export async function getDecryptedToken(accountId: string): Promise<{ token: string; expires_at: string | null } | null> {
  const { data } = await supabaseAdmin
    .from('ig_tokens')
    .select('access_token_enc, expires_at')
    .eq('account_id', accountId)
    .single()
  if (!data?.access_token_enc) return null
  try {
    return { token: decryptToken(data.access_token_enc), expires_at: data.expires_at }
  } catch {
    return null
  }
}

export async function saveRefreshedToken(accountId: string, accessToken: string, expiresAt: string): Promise<void> {
  await supabaseAdmin
    .from('ig_tokens')
    .update({ access_token_enc: encryptToken(accessToken), expires_at: expiresAt, last_refreshed_at: new Date().toISOString() })
    .eq('account_id', accountId)
}

export async function setAccountStatus(accountId: string, status: string): Promise<void> {
  await supabaseAdmin.from('ig_accounts').update({ status, updated_at: new Date().toISOString() }).eq('id', accountId)
}

export async function logSync(accountId: string, status: string, calls: number, error?: string): Promise<void> {
  await supabaseAdmin.from('ig_sync_logs').insert({ account_id: accountId, status, calls_made: calls, error: error ?? null })
}
