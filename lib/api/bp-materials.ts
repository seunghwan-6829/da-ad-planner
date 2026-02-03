import { supabase, BPMaterial } from '../supabase'

export async function getBPMaterials(): Promise<BPMaterial[]> {
  if (!supabase) return []
  
  const { data, error } = await supabase
    .from('bp_materials')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) {
    console.error('BP 소재 조회 실패:', error)
    return []
  }
  
  return data || []
}

export async function createBPMaterial(material: Omit<BPMaterial, 'id' | 'created_at'>): Promise<BPMaterial | null> {
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('bp_materials')
    .insert([material])
    .select()
    .single()
  
  if (error) {
    console.error('BP 소재 생성 실패:', error)
    return null
  }
  
  return data
}

export async function updateBPMaterial(id: string, updates: Partial<BPMaterial>): Promise<BPMaterial | null> {
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('bp_materials')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  
  if (error) {
    console.error('BP 소재 수정 실패:', error)
    return null
  }
  
  return data
}

export async function deleteBPMaterial(id: string): Promise<boolean> {
  if (!supabase) return false
  
  const { error } = await supabase
    .from('bp_materials')
    .delete()
    .eq('id', id)
  
  if (error) {
    console.error('BP 소재 삭제 실패:', error)
    return false
  }
  
  return true
}
