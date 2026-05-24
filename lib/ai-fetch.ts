import { supabase } from './supabase'

let cachedApiKey: string | null = null
let cacheUserId: string | null = null

export async function getApiKeyForUser(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  if (cacheUserId === user.id && cachedApiKey !== null) {
    return cachedApiKey || null
  }

  const { data } = await supabase
    .from('user_settings')
    .select('anthropic_api_key')
    .eq('user_id', user.id)
    .single()

  cacheUserId = user.id
  cachedApiKey = data?.anthropic_api_key || ''
  return cachedApiKey || null
}

export function clearApiKeyCache() {
  cachedApiKey = null
  cacheUserId = null
}

export async function aiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const userApiKey = await getApiKeyForUser()

  const headers = new Headers(options.headers || {})
  headers.set('Content-Type', 'application/json')
  if (userApiKey) {
    headers.set('x-user-api-key', userApiKey)
  }

  return fetch(url, {
    ...options,
    headers,
  })
}
