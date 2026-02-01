import { supabase, AdPlan } from '@/lib/supabase'

export async function getPlans() {
  const { data, error } = await supabase
    .from('ad_plans')
    .select(`
      *,
      advertiser:advertisers(id, name)
    `)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data as AdPlan[]
}

export async function getPlan(id: string) {
  const { data, error } = await supabase
    .from('ad_plans')
    .select(`
      *,
      advertiser:advertisers(*)
    `)
    .eq('id', id)
    .single()
  
  if (error) throw error
  return data as AdPlan
}

export async function createPlan(plan: Omit<AdPlan, 'id' | 'created_at' | 'advertiser'>) {
  const { data, error } = await supabase
    .from('ad_plans')
    .insert(plan)
    .select()
    .single()
  
  if (error) throw error
  return data as AdPlan
}

export async function updatePlan(id: string, plan: Partial<Omit<AdPlan, 'id' | 'created_at' | 'advertiser'>>) {
  const { data, error } = await supabase
    .from('ad_plans')
    .update(plan)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data as AdPlan
}

export async function deletePlan(id: string) {
  const { error } = await supabase
    .from('ad_plans')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}

export async function getPlansByAdvertiser(advertiserId: string) {
  const { data, error } = await supabase
    .from('ad_plans')
    .select('*')
    .eq('advertiser_id', advertiserId)
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data as AdPlan[]
}
