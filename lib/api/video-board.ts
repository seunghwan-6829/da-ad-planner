import {
  supabase,
  VideoBoardCategory,
  VideoBoardGroup,
  VideoBoardItem,
} from '../supabase'

export interface VideoBoardListResult {
  data: VideoBoardItem[]
  totalCount: number
  categoryCounts: Record<string, number>
  groupCounts: Record<string, number>
}

const VIDEO_BOARD_SELECT =
  'id,title,video_url,video_path,poster_url,poster_path,category_id,group_id,ai_category,summary,timeline_notes,script_notes,duration,width,height,file_size,mime_type,share_id,is_public,created_by,created_at,updated_at,category:video_board_categories(*),group:video_board_groups(*)'

export async function getVideoBoardCategories(): Promise<VideoBoardCategory[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('video_board_categories')
    .select('*')
    .order('is_default', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Video board categories fetch failed:', error)
    return []
  }

  return data || []
}

export async function createVideoBoardCategory(input: {
  name: string
  slug: string
  color?: string | null
}): Promise<VideoBoardCategory | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('video_board_categories')
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
    console.error('Video board category create failed:', error)
    return null
  }

  return data
}

export async function getVideoBoardGroups(categoryId: string): Promise<VideoBoardGroup[]> {
  if (!supabase || !categoryId || categoryId === 'all' || categoryId === 'uncategorized') return []

  const { data, error } = await supabase
    .from('video_board_groups')
    .select('*')
    .eq('category_id', categoryId)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Video board groups fetch failed:', error)
    return []
  }

  return data || []
}

export async function createVideoBoardGroup(input: {
  category_id: string
  name: string
  slug: string
  color?: string | null
}): Promise<VideoBoardGroup | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('video_board_groups')
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
    console.error('Video board group create failed:', error)
    return null
  }

  return data
}

export async function getVideoBoardCounts(categoryId?: string): Promise<{
  categoryCounts: Record<string, number>
  groupCounts: Record<string, number>
}> {
  if (!supabase) return { categoryCounts: {}, groupCounts: {} }

  let query = supabase.from('video_board_items').select('category_id,group_id')

  if (categoryId && categoryId !== 'all' && categoryId !== 'uncategorized') {
    query = query.eq('category_id', categoryId)
  }

  const { data, error } = await query

  if (error) {
    console.error('Video board counts fetch failed:', error)
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

export async function getVideoBoardItemsPaginated(args: {
  page: number
  pageSize: number
  categoryId?: string
  groupId?: string
}): Promise<VideoBoardListResult> {
  if (!supabase) return { data: [], totalCount: 0, categoryCounts: {}, groupCounts: {} }

  const from = (args.page - 1) * args.pageSize
  const to = from + args.pageSize - 1

  let query = supabase
    .from('video_board_items')
    .select(VIDEO_BOARD_SELECT, { count: 'exact' })
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

  const { data, error, count } = await query

  if (error) {
    console.error('Video board items fetch failed:', error)
    return { data: [], totalCount: 0, categoryCounts: {}, groupCounts: {} }
  }

  const counts = await getVideoBoardCounts(args.categoryId)
  return {
    data: (data as VideoBoardItem[]) || [],
    totalCount: count || 0,
    categoryCounts: counts.categoryCounts,
    groupCounts: counts.groupCounts,
  }
}

export async function getPublicVideoBoardItemByShareId(shareId: string): Promise<VideoBoardItem | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('video_board_items')
    .select(VIDEO_BOARD_SELECT)
    .eq('share_id', shareId)
    .eq('is_public', true)
    .single()

  if (error) {
    console.error('Public video board item fetch failed:', error)
    return null
  }

  return data as VideoBoardItem
}

export async function uploadVideoBoardFile(filePath: string, file: File) {
  if (!supabase) return null

  const { error } = await supabase.storage.from('video-board').upload(filePath, file, {
    upsert: false,
    contentType: file.type,
  })

  if (error) {
    console.error('Video board upload failed:', error)
    return null
  }

  const { data } = supabase.storage.from('video-board').getPublicUrl(filePath)
  return data.publicUrl
}

export async function deleteVideoBoardStorageFiles(paths: string[]) {
  if (!supabase || paths.length === 0) return true

  const { error } = await supabase.storage.from('video-board').remove(paths)

  if (error) {
    console.error('Video board storage delete failed:', error)
    return false
  }

  return true
}

export async function createVideoBoardItem(
  input: Omit<VideoBoardItem, 'id' | 'created_at' | 'updated_at' | 'category' | 'group'>
): Promise<VideoBoardItem | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('video_board_items')
    .insert([input])
    .select(VIDEO_BOARD_SELECT)
    .single()

  if (error) {
    console.error('Video board item create failed:', error)
    return null
  }

  return data as VideoBoardItem
}

export async function updateVideoBoardItem(
  id: string,
  updates: Partial<VideoBoardItem>
): Promise<VideoBoardItem | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('video_board_items')
    .update(updates)
    .eq('id', id)
    .select(VIDEO_BOARD_SELECT)
    .single()

  if (error) {
    console.error('Video board item update failed:', error)
    return null
  }

  return data as VideoBoardItem
}

export async function deleteVideoBoardItems(
  items: Pick<VideoBoardItem, 'id' | 'video_path' | 'poster_path'>[]
) {
  if (!supabase) return false

  const paths = items.flatMap((item) => [item.video_path, item.poster_path].filter(Boolean) as string[])
  if (paths.length > 0) {
    const deleted = await deleteVideoBoardStorageFiles(paths)
    if (!deleted) return false
  }

  const ids = items.map((item) => item.id)
  const { error } = await supabase.from('video_board_items').delete().in('id', ids)

  if (error) {
    console.error('Video board item delete failed:', error)
    return false
  }

  return true
}
