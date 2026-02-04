import { supabase, BPMaterial } from '../supabase'

// 페이지네이션 결과 타입
export interface PaginatedResult {
  data: BPMaterial[]
  totalCount: number
  categoryCounts: Record<string, number>
}

// 카테고리별 개수 조회
export async function getBPMaterialCounts(): Promise<Record<string, number>> {
  if (!supabase) return {}
  
  const { data, error } = await supabase
    .from('bp_materials')
    .select('category')
  
  if (error) {
    console.error('카테고리 개수 조회 실패:', error)
    return {}
  }
  
  const counts: Record<string, number> = { '전체': data?.length || 0 }
  data?.forEach(item => {
    const cat = item.category || '기타'
    counts[cat] = (counts[cat] || 0) + 1
  })
  
  return counts
}

// 페이지네이션 지원 조회
export async function getBPMaterialsPaginated(
  page: number = 1,
  pageSize: number = 30,
  category?: string
): Promise<PaginatedResult> {
  if (!supabase) return { data: [], totalCount: 0, categoryCounts: {} }
  
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  
  // 기본 쿼리
  let query = supabase
    .from('bp_materials')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
  
  // 카테고리 필터
  if (category && category !== '전체') {
    query = query.eq('category', category)
  }
  
  // 페이지네이션 적용
  query = query.range(from, to)
  
  const { data, error, count } = await query
  
  if (error) {
    console.error('BP 소재 조회 실패:', error)
    return { data: [], totalCount: 0, categoryCounts: {} }
  }
  
  // 카테고리별 개수도 함께 조회
  const categoryCounts = await getBPMaterialCounts()
  
  return {
    data: data || [],
    totalCount: count || 0,
    categoryCounts
  }
}

// 기존 전체 조회 (호환성 유지)
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
