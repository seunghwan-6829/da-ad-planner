import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 온디맨드 영상 준비(재생 누를 때 그 영상만):
//   구글 광고 목록은 skipDetails 로 대량 수집돼서 영상 광고는 media_url 이 비어있음(썸네일만).
//   재생 시 이 라우트를 폴링하며 단계적으로 처리:
//     1) 상세 로딩: source_url(투명성센터 광고 상세)로 그 광고의 유튜브 URL 을 가져와 media_url 에 저장
//     2) 다운로드: 유튜브 URL 을 Apify 다운로더로 받아 스토리지 저장 → media_url 을 mp4 로 교체
//   → 페이지가 <video> 로 재생. 본 영상만 비용.
// ⚠️ Vercel 환경변수 APIFY_TOKEN 필요.

const SCRAPER = 'silva95gustavo~google-ads-scraper'
const DOWNLOADER = 'streamers~youtube-video-downloader'
const BUCKET = 'google-ad-media'

const vidId = (url: string) => {
  const s = String(url || '')
  return s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1] || s.match(/shorts\/([\w-]{6,})/)?.[1] || null
}
const isStored = (u: string | null) => !!u && /\/storage\/v1\/object\//.test(u)

async function runStatus(runId: string, token: string): Promise<string> {
  try {
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${token}`)
    if (r.ok) return (await r.json()).data.status
  } catch {}
  return 'RUNNING'
}
async function runItems(runId: string, token: string): Promise<Array<Record<string, unknown>>> {
  try {
    const r = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${token}&clean=true`)
    return await r.json()
  } catch {
    return []
  }
}
async function startRun(actor: string, input: unknown, token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!r.ok) return null
    return (await r.json()).data.id
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const token = process.env.APIFY_TOKEN
  if (!token) return NextResponse.json({ error: 'APIFY_TOKEN 미설정(Vercel 환경변수에 추가 필요)' }, { status: 500 })

  const body = await req.json().catch(() => ({}))
  const libraryId = (body.library_id || '').toString().trim()
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_url, media_path, media_type, source_url')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  // 이미 스토리지 mp4 → 재생 가능.
  if (isStored(ad.media_url)) return NextResponse.json({ done: true, url: ad.media_url })

  const marker: string = typeof ad.media_path === 'string' ? ad.media_path : ''

  // ── 단계 1 진행중: 상세(유튜브 URL) 로딩 ──
  if (marker.startsWith('detail:')) {
    const runId = marker.slice(7)
    const status = await runStatus(runId, token)
    if (status === 'SUCCEEDED') {
      const items = await runItems(runId, token)
      const it = items?.[0] || {}
      const variations = Array.isArray(it.variations) ? (it.variations as Array<Record<string, unknown>>) : []
      const vurl =
        (it.videoUrl as string) ||
        (variations.map((v) => v && (v.videoUrl as string)).find(Boolean) as string) ||
        null
      if (!vurl) {
        await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('library_id', libraryId)
        return NextResponse.json({ error: '이 광고의 영상 URL을 찾지 못했어요.' }, { status: 502 })
      }
      const landing = (variations.find((v) => v && v.clickUrl)?.clickUrl as string) || undefined
      await supabaseAdmin
        .from('ga_ads')
        .update({ media_url: vurl, media_path: null, ...(landing ? { landing_url: landing } : {}) })
        .eq('library_id', libraryId)
      return NextResponse.json({ processing: true }) // 다음 폴링에서 다운로드 시작
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('library_id', libraryId)
      return NextResponse.json({ error: `상세 로딩 실패(${status}). 다시 눌러주세요.` }, { status: 502 })
    }
    return NextResponse.json({ processing: true })
  }

  // ── 단계 2 진행중: 영상 다운로드 ──
  if (marker.startsWith('apify:')) {
    const runId = marker.slice(6)
    const status = await runStatus(runId, token)
    if (status === 'SUCCEEDED') {
      const items = await runItems(runId, token)
      const item = items.find((x) => x && (x.downloadedFileUrl as string)) || items?.[0]
      const fileUrl = item?.downloadedFileUrl as string | undefined
      const id = vidId(ad.media_url || '')
      if (!fileUrl || !id) {
        await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('library_id', libraryId)
        return NextResponse.json({ error: '다운로드 결과가 없어요. 다시 시도해 주세요.' }, { status: 502 })
      }
      try {
        const u = fileUrl.includes('token=') ? fileUrl : fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'token=' + token
        const vr = await fetch(u)
        if (!vr.ok) throw new Error(`file ${vr.status}`)
        const buf = Buffer.from(await vr.arrayBuffer())
        const path = `youtube/${id}.mp4`
        const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
        if (up.error) throw new Error(up.error.message)
        const publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
        await supabaseAdmin.from('ga_ads').update({ media_url: publicUrl, downloaded: true, media_path: path }).ilike('media_url', `%${id}%`)
        return NextResponse.json({ done: true, url: publicUrl })
      } catch (e) {
        return NextResponse.json({ error: e instanceof Error ? e.message : '저장 실패' }, { status: 500 })
      }
    }
    if (['FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
      await supabaseAdmin.from('ga_ads').update({ media_path: null }).eq('library_id', libraryId)
      return NextResponse.json({ error: `다운로드 실패(${status}). 다시 눌러주세요.` }, { status: 502 })
    }
    return NextResponse.json({ processing: true })
  }

  // ── 마커 없음: 다음 할 일 결정 ──
  const yid = vidId(ad.media_url || '')
  if (!yid) {
    // media_url 이 유튜브가 아님(대개 null) → 먼저 상세 로딩으로 유튜브 URL 확보.
    if (!ad.source_url) return NextResponse.json({ error: '이 광고의 상세 링크가 없어요.' }, { status: 400 })
    const runId = await startRun(SCRAPER, { startUrls: [{ url: ad.source_url }], resultsLimit: 1, skipDetails: false, shouldDownloadAssets: false, ocr: false }, token)
    if (!runId) return NextResponse.json({ error: '상세 로딩 시작 실패' }, { status: 502 })
    await supabaseAdmin.from('ga_ads').update({ media_path: `detail:${runId}` }).eq('library_id', libraryId)
    return NextResponse.json({ processing: true })
  }

  // media_url 이 유튜브 URL → 다운로드 시작.
  const runId = await startRun(DOWNLOADER, { videos: [{ url: `https://www.youtube.com/watch?v=${yid}` }] }, token)
  if (!runId) return NextResponse.json({ error: '다운로드 시작 실패' }, { status: 502 })
  await supabaseAdmin.from('ga_ads').update({ media_path: `apify:${runId}` }).ilike('media_url', `%${yid}%`)
  return NextResponse.json({ processing: true })
}
