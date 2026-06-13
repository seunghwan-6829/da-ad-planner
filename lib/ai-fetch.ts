import { supabase } from './supabase'

interface UserAiKeys {
  anthropic: string | null
  openai: string | null
}

let cachedKeys: UserAiKeys | null = null
let cacheUserId: string | null = null

export async function getAiKeysForUser(): Promise<UserAiKeys> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { anthropic: null, openai: null }

  if (cacheUserId === user.id && cachedKeys !== null) {
    return cachedKeys
  }

  const { data } = await supabase
    .from('user_settings')
    .select('anthropic_api_key, openai_api_key')
    .eq('user_id', user.id)
    .single()

  cacheUserId = user.id
  cachedKeys = {
    anthropic: data?.anthropic_api_key || null,
    openai: data?.openai_api_key || null,
  }
  return cachedKeys
}

// 하위 호환: Anthropic 키만 필요한 곳에서 계속 사용
export async function getApiKeyForUser(): Promise<string | null> {
  return (await getAiKeysForUser()).anthropic
}

export function clearApiKeyCache() {
  cachedKeys = null
  cacheUserId = null
}

export async function aiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const keys = await getAiKeysForUser()

  const headers = new Headers(options.headers || {})
  headers.set('Content-Type', 'application/json')
  if (keys.anthropic) {
    headers.set('x-user-api-key', keys.anthropic)
  }
  if (keys.openai) {
    headers.set('x-user-openai-key', keys.openai)
  }

  return fetch(url, {
    ...options,
    headers,
  })
}
