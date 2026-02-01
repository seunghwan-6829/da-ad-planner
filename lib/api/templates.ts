import { supabase, Template } from '@/lib/supabase'

export async function getTemplates() {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .order('created_at', { ascending: false })
  
  if (error) throw error
  return data as Template[]
}

export async function getTemplate(id: string) {
  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()
  
  if (error) throw error
  return data as Template
}

export async function createTemplate(template: Omit<Template, 'id' | 'created_at'>) {
  const { data, error } = await supabase
    .from('templates')
    .insert(template)
    .select()
    .single()
  
  if (error) throw error
  return data as Template
}

export async function updateTemplate(id: string, template: Partial<Omit<Template, 'id' | 'created_at'>>) {
  const { data, error } = await supabase
    .from('templates')
    .update(template)
    .eq('id', id)
    .select()
    .single()
  
  if (error) throw error
  return data as Template
}

export async function deleteTemplate(id: string) {
  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)
  
  if (error) throw error
}
