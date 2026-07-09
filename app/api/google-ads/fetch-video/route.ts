import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 영상 재생 상태 조회 — ⚠️ Apify(youtube-video-downloader) 호출 제거. 이 경로로는 절대 과금되지 않는다.
//   • 이미 Supabase 에 받아둔 영상이면 그 URL 반환 → 즉시 재생.
//   • 아직이면 notReady 안내. 실제 다운로드는 (1) 매일 자동(내 PC yt-dlp) + (2) 내 PC 로컬 서버(serve-videos)로
//     무료 처리된다. 페이지는 먼저 로컬 서버(127.0.0.1)를 시도하고, 없을 때만 이 라우트로 상태를 확인한다.
const isStored = (u: string | null) => !!u && /\/storage\/v1\/object\//.test(u)

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const libraryId = (body.library_id || '').toString().trim()
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_url')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  // 이미 받아둔 영상 → 바로 재생.
  if (isStored(ad.media_url)) return NextResponse.json({ done: true, url: ad.media_url })

  // 아직 안 받음 → Apify 안 쓰고 안내만.
  return NextResponse.json({
    notReady: true,
    error: '이 영상은 아직 준비 전이에요. 매일 자동으로 받아지고 있어요. 지금 바로 보려면 내 PC에서 로컬 영상 서버(serve-videos.bat)를 켜주세요.',
  })
}
