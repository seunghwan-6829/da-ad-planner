import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 제작 리스트 항목의 원본 소재를 출처 테이블에서 조회해 "통일된 모양"으로 반환.
//   GET ?source=meta|google|owned & ref=<id>
//   → { source, ref_id, brand, text, media_type, media_url, media_urls, poster_url, landing_url, origin_url, platform, stats }
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const source = searchParams.get('source') || ''
  const ref = (searchParams.get('ref') || '').trim()
  if (!ref) return NextResponse.json({ error: 'ref 필요' }, { status: 400 })

  if (source === 'meta') {
    const { data, error } = await supabaseAdmin
      .from('am_ads')
      .select('library_id, page_name, ad_text, media_type, media_url, media_urls, poster_url, landing_url, status, ended_at')
      .eq('library_id', ref)
      .single()
    if (error || !data) return NextResponse.json({ error: '원본 소재를 찾을 수 없어요(삭제됐을 수 있음).' }, { status: 404 })
    return NextResponse.json({
      source,
      ref_id: data.library_id,
      brand: data.page_name,
      text: data.ad_text || '',
      media_type: data.media_type,
      media_url: data.media_url,
      media_urls: data.media_urls || [],
      poster_url: data.poster_url,
      landing_url: data.landing_url,
      origin_url: `https://www.facebook.com/ads/library/?id=${encodeURIComponent(data.library_id)}`,
      ended: data.status === 'ended' || !!data.ended_at,
    })
  }

  if (source === 'google') {
    const { data, error } = await supabaseAdmin
      .from('ga_ads')
      .select('library_id, page_name, ad_text, media_type, media_url, media_urls, poster_url, landing_url, source_url, status, ended_at, media_path')
      .eq('library_id', ref)
      .single()
    if (error || !data) return NextResponse.json({ error: '원본 소재를 찾을 수 없어요(삭제됐을 수 있음).' }, { status: 404 })
    return NextResponse.json({
      source,
      ref_id: data.library_id,
      brand: data.page_name,
      text: data.ad_text || '',
      media_type: data.media_type,
      media_url: data.media_url,
      media_urls: data.media_urls || [],
      poster_url: data.poster_url,
      landing_url: data.landing_url,
      origin_url:
        data.source_url ||
        `https://adstransparency.google.com/?searchTerm=${encodeURIComponent(data.page_name || '')}&region=KR`,
      dead: data.media_path === 'dead', // 원본 영상이 유튜브에서 삭제/차단됨
      ended: data.status === 'ended' || !!data.ended_at,
    })
  }

  if (source === 'owned') {
    const { data, error } = await supabaseAdmin
      .from('om_posts')
      .select('post_id, creator_name, platform, post_url, caption, media_type, media_url, media_urls, poster_url, views, likes, comments, status, ended_at')
      .eq('post_id', ref)
      .single()
    if (error || !data) return NextResponse.json({ error: '원본 콘텐츠를 찾을 수 없어요(삭제됐을 수 있음).' }, { status: 404 })
    return NextResponse.json({
      source,
      ref_id: data.post_id,
      brand: data.creator_name,
      text: data.caption || '',
      media_type: data.media_type,
      media_url: data.media_url,
      media_urls: data.media_urls || [],
      poster_url: data.poster_url,
      landing_url: null,
      origin_url: data.post_url,
      platform: data.platform,
      stats: { views: data.views, likes: data.likes, comments: data.comments },
      ended: data.status === 'ended' || !!data.ended_at,
    })
  }

  return NextResponse.json({ error: 'source 는 meta/google/owned 중 하나' }, { status: 400 })
}
