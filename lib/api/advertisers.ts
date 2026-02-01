import { supabase, Advertiser } from '@/lib/supabase'

export async function getAdvertisers(): Promise<Advertiser[]> {
  if (!supabase) return []
  
  const { data, error } = await supabase
    .from('advertisers')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data as Advertiser[]
}

export async function getAdvertiser(id: string): Promise<Advertiser | null> {
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('advertisers')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) throw error
  return data as Advertiser
}

export async function createAdvertiser(advertiser: Omit<Advertiser, 'id' | 'created_at'>): Promise<Advertiser> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { data, error } = await supabase
    .from('advertisers')
    .insert(advertiser)
    .select()
    .single()
  
  if (error) throw error
  return data as Advertiser
}

export async function updateAdvertiser(id: string, advertiser: Partial<Omit<Advertiser, 'id' | 'created_at'>>): Promise<Advertiser> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { data, error } = await supabase
    .from('advertisers')
    .update(advertiser)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data as Advertiser
}

export async function deleteAdvertiser(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { error } = await supabase
    .from('advertisers')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}
