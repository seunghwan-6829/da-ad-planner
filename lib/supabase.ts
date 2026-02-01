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
  brand_color: string | null
  brand_font: string | null
  tone_manner: string | null
  forbidden_words: string[] | null
  required_phrases: string[] | null
  guidelines: string | null
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
