// 구글 광고 영상 백필 — 임베드 차단 유튜브 광고 영상을 Apify(streamers/youtube-video-downloader)로 받아
//   Supabase 스토리지에 영구 저장하고 ga_ads.media_url 을 그 URL 로 교체(→ 페이지에서 <video> 직접 재생).
//   ※ 구글 광고 영상은 대부분 "임베드 금지"라 iframe 재생 불가. yt-dlp 는 유튜브가 클라우드 IP를 봇 차단해서 실패 →
//     좋은 IP를 쓰는 Apify 다운로더로 우회(유료: 대략 영상당 ~$0.06, 다운로드 MB 기준).
//   고유 영상 id 기준 중복 제거(같은 영상 쓰는 광고들 한 번에 갱신), 이어받기(이미 받은 건 스킵), 배치.
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFY_TOKEN
// 선택 env: MAX_VIDEOS(이번 실행 최대, 0=전체), BATCH(한 Apify 실행당 영상 수, 기본 25)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS) || 0
const BATCH = Number(process.env.BATCH) || 25
const BUCKET = 'google-ad-media'
const ACTOR = 'streamers~youtube-video-downloader'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APIFY_TOKEN) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY / APIFY_TOKEN 필요'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const log = (...a) => console.log('[ga-video]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const vidId = (url) => {
  const s = String(url || '')
  return (s.match(/[?&]v=([\w-]{6,})/) || [])[1] || (s.match(/youtu\.be\/([\w-]{6,})/) || [])[1] || (s.match(/shorts\/([\w-]{6,})/) || [])[1] || null
}

// 아직 유튜브 URL(임베드) 상태인 영상 광고 행 전부 로드.
async function loadPending() {
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads').select('library_id, media_url')
      .eq('media_type', 'video').eq('downloaded', false).ilike('media_url', '%youtu%')
      .range(off, off + 999)
    if (error) { log('로드 오류', error.message); break }
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

// Apify 다운로더로 여러 영상을 한 실행에서 받아 { id -> downloadedFileUrl } 반환.
async function apifyDownload(ids) {
  const input = { videos: ids.map((id) => ({ url: `https://www.youtube.com/watch?v=${id}` })) }
  const s = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!s.ok) throw new Error(`start ${s.status}: ${(await s.text()).slice(0, 150)}`)
  const run = (await s.json()).data
  let st = run.status
  const dl = Date.now() + 20 * 60 * 1000
  while (Date.now() < dl && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(st)) {
    await sleep(6000)
    try { const r = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`); if (r.ok) st = (await r.json()).data.status } catch {}
  }
  // SUCCEEDED 아니어도 데이터셋에 들어온 만큼은 사용.
  let items = []
  try { items = await (await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&clean=true`)).json() } catch {}
  const m = new Map()
  for (const it of items || []) { if (it && it.id && it.downloadedFileUrl) m.set(String(it.id), it.downloadedFileUrl) }
  return m
}

// Apify KV의 임시 파일(3일 만료) → 받아서 Supabase 스토리지에 영구 저장. 공개 URL 반환.
async function storeVideo(id, fileUrl) {
  try {
    const u = fileUrl.includes('token=') ? fileUrl : fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'token=' + APIFY_TOKEN
    const r = await fetch(u)
    if (!r.ok) { log('파일 다운로드 실패', id, r.status); return null }
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 300 * 1024 * 1024) return null
    const path = `youtube/${id}.mp4`
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (error) { log('업로드 실패', id, error.message); return null }
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    log('저장 예외', id, String(e.message || e).slice(0, 100))
    return null
  }
}

async function main() {
  const pending = await loadPending()
  const byVid = new Map()
  for (const r of pending) {
    const id = vidId(r.media_url)
    if (!id) continue
    if (!byVid.has(id)) byVid.set(id, [])
    byVid.get(id).push(r.library_id)
  }
  let ids = [...byVid.keys()]
  if (MAX_VIDEOS > 0) ids = ids.slice(0, MAX_VIDEOS)
  log(`미다운로드 영상행 ${pending.length} → 고유 영상 ${byVid.size}개, 이번 처리 ${ids.length}개 (배치 ${BATCH})`)
  if (!ids.length) { log('받을 영상이 없습니다.'); return }

  let done = 0, fail = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    const chunk = ids.slice(i, i + BATCH)
    log(`Apify 다운로드 요청 ${i + 1}~${i + chunk.length} / ${ids.length}...`)
    let dlMap = new Map()
    try { dlMap = await apifyDownload(chunk) } catch (e) { log('Apify 배치 실패', String(e.message || e).slice(0, 150)) }
    for (const id of chunk) {
      const fileUrl = dlMap.get(id)
      if (!fileUrl) { fail++; continue }
      const stored = await storeVideo(id, fileUrl)
      if (stored) {
        try { await sb.from('ga_ads').update({ media_url: stored, downloaded: true, media_path: `youtube/${id}.mp4` }).in('library_id', byVid.get(id)) } catch {}
        done++
      } else fail++
    }
    log(`누적: 성공 ${done} / 실패 ${fail}`)
  }
  log(`완료: 성공 ${done} / 실패 ${fail} / 대상 ${ids.length} (실패분은 다시 실행 시 이어받음)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
