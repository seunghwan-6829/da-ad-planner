import { supabase, ImageBoardCategory, ImageBoardItem } from '../supabase'

export interface ImageBoardListResult {
  data: ImageBoardItem[]
  totalCount: number
  categoryCounts: Record<string, number>
}

export async function getImageBoardCategories(): Promise<ImageBoardCategory[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('image_board_categories')
    .select('*')
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Image board categories fetch failed:', error)
    return []
  }

  return data || []
}

export async function createImageBoardCategory(input: {
  name: string
  slug: string
  color?: string | null
}): Promise<ImageBoardCategory | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_categories')
    .insert([
      {
        name: input.name,
        slug: input.slug,
        color: input.color || '#E2E8F0',
        is_default: false,
      },
    ])
    .select('*')
    .single()

  if (error) {
    console.error('Image board category create failed:', error)
    return null
  }

  return data
}

export async function getImageBoardCounts(): Promise<Record<string, number>> {
  if (!supabase) return {}

  const { data, error } = await supabase.from('image_board_items').select('category_id')

  if (error) {
    console.error('Image board counts fetch failed:', error)
    return {}
  }

  const counts: Record<string, number> = { all: data?.length || 0, uncategorized: 0 }

  data?.forEach((item) => {
    const key = item.category_id || 'uncategorized'
    counts[key] = (counts[key] || 0) + 1
  })

  return counts
}

export async function getImageBoardItemsPaginated(args: {
  page: number
  pageSize: number
  categoryId?: string
}): Promise<ImageBoardListResult> {
  if (!supabase) return { data: [], totalCount: 0, categoryCounts: {} }

  const from = (args.page - 1) * args.pageSize
  const to = from + args.pageSize - 1

  let query = supabase
    .from('image_board_items')
    .select(
      'id,title,image_url,image_path,category_id,ai_category,notes,width,height,file_size,created_by,created_at,updated_at,category:image_board_categories(*)',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })

  if (args.categoryId && args.categoryId !== 'all') {
    if (args.categoryId === 'uncategorized') query = query.is('category_id', null)
    else query = query.eq('category_id', args.categoryId)
  }

  query = query.range(from, to)

  const { data, error, count } = await query

  if (error) {
    console.error('Image board items fetch failed:', error)
    return { data: [], totalCount: 0, categoryCounts: {} }
  }

  const categoryCounts = await getImageBoardCounts()
  return {
    data: (data as ImageBoardItem[]) || [],
    totalCount: count || 0,
    categoryCounts,
  }
}

export async function uploadImageBoardFile(filePath: string, file: File) {
  if (!supabase) return null

  const { error } = await supabase.storage.from('image-board').upload(filePath, file, {
    upsert: false,
    contentType: file.type,
  })

  if (error) {
    console.error('Image board upload failed:', error)
    return null
  }

  const { data } = supabase.storage.from('image-board').getPublicUrl(filePath)
  return data.publicUrl
}

export async function createImageBoardItem(
  input: Omit<ImageBoardItem, 'id' | 'created_at' | 'updated_at' | 'category'>
): Promise<ImageBoardItem | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_items')
    .insert([input])
    .select(
      'id,title,image_url,image_path,category_id,ai_category,notes,width,height,file_size,created_by,created_at,updated_at,category:image_board_categories(*)'
    )
    .single()

  if (error) {
    console.error('Image board item create failed:', error)
    return null
  }

  return data as ImageBoardItem
}

export async function updateImageBoardItem(
  id: string,
  updates: Partial<ImageBoardItem>
): Promise<ImageBoardItem | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_items')
    .update(updates)
    .eq('id', id)
    .select(
      'id,title,image_url,image_path,category_id,ai_category,notes,width,height,file_size,created_by,created_at,updated_at,category:image_board_categories(*)'
    )
    .single()

  if (error) {
    console.error('Image board item update failed:', error)
    return null
  }

  return data as ImageBoardItem
}

export async function deleteImageBoardItems(items: Pick<ImageBoardItem, 'id' | 'image_path'>[]) {
  if (!supabase) return false

  const paths = items.map((item) => item.image_path).filter(Boolean)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage.from('image-board').remove(paths)
    if (storageError) {
      console.error('Image board storage delete failed:', storageError)
      return false
    }
  }

  const ids = items.map((item) => item.id)
  const { error } = await supabase.from('image_board_items').delete().in('id', ids)

  if (error) {
    console.error('Image board item delete failed:', error)
    return false
  }

  return true
}
