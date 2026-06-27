// 인스타 성과 — DB 행 타입(브라우저/서버 공용). 스키마: instagram-schema.sql

export interface IgAccount {
  id: string
  client_id: string | null
  ig_user_id: string
  ig_username: string | null
  name: string | null
  profile_picture_url: string | null
  fb_page_id: string | null
  status: 'active' | 'token_expired' | 'disconnected'
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface IgAccountSnapshot {
  id: string
  account_id: string
  captured_at: string
  followers_count: number | null
  follows_count: number | null
  media_count: number | null
  reach: number | null
  views: number | null
  accounts_engaged: number | null
  total_interactions: number | null
  profile_links_taps: number | null
  raw: Record<string, unknown> | null
}

export interface IgDemographicsSnapshot {
  id: string
  account_id: string
  captured_at: string
  type: 'city' | 'country' | 'age_gender' | 'online_followers'
  breakdown: Record<string, number>
}

export interface IgMedia {
  id: string
  account_id: string
  ig_media_id: string
  media_type: string | null
  media_product_type: string | null
  caption: string | null
  permalink: string | null
  thumbnail_url: string | null
  media_url: string | null
  timestamp: string | null
  created_at: string
}

export interface IgMediaMetric {
  id: string
  ig_media_id: string
  account_id: string | null
  captured_at: string
  like_count: number | null
  comments_count: number | null
  reach: number | null
  saved: number | null
  shares: number | null
  views: number | null
  total_interactions: number | null
  raw: Record<string, unknown> | null
}

export interface IgSyncLog {
  id: string
  account_id: string | null
  ran_at: string
  status: 'ok' | 'partial' | 'error' | null
  error: string | null
  calls_made: number | null
}
