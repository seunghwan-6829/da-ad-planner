import { supabase } from '@/lib/supabase'

export interface CGScene {
  image: string
  prompt: string
  description: string
  caution: string
  // 생성된 이미지(저장) — 씬별 여러 장
  generated?: string[]
}

export interface ContentGuideData {
  scenes: CGScene[]
  brand?: string | null
}

export interface ContentGuide {
  id: string
  client_id: string
  library_id: string | null
  title: string | null
  source_brand: string | null
  source_thumb: string | null
  data: ContentGuideData
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CreateContentGuideInput {
  client_id: string
  library_id?: string | null
  title?: string | null
  source_brand?: string | null
  source_thumb?: string | null
  data: ContentGuideData
  created_by?: string | null
}

export async function getContentGuides(clientId: string): Promise<ContentGuide[]> {
  const { data, error } = await supabase
    .from('content_guides')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function getContentGuide(id: string): Promise<ContentGuide | null> {
  const { data, error } = await supabase.from('content_guides').select('*').eq('id', id).single()
  if (error) return null
  return data
}

export async function createContentGuide(input: CreateContentGuideInput): Promise<ContentGuide> {
  const { data, error } = await supabase.from('content_guides').insert([input]).select().single()
  if (error) throw error
  return data
}

export async function updateContentGuide(id: string, patch: Partial<CreateContentGuideInput>): Promise<ContentGuide> {
  const { data, error } = await supabase
    .from('content_guides')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteContentGuide(id: string): Promise<void> {
  const { error } = await supabase.from('content_guides').delete().eq('id', id)
  if (error) throw error
}
