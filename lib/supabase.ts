import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

// 환경변수가 없으면 더미 클라이언트 생성 (빌드 타임용)
export const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null as any

// Supabase 연결 확인
export const isSupabaseConfigured = () => {
  return !!supabaseUrl && !!supabaseAnonKey
}

// 타입 정의
export interface Advertiser {
  id: string
  name: string
  guidelines_image: string | null  // 이미지용 지침서
  guidelines_video: string | null  // 영상용 지침서
  products: string[] | null
  appeals: string[] | null  // 소구점
  cautions: string | null
  created_at: string
}

export interface AdPlan {
  id: string
  advertiser_id: string | null
  title: string
  media_type: 'image' | 'video'
  size: string | null
  concept: string | null
  main_copy: string | null
  sub_copy: string | null
  cta_text: string | null
  notes: string | null
  // 새 필드들
  reference_links: string[] | null
  cta_texts: string[] | null
  td_title: string | null
  td_description: string | null
  copy_history: string | null  // JSON string
  custom_prompt: string | null  // 추가 입력란
  ai_results: string | null  // 현재 AI 결과 JSON string
  created_at: string
  advertiser?: Advertiser
}

export interface Template {
  id: string
  name: string
  media_type: string | null
  default_size: string | null
  structure: Record<string, unknown> | null
  created_at: string
}
