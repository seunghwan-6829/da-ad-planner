import { supabase, ImageBoardCategory, ImageBoardGroup, ImageBoardItem } from '../supabase'

export interface ImageBoardListResult {
  data: ImageBoardItem[]
  totalCount: number
  categoryCounts: Record<string, number>
  groupCounts: Record<string, number>
}

const IMAGE_BOARD_SELECT =
  'id,title,image_url,image_path,category_id,group_id,ai_category,notes,width,height,file_size,created_by,created_at,updated_at,category:image_board_categories(*),group:image_board_groups(*)'

const IMAGE_BOARD_SELECT_LEGACY =
  'id,title,image_url,image_path,category_id,ai_category,notes,width,height,file_size,created_by,created_at,updated_at,category:image_board_categories(*)'

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
  thumbnail_url?: string | null
  thumbnail_path?: string | null
}): Promise<ImageBoardCategory | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_categories')
    .insert([
      {
        name: input.name,
        slug: input.slug,
        color: input.color || '#E2E8F0',
        thumbnail_url: input.thumbnail_url || null,
        thumbnail_path: input.thumbnail_path || null,
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

export async function updateImageBoardCategory(
  id: string,
  updates: Partial<ImageBoardCategory>
): Promise<ImageBoardCategory | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_categories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    console.error('Image board category update failed:', error)
    return null
  }

  return data
}

export async function getImageBoardGroups(categoryId: string): Promise<ImageBoardGroup[]> {
  if (!supabase || !categoryId || categoryId === 'all' || categoryId === 'uncategorized') return []

  const { data, error } = await supabase
    .from('image_board_groups')
    .select('*')
    .eq('category_id', categoryId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Image board groups fetch failed:', error)
    return []
  }

  return data || []
}

export async function createImageBoardGroup(input: {
  category_id: string
  name: string
  slug: string
  color?: string | null
}): Promise<ImageBoardGroup | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('image_board_groups')
    .insert([
      {
        category_id: input.category_id,
        name: input.name,
        slug: input.slug,
        color: input.color || '#E2E8F0',
      },
    ])
    .select('*')
    .single()

  if (error) {
    console.error('Image board group create failed:', error)
    return null
  }

  return data
}

export async function getImageBoardCounts(categoryId?: string): Promise<{
  categoryCounts: Record<string, number>
  groupCounts: Record<string, number>
}> {
  if (!supabase) return { categoryCounts: {}, groupCounts: {} }

  let query = supabase.from('image_board_items').select('category_id,group_id')

  if (categoryId && categoryId !== 'all' && categoryId !== 'uncategorized') {
    query = query.eq('category_id', categoryId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Image board counts fetch failed:', error)
    return { categoryCounts: {}, groupCounts: {} }
  }

  const categoryCounts: Record<string, number> = { all: data?.length || 0, uncategorized: 0 }
  const groupCounts: Record<string, number> = { all: data?.length || 0, ungrouped: 0 }

  data?.forEach((item) => {
    const categoryKey = item.category_id || 'uncategorized'
    categoryCounts[categoryKey] = (categoryCounts[categoryKey] || 0) + 1

    const groupKey = item.group_id || 'ungrouped'
    groupCounts[groupKey] = (groupCounts[groupKey] || 0) + 1
  })

  return { categoryCounts, groupCounts }
}

export async function getImageBoardItemsPaginated(args: {
  page: number
  pageSize: number
  categoryId?: string
  groupId?: string
}): Promise<ImageBoardListResult> {
  if (!supabase) return { data: [], totalCount: 0, categoryCounts: {}, groupCounts: {} }

  const from = (args.page - 1) * args.pageSize
  const to = from + args.pageSize - 1

  let query = supabase
    .from('image_board_items')
    .select(IMAGE_BOARD_SELECT, { count: 'exact' })
    .order('created_at', { ascending: false })

  if (args.categoryId && args.categoryId !== 'all') {
    if (args.categoryId === 'uncategorized') query = query.is('category_id', null)
    else query = query.eq('category_id', args.categoryId)
  }

  if (args.groupId && args.groupId !== 'all') {
    if (args.groupId === 'ungrouped') query = query.is('group_id', null)
    else query = query.eq('group_id', args.groupId)
  }

  query = query.range(from, to)

  let { data, error, count } = await query

  if (error) {
    const fallbackQuery = supabase
      .from('image_board_items')
      .select(IMAGE_BOARD_SELECT_LEGACY, { count: 'exact' })
      .order('created_at', { ascending: false })

    if (args.categoryId && args.categoryId !== 'all') {
      if (args.categoryId === 'uncategorized') fallbackQuery.is('category_id', null)
      else fallbackQuery.eq('category_id', args.categoryId)
    }

    fallbackQuery.range(from, to)
    const fallbackResult = await fallbackQuery
    data = fallbackResult.data as ImageBoardItem[] | null
    error = fallbackResult.error
    count = fallbackResult.count

    if (error) {
      console.error('Image board items fetch failed:', error)
      return { data: [], totalCount: 0, categoryCounts: {}, groupCounts: {} }
    }
  }

  const counts = await getImageBoardCounts(args.categoryId)
  return {
    data: (data as ImageBoardItem[]) || [],
    totalCount: count || 0,
    categoryCounts: counts.categoryCounts,
    groupCounts: counts.groupCounts,
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

export async function deleteImageBoardStorageFiles(paths: string[]) {
  if (!supabase || paths.length === 0) return true

  const { error } = await supabase.storage.from('image-board').remove(paths)

  if (error) {
    console.error('Image board storage delete failed:', error)
    return false
  }

  return true
}

export async function createImageBoardItem(
  input: Omit<ImageBoardItem, 'id' | 'created_at' | 'updated_at' | 'category' | 'group'>
): Promise<ImageBoardItem | null> {
  if (!supabase) return null

  let { data, error } = await supabase
    .from('image_board_items')
    .insert([input])
    .select(IMAGE_BOARD_SELECT)
    .single()

  if (error) {
    const legacyInput = { ...input }
    delete (legacyInput as { group_id?: string | null }).group_id

    const fallbackResult = await supabase
      .from('image_board_items')
      .insert([legacyInput])
      .select(IMAGE_BOARD_SELECT_LEGACY)
      .single()

    data = fallbackResult.data as ImageBoardItem | null
    error = fallbackResult.error

    if (error) {
      console.error('Image board item create failed:', error)
      return null
    }
  }

  return data as ImageBoardItem
}

export async function updateImageBoardItem(
  id: string,
  updates: Partial<ImageBoardItem>
): Promise<ImageBoardItem | null> {
  if (!supabase) return null

  let { data, error } = await supabase
    .from('image_board_items')
    .update(updates)
    .eq('id', id)
    .select(IMAGE_BOARD_SELECT)
    .single()

  if (error) {
    const legacyUpdates = { ...updates }
    delete (legacyUpdates as { group_id?: string | null }).group_id

    const fallbackResult = await supabase
      .from('image_board_items')
      .update(legacyUpdates)
      .eq('id', id)
      .select(IMAGE_BOARD_SELECT_LEGACY)
      .single()

    data = fallbackResult.data as ImageBoardItem | null
    error = fallbackResult.error

    if (error) {
      console.error('Image board item update failed:', error)
      return null
    }
  }

  return data as ImageBoardItem
}

export async function deleteImageBoardItems(items: Pick<ImageBoardItem, 'id' | 'image_path'>[]) {
  if (!supabase) return false

  const paths = items.map((item) => item.image_path).filter(Boolean)
  if (paths.length > 0) {
    const deleted = await deleteImageBoardStorageFiles(paths)
    if (!deleted) {
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
