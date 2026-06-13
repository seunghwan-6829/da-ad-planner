import { supabase } from '@/lib/supabase'

export interface UserSettings {
  id: string
  user_id: string
  anthropic_api_key: string | null
  openai_api_key: string | null
  theme: 'light' | 'dark'
  created_at: string
  updated_at: string
}

export async function getUserSettings(userId: string): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error) return null
  return data
}

export async function upsertUserSettings(userId: string, settings: Partial<UserSettings>): Promise<UserSettings> {
  const { data: existing } = await supabase
    .from('user_settings')
    .select('id')
    .eq('user_id', userId)
    .single()

  if (existing) {
    const { data, error } = await supabase
      .from('user_settings')
      .update({ ...settings, updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select()
      .single()

    if (error) throw error
    return data
  } else {
    const { data, error } = await supabase
      .from('user_settings')
      .insert([{ user_id: userId, ...settings }])
      .select()
      .single()

    if (error) throw error
    return data
  }
}
