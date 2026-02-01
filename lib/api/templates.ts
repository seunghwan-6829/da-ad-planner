import { supabase, Template } from '@/lib/supabase'

export async function getTemplates(): Promise<Template[]> {
  if (!supabase) return []
  
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data as Template[]
}

export async function getTemplate(id: string): Promise<Template | null> {
  if (!supabase) return null
  
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) throw error
  return data as Template
}

export async function createTemplate(template: Omit<Template, 'id' | 'created_at'>): Promise<Template> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { data, error } = await supabase
    .from('templates')
    .insert(template)
    .select()
    .single()
  
  if (error) throw error
  return data as Template
}

export async function updateTemplate(id: string, template: Partial<Omit<Template, 'id' | 'created_at'>>): Promise<Template> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { data, error } = await supabase
    .from('templates')
    .update(template)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data as Template
}

export async function deleteTemplate(id: string): Promise<void> {
  if (!supabase) throw new Error('Supabase not configured')
  
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}
