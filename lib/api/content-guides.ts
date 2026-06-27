import { supabase } from '@/lib/supabase'

// 생성 이미지 한 칸 = 레이어 스택(편집 시 새 버전을 위로 쌓음). 구버전 데이터는 단일 URL(string).
export type CGGenItem = string | string[]

export interface CGScene {
  image: string
  prompt: string
  description: string
  caution: string
  // 생성된 이미지(저장) — 씬별 여러 칸, 각 칸은 레이어 스택([과거…, 최신])
  generated?: CGGenItem[]
}

// 저장값(string | string[])을 항상 레이어 스택(string[][])으로 정규화
export function toStacks(g?: CGGenItem[]): string[][] {
  return (g || []).map((x) => (Array.isArray(x) ? x.filter(Boolean) : [x])).filter((s) => s.length)
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
