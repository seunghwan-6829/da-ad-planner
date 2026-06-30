import { supabaseAdmin } from '@/lib/supabase-admin'

// 메타광고(am_ads) / 온드미디어(om_posts) 두 소스를 같은 형태로 읽어오는 공용 서버 헬퍼.
// AI 라우트(/api/ai/mindmap, /api/ai/content-guide)가 source 에 따라 어느 표든 동일 필드로 다루게 한다.
// ⚠️ 서버 전용(supabaseAdmin import) — 클라이언트에서 import 금지.

export type CreativeRecord = {
  library_id: string
  page_name: string | null
  started_on: string | null
  ad_text: string | null
  media_type: string | null
  media_url: string | null
  media_urls: string[] | null
  poster_url: string | null
  frames: string[] | null
  ai_analysis: string | null
  transcript: string | null
}

// source: 'om' → om_posts(온드미디어), 그 외 → am_ads(메타광고, 기본).
export async function loadCreative(id: string, source?: string): Promise<CreativeRecord | null> {
  if (source === 'om') {
    const { data, error } = await supabaseAdmin
      .from('om_posts')
      .select(
        'post_id, creator_name, posted_at, caption, media_type, media_url, media_urls, poster_url, frames, ai_analysis, transcript'
      )
      .eq('post_id', id)
      .single()
    if (error || !data) return null
    const d = data as Record<string, unknown>
    return {
      library_id: String(d.post_id),
      page_name: (d.creator_name as string) ?? null,
      started_on: (d.posted_at as string) ?? null,
      ad_text: (d.caption as string) ?? null,
      media_type: (d.media_type as string) ?? null,
      media_url: (d.media_url as string) ?? null,
      media_urls: Array.isArray(d.media_urls) ? (d.media_urls as string[]) : null,
      poster_url: (d.poster_url as string) ?? null,
      frames: Array.isArray(d.frames) ? (d.frames as string[]) : null,
      ai_analysis: (d.ai_analysis as string) ?? null,
      transcript: typeof d.transcript === 'string' ? (d.transcript as string) : null,
    }
  }

  // 기본: am_ads (transcript 컬럼 없는 환경 폴백 포함)
  const cols =
    'library_id, page_name, started_on, ad_text, media_type, media_url, media_urls, poster_url, frames, ai_analysis'
  let { data, error } = await supabaseAdmin.from('am_ads').select(cols + ', transcript').eq('library_id', id).single()
  if (error) ({ data, error } = await supabaseAdmin.from('am_ads').select(cols).eq('library_id', id).single())
  if (error || !data) return null
  const d = data as Record<string, unknown>
  return {
    library_id: String(d.library_id),
    page_name: (d.page_name as string) ?? null,
    started_on: (d.started_on as string) ?? null,
    ad_text: (d.ad_text as string) ?? null,
    media_type: (d.media_type as string) ?? null,
    media_url: (d.media_url as string) ?? null,
    media_urls: Array.isArray(d.media_urls) ? (d.media_urls as string[]) : null,
    poster_url: (d.poster_url as string) ?? null,
    frames: Array.isArray(d.frames) ? (d.frames as string[]) : null,
    ai_analysis: (d.ai_analysis as string) ?? null,
    transcript: typeof d.transcript === 'string' ? (d.transcript as string) : null,
  }
}
