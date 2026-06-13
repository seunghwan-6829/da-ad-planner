import { supabase } from '@/lib/supabase'

export interface ShootingGuideShot {
  id: string
  guide_id: string
  shot_number: number
  name: string | null
  description: string | null
  framing: string | null
  angle: string | null
  duration: string | null
  direction: string | null
  image_url: string | null
  image_path: string | null
  created_at: string
}

export interface ShootingGuide {
  id: string
  client_id: string
  title: string
  ratio: string
  tips: string | null
  share_id: string
  is_public: boolean
  status: 'draft' | 'generating' | 'ready'
  created_by: string | null
  created_at: string
  updated_at: string
  shots?: ShootingGuideShot[]
}

const BUCKET = 'shooting-guides'

export function createShareId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

function sortShots(shots?: ShootingGuideShot[] | null): ShootingGuideShot[] {
  return (shots || []).slice().sort((a, b) => a.shot_number - b.shot_number)
}

// 브랜드별 가이드 목록 (썸네일용 컷 정보 포함)
export async function getShootingGuides(clientId: string): Promise<ShootingGuide[]> {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('shooting_guides')
    .select('*, shots:shooting_guide_shots(id,image_url,shot_number)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('촬영 가이드 목록 조회 실패:', error)
    return []
  }

  return (data || []).map((g) => ({ ...g, shots: sortShots(g.shots) })) as ShootingGuide[]
}

export async function createShootingGuide(input: {
  client_id: string
  title: string
  ratio?: string
  tips?: string | null
  share_id: string
  created_by?: string | null
}): Promise<ShootingGuide | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('shooting_guides')
    .insert([
      {
        client_id: input.client_id,
        title: input.title,
        ratio: input.ratio || '9:16',
        tips: input.tips ?? null,
        share_id: input.share_id,
        is_public: false,
        status: 'generating',
        created_by: input.created_by ?? null,
      },
    ])
    .select('*')
    .single()

  if (error) {
    console.error('촬영 가이드 생성 실패:', error)
    throw new Error(error.message)
  }

  return data as ShootingGuide
}

export async function createShootingGuideShots(
  shots: Omit<ShootingGuideShot, 'id' | 'created_at'>[]
): Promise<ShootingGuideShot[]> {
  if (!supabase || shots.length === 0) return []

  const { data, error } = await supabase
    .from('shooting_guide_shots')
    .insert(shots)
    .select('*')

  if (error) {
    console.error('컷 생성 실패:', error)
    throw new Error(error.message)
  }

  return sortShots(data as ShootingGuideShot[])
}

export async function updateShootingGuideShot(
  id: string,
  updates: Partial<Pick<ShootingGuideShot, 'image_url' | 'image_path'>>
): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('shooting_guide_shots')
    .update(updates)
    .eq('id', id)

  if (error) console.error('컷 업데이트 실패:', error)
}

export async function publishGuide(id: string): Promise<void> {
  if (!supabase) return

  const { error } = await supabase
    .from('shooting_guides')
    .update({ is_public: true, status: 'ready', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    console.error('가이드 발행 실패:', error)
    throw new Error(error.message)
  }
}

export async function deleteShootingGuide(guide: ShootingGuide): Promise<void> {
  if (!supabase) return

  // 스토리지 이미지 정리
  const paths = (guide.shots || [])
    .map((s) => s.image_path)
    .filter(Boolean) as string[]
  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths)
  }

  const { error } = await supabase.from('shooting_guides').delete().eq('id', guide.id)
  if (error) {
    console.error('가이드 삭제 실패:', error)
    throw new Error(error.message)
  }
}

// 공개 뷰어용 (로그인 불필요, anon RLS)
export async function getPublicGuideByShareId(shareId: string): Promise<ShootingGuide | null> {
  if (!supabase) return null

  const { data, error } = await supabase
    .from('shooting_guides')
    .select('*, shots:shooting_guide_shots(*)')
    .eq('share_id', shareId)
    .eq('is_public', true)
    .single()

  if (error) {
    console.error('공개 가이드 조회 실패:', error)
    return null
  }

  return { ...data, shots: sortShots(data.shots) } as ShootingGuide
}

// base64 PNG → 스토리지 업로드 → 공개 URL
export async function uploadShootingGuideImage(
  path: string,
  file: File
): Promise<{ url: string; path: string } | null> {
  if (!supabase) return null

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/png',
  })

  if (error) {
    console.error('촬영 가이드 이미지 업로드 실패:', error)
    const message = error.message || '이미지 업로드에 실패했습니다.'
    if (message.toLowerCase().includes('bucket not found')) {
      throw new Error('Supabase에 `shooting-guides` 스토리지 버킷이 없습니다. shooting-guide-schema.sql 을 먼저 적용해 주세요.')
    }
    throw new Error(message)
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return { url: data.publicUrl, path }
}
