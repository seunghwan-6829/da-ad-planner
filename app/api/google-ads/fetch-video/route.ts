import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 온디맨드 영상 준비: 임베드 차단된 구글 광고(유튜브) 영상을 "재생 누를 때" 그 영상만 Apify 로 받아
//   Supabase 스토리지에 저장하고 media_url 을 교체 → 페이지가 <video> 로 재생.
//   클라이언트가 이 POST 를 몇 초마다 반복 호출(폴링): 처음엔 Apify 실행 시작, 이후엔 상태 확인 후 완료되면 저장.
//   같은 영상을 쓰는 다른 광고들도 한 번에 갱신(중복 다운로드 방지).
//
// ⚠️ Vercel 환경변수에 APIFY_TOKEN 필요.

const ACTOR = 'streamers~youtube-video-downloader'
const BUCKET = 'google-ad-media'

const vidId = (url: string) => {
  const s = String(url || '')
  return (
    s.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    s.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    s.match(/shorts\/([\w-]{6,})/)?.[1] ||
    null
  )
}

export async function POST(req: Request) {
  const token = process.env.APIFY_TOKEN
  if (!token) return NextResponse.json({ error: 'APIFY_TOKEN 미설정(Vercel 환경변수에 추가 필요)' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const libraryId = (body.library_id || '').toString().trim()
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_url, media_path, media_type')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  // 이미 스토리지 mp4 로 저장됨 → 바로 재생 가능.
  if (ad.media_url && !/youtube\.com|youtu\.be/i.test(ad.media_url)) {
    return NextResponse.json({ done: true, url: ad.media_url })
  }

  const id = vidId(ad.media_url || '')
  if (!id) return NextResponse.json({ error: '유튜브 영상 URL 이 아니에요.' }, { status: 400 })

  const path = `youtube/${id}.mp4`

  // 이미 진행 중인 Apify 실행이 있으면 상태 확인, 없으면 시작.
  const marker: string = typeof ad.media_path === 'string' ? ad.media_path : ''
  if (marker.startsWith('apify:')) {
    const runId = marker.slice(6)
    let status = 'RUNNING'
    try {
      const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
      if (st.ok) status = (await st.json()).data.status
    } catch {}

    if (status === 'SUCCEEDED') {
      // 데이터셋에서 다운로드 URL 찾아 스토리지에 영구 저장.
      let items: Array<Record<string, unknown>> = []
      try {
        const dsRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&clean=true`)
        items = await dsRes.json()
      } catch {}
      const item = (items || []).find((x) => x && (x.downloadedFileUrl as string)) || items?.[0]
      const fileUrl = item?.downloadedFileUrl as string | undefined
      if (!fileUrl) {
        await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('media_path', marker)
        return NextResponse.json({ error: '다운로드 결과가 없어요. 다시 시도해 주세요.' }, { status: 502 })
      }
      try {
        const u = fileUrl.includes('token=') ? fileUrl : fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'token=' + token
        const vr = await fetch(u)
        if (!vr.ok) throw new Error(`file ${vr.status}`)
        const buf = Buffer.from(await vr.arrayBuffer())
        const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
        if (up.error) throw new Error(up.error.message)
        const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
        // 같은 영상 id 를 쓰는 모든 광고 갱신.
        await supabaseAdmin
          .from('ga_ads')
          .update({ media_url: publicUrl, downloaded: true, media_path: path })
          .ilike('media_url', `%${id}%`)
        return NextResponse.json({ done: true, url: publicUrl })
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
      }
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('media_path', marker)
      return NextResponse.json({ error: `다운로드 실패(${status}). 다시 눌러주세요.` }, { status: 502 })
    }
    return NextResponse.json({ processing: true })
  }

  // 새 Apify 다운로드 실행 시작.
  try {
    const startRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: [{ url: `https://www.youtube.com/watch?v=${id}` }] }),
    })
    if (!startRes.ok) return NextResponse.json({ error: `Apify 시작 실패 ${startRes.status}` }, { status: 502 })
    const runId = (await startRes.json()).data.id
    // 같은 영상 광고들에 진행 마커.
    await supabaseAdmin.from('ga_ads').update({ media_path: `apify:${runId}` }).ilike('media_url', `%${id}%`)
    return NextResponse.json({ processing: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '시작 실패' }, { status: 500 })
  }
}
