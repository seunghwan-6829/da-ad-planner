import { supabase } from '@/lib/supabase'

export interface Client {
  id: string
  name: string
  description: string | null
  color: string
  sort_order: number
  created_at: string
}

export interface ClientPermission {
  id: string
  user_id: string
  client_id: string
  created_at: string
}

export interface RowHeights {
  video: number
  timeline: number
  effect: number
  special_notes: number
  script: number
  source_info: number
}

export interface ProjectPlan {
  id: string
  client_id: string
  title: string
  status: 'draft' | 'in_progress' | 'completed'
  scene_count: number
  row_heights: RowHeights | null
  reference: string | null
  cta_text: string | null
  card_preview: string | null
  is_completed: boolean
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export interface SceneFile {
  name: string
  url: string
  size: number
}

export interface PlanScene {
  id: string
  plan_id: string
  scene_number: number
  image_url: string | null
  timeline: string | null
  sources: string[]
  effect: string | null
  special_notes: string | null
  script: string | null
  source_info: string | null
  files: SceneFile[] | null
  created_at: string
}

// 클라이언트 관련 API
export async function getClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

// 클라이언트 순서 업데이트
export async function updateClientOrder(clients: { id: string; sort_order: number }[]): Promise<void> {
  for (const client of clients) {
    await supabase
      .from('clients')
      .update({ sort_order: client.sort_order })
      .eq('id', client.id)
  }
}

export async function getClientsForUser(userId: string): Promise<Client[]> {
  // 사용자에게 권한이 있는 클라이언트만 조회
  const { data: permissions, error: permError } = await supabase
    .from('client_permissions')
    .select('client_id')
    .eq('user_id', userId)
  
  if (permError) throw permError
  
  if (!permissions || permissions.length === 0) return []
  
  const clientIds = permissions.map(p => p.client_id)
  
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .in('id', clientIds)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

export async function getClient(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) return null
  return data
}

export async function createClient(client: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .insert([client])
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function updateClient(id: string, client: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .update(client)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function deleteClient(id: string): Promise<void> {
  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

// 클라이언트 권한 관련 API
export async function getClientPermissions(clientId: string): Promise<ClientPermission[]> {
  const { data, error } = await supabase
    .from('client_permissions')
    .select('*')
    .eq('client_id', clientId)
  
  if (error) throw error
  return data || []
}

export async function getUserPermissions(userId: string): Promise<ClientPermission[]> {
  const { data, error } = await supabase
    .from('client_permissions')
    .select('*')
    .eq('user_id', userId)
  
  if (error) throw error
  return data || []
}

export async function grantClientPermission(userId: string, clientId: string): Promise<ClientPermission> {
  const { data, error } = await supabase
    .from('client_permissions')
    .insert([{ user_id: userId, client_id: clientId }])
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function revokeClientPermission(userId: string, clientId: string): Promise<void> {
  const { error } = await supabase
    .from('client_permissions')
    .delete()
    .eq('user_id', userId)
    .eq('client_id', clientId)
  
  if (error) throw error
}

export async function checkClientPermission(userId: string, clientId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('client_permissions')
    .select('id')
    .eq('user_id', userId)
    .eq('client_id', clientId)
    .single()
  
  if (error) return false
  return !!data
}

// 기획안 관련 API
export async function getProjectPlans(clientId: string): Promise<ProjectPlan[]> {
  const { data, error } = await supabase
    .from('project_plans')
    .select('*')
    .eq('client_id', clientId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

// 휴지통 기획안 조회
export async function getDeletedProjectPlans(clientId: string): Promise<ProjectPlan[]> {
  const { data, error } = await supabase
    .from('project_plans')
    .select('*')
    .eq('client_id', clientId)
    .not('deleted_at', 'is', null)
    .order('deleted_at', { ascending: false })
  
  if (error) throw error
  return data || []
}

export async function getProjectPlan(id: string): Promise<ProjectPlan | null> {
  const { data, error } = await supabase
    .from('project_plans')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) return null
  return data
}

export async function createProjectPlan(plan: Partial<ProjectPlan>): Promise<ProjectPlan> {
  const { data, error } = await supabase
    .from('project_plans')
    .insert([plan])
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function updateProjectPlan(id: string, plan: Partial<ProjectPlan>): Promise<ProjectPlan> {
  const { data, error } = await supabase
    .from('project_plans')
    .update({ ...plan, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

// 기획안 휴지통으로 이동 (소프트 삭제)
export async function deleteProjectPlan(id: string): Promise<void> {
  const { error } = await supabase
    .from('project_plans')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
  
  if (error) throw error
}

// 기획안 복원
export async function restoreProjectPlan(id: string): Promise<void> {
  const { error } = await supabase
    .from('project_plans')
    .update({ deleted_at: null })
    .eq('id', id)
  
  if (error) throw error
}

// 기획안 영구 삭제
export async function permanentDeleteProjectPlan(id: string): Promise<void> {
  const { error } = await supabase
    .from('project_plans')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

// 씬 관련 API
export async function getPlanScenes(planId: string): Promise<PlanScene[]> {
  const { data, error } = await supabase
    .from('plan_scenes')
    .select('*')
    .eq('plan_id', planId)
    .order('scene_number', { ascending: true })
  
  if (error) throw error
  return data || []
}

export async function createPlanScene(scene: Partial<PlanScene>): Promise<PlanScene> {
  const { data, error } = await supabase
    .from('plan_scenes')
    .insert([scene])
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function updatePlanScene(id: string, scene: Partial<PlanScene>): Promise<PlanScene> {
  const { data, error } = await supabase
    .from('plan_scenes')
    .update(scene)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data
}

export async function deletePlanScene(id: string): Promise<void> {
  const { error } = await supabase
    .from('plan_scenes')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

export async function updateSceneCount(planId: string): Promise<void> {
  const { data } = await supabase
    .from('plan_scenes')
    .select('id')
    .eq('plan_id', planId)
  
  const count = data?.length || 0
  
  await supabase
    .from('project_plans')
    .update({ scene_count: count, updated_at: new Date().toISOString() })
    .eq('id', planId)
}
