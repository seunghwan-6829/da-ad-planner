import { supabaseAdmin } from '@/lib/supabase-admin'
import { resolveYoutubeStream, ytIdFrom, isPermanentReason } from '@/lib/youtube-stream'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/* 구글 광고 영상 재생용 단일 진입점.  <video src="/api/google-ads/video/<library_id>"> 하나면 끝.
   ⚠️ 과금 0 (Apify 안 씀), 로컬 PC 불필요 → 어느 PC에서 열어도 동일하게 재생된다.

   동작:
     1) 이미 Supabase 에 받아둔 영상(720p 영구본) → 그 URL 로 302. 프록시 대역폭 0.
     2) 아니면 유튜브 InnerTube 로 직접 스트림 URL 을 뽑아(≈0.2초) 바이트를 그대로 중계.
        - 임베드 차단 소재도 이 경로는 막히지 않는다(임베드 제약은 iframe 에만 적용).
        - 같은 오리진이라 CORS·캔버스 오염이 없다 → 프레임 추출/몰입 흐름 분석이 그대로 동작.
     3) Range 요청을 그대로 전달해 탐색(스크럽)과 빠른 시작을 지원.
   재생 불가일 때만 JSON 으로 사유를 돌려준다(프론트가 임베드/안내로 폴백). */

const isStored = (u: string | null | undefined) => !!u && /\/storage\/v1\/object\//.test(u)

const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ error, ...extra }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

export async function GET(req: Request, { params }: { params: Promise<{ libraryId: string }> }) {
  const { libraryId } = await params
  if (!libraryId) return fail(400, 'library_id 필요')
  if (!supabaseAdmin) return fail(500, '서버 설정 오류')

  const { data: ad } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_url, poster_url, media_path')
    .eq('library_id', libraryId)
    .maybeSingle()
  if (!ad) return fail(404, '광고를 찾을 수 없습니다.')

  // ① 영구본이 있으면 그쪽으로(고화질 720p + Supabase CDN).
  if (isStored(ad.media_url)) {
    return Response.redirect(ad.media_url as string, 302)
  }
  if (ad.media_path === 'dead') {
    return fail(410, '원본 영상이 유튜브에서 삭제/차단돼 재생할 수 없어요.', { dead: true })
  }

  const videoId = ytIdFrom(ad.poster_url, ad.media_url)
  if (!videoId) {
    return fail(404, '구글이 이 광고의 영상 주소를 공개하지 않아 앱에서 재생할 수 없어요.', { noSource: true })
  }

  // ② 유튜브에서 직접 스트림 URL 추출.
  let resolved
  try {
    resolved = await resolveYoutubeStream(videoId)
  } catch (e) {
    const reason = String((e as Error)?.message || e)
    if (isPermanentReason(reason)) {
      // 원본이 내려간 영상 → 'dead' 로 표시해 다음부터 헛시도 안 하게(일일 다운로더와 같은 컨벤션).
      try {
        await supabaseAdmin.from('ga_ads').update({ media_path: 'dead' }).eq('library_id', libraryId)
      } catch {}
      return fail(410, '원본 영상이 유튜브에서 삭제/차단돼 재생할 수 없어요.', { dead: true })
    }
    return fail(502, '지금은 영상 주소를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.', { reason: reason.slice(0, 200) })
  }

  // ③ 바이트 중계 — Range 를 그대로 전달해 빠른 시작·탐색을 지원.
  const range = req.headers.get('range')
  const upstream = await fetch(resolved.url, {
    headers: {
      // googlevideo 는 UA 를 보고 거절할 수 있어 추출에 쓴 클라이언트와 결을 맞춘다.
      'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
      ...(range ? { Range: range } : {}),
    },
  }).catch(() => null)

  if (!upstream || !upstream.ok || !upstream.body) {
    return fail(502, '영상 서버 연결에 실패했어요. 다시 시도해 주세요.', { upstream: upstream?.status ?? 0 })
  }

  const h = new Headers()
  h.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4')
  h.set('Accept-Ranges', 'bytes')
  h.set('Cache-Control', 'private, max-age=600')
  h.set('X-Video-Quality', resolved.quality)
  h.set('X-Video-Source', resolved.client)
  for (const k of ['content-length', 'content-range']) {
    const v = upstream.headers.get(k)
    if (v) h.set(k, v)
  }
  return new Response(upstream.body, { status: upstream.status, headers: h })
}
