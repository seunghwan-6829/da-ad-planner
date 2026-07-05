// 구글 광고 영상 백필 — 크롤은 빠르게 메타데이터만 담고(skipDetails), 영상은 여기서 전부 받아 Supabase에 영구 저장.
//   2단계로 처리(메타 광고 크롤러처럼 "일단 수집 → 이후 내부 다운로드"):
//     1) 상세 해석(resolve): 영상 광고인데 media_url 이 비어있는 행 → 광고 상세(source_url=adLibraryUrl)를
//        Apify 스크레이퍼(skipDetails=false)로 긁어 유튜브 영상 URL 을 알아내 media_url 에 채움.
//     2) 다운로드(download): media_url 이 유튜브 URL 인 행 → Apify 다운로더로 mp4 를 받아 스토리지에 저장하고
//        media_url 을 그 공개 URL 로 교체(→ 페이지에서 <video> 직접 재생). 광고 내려가도 소재 보존.
//   ※ 구글 광고 영상은 대부분 "임베드 금지"라 iframe 재생 불가. yt-dlp 는 클라우드 IP 봇차단으로 실패 →
//     좋은 IP를 쓰는 Apify 다운로더로 우회(유료). 고유 영상 id 기준 중복 제거·이어받기(이미 받은 건 스킵).
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFY_TOKEN
// 선택 env: MAX_VIDEOS(이번 실행 최대 다운로드 영상 수, 0=전체), BATCH(다운로더 1실행당 영상 수, 기본 25),
//          RESOLVE_BATCH(스크레이퍼 1실행당 상세 URL 수, 기본 20), RESOLVE_MAX(이번 실행 최대 상세해석 수, 0=전체),
//          TIME_BUDGET_MIN(잡 타임아웃 전 스스로 멈출 시간, 기본 50)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS) || 0
const BATCH = Number(process.env.BATCH) || 25
const RESOLVE_BATCH = Math.max(1, Number(process.env.RESOLVE_BATCH) || 20)
const RESOLVE_MAX = Number(process.env.RESOLVE_MAX) || 0
const TIME_BUDGET_MIN = Number(process.env.TIME_BUDGET_MIN) || 50
const BUCKET = 'google-ad-media'
const DOWNLOADER = 'streamers~youtube-video-downloader'
const SCRAPER = 'silva95gustavo~google-ads-scraper'
const START_AT = Date.now()
const overBudget = () => Date.now() - START_AT > TIME_BUDGET_MIN * 60 * 1000

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !APIFY_TOKEN) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY / APIFY_TOKEN 필요'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const log = (...a) => console.log('[ga-video]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const vidId = (url) => {
  const s = String(url || '')
  return (s.match(/[?&]v=([\w-]{6,})/) || [])[1] || (s.match(/youtu\.be\/([\w-]{6,})/) || [])[1] || (s.match(/shorts\/([\w-]{6,})/) || [])[1] || null
}

// Apify 액터 실행 → 완료까지 폴링 → 데이터셋(전량) 반환. SUCCEEDED 아니어도 들어온 만큼 사용.
async function runActor(actor, input, maxMin) {
  const s = await fetch(`https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!s.ok) throw new Error(`start ${s.status}: ${(await s.text()).slice(0, 150)}`)
  const run = (await s.json()).data
  let st = run.status
  const dl = Date.now() + maxMin * 60 * 1000
  while (Date.now() < dl && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(st)) {
    await sleep(6000)
    try { const r = await fetch(`https://api.apify.com/v2/actor-runs/${run.id}?token=${APIFY_TOKEN}`); if (r.ok) st = (await r.json()).data.status } catch {}
  }
  const out = []
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=1000&offset=${off}`)
    if (!r.ok) break
    const chunk = await r.json()
    if (!Array.isArray(chunk) || !chunk.length) break
    out.push(...chunk)
    if (chunk.length < 1000) break
  }
  return out
}

// ── 1단계: 상세 해석 ── 영상 광고인데 media_url 비어있는 행 → 유튜브 URL 채우기.
async function loadUnresolved(limit) {
  const { data, error } = await sb
    .from('ga_ads').select('library_id, source_url')
    .eq('media_type', 'video').eq('downloaded', false)
    .is('media_url', null).not('source_url', 'is', null)
    .or('media_path.is.null,media_path.neq.novideo') // 'novideo' 마커(유튜브영상 없음) 제외, 나머지·null 포함
    .limit(limit)
  if (error) { log('unresolved 로드 오류', error.message); return [] }
  return data || []
}

function videoUrlFromItem(it) {
  const variations = Array.isArray(it.variations) ? it.variations : []
  return it.videoUrl || it.video || variations.map((v) => v && (v.videoUrl || v.video)).find(Boolean) || null
}

async function resolvePhase() {
  let resolved = 0, novideo = 0, processed = 0
  while (!overBudget()) {
    if (RESOLVE_MAX > 0 && processed >= RESOLVE_MAX) break
    const take = RESOLVE_MAX > 0 ? Math.min(RESOLVE_BATCH, RESOLVE_MAX - processed) : RESOLVE_BATCH
    const rows = await loadUnresolved(take)
    if (!rows.length) break
    processed += rows.length
    log(`상세 해석 배치 ${rows.length}건...`)
    let items = []
    try {
      items = await runActor(SCRAPER, {
        startUrls: rows.map((r) => ({ url: r.source_url })),
        resultsLimit: rows.length + 5, skipDetails: false, shouldDownloadAssets: false, ocr: false,
      }, 15)
    } catch (e) { log('스크레이퍼 실패', String(e.message || e).slice(0, 140)); break }

    // creativeId(=library_id) → videoUrl 매핑
    const found = new Map()
    for (const it of items) {
      const id = String(it.creativeId || it.adId || '')
      const vurl = videoUrlFromItem(it)
      if (id && vurl) found.set(id, vurl)
    }
    for (const r of rows) {
      const vurl = found.get(String(r.library_id))
      if (vurl) {
        try { await sb.from('ga_ads').update({ media_url: vurl, media_path: null }).eq('library_id', r.library_id) } catch {}
        resolved++
      } else {
        // 이 광고엔 유튜브 영상이 없음(비유튜브/실패) → 재처리 방지 마커.
        try { await sb.from('ga_ads').update({ media_path: 'novideo' }).eq('library_id', r.library_id) } catch {}
        novideo++
      }
    }
    log(`누적 상세: 해석 ${resolved} / 영상없음 ${novideo}`)
  }
  log(`상세 해석 완료: 유튜브URL 확보 ${resolved} / 영상없음 ${novideo}`)
}

// ── 2단계: 다운로드 ── media_url 이 유튜브 URL 인 행 → mp4 받아 스토리지 저장.
async function loadPending() {
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads').select('library_id, media_url')
      .eq('media_type', 'video').eq('downloaded', false).ilike('media_url', '%youtu%')
      .range(off, off + 999)
    if (error) { log('pending 로드 오류', error.message); break }
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

async function apifyDownload(ids) {
  const items = await runActor(DOWNLOADER, { videos: ids.map((id) => ({ url: `https://www.youtube.com/watch?v=${id}` })) }, 20)
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

async function downloadPhase() {
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
  if (!ids.length) return

  let done = 0, fail = 0
  for (let i = 0; i < ids.length; i += BATCH) {
    if (overBudget()) { log('시간 예산 도달 — 다음 실행에서 이어받음'); break }
    const chunk = ids.slice(i, i + BATCH)
    log(`Apify 다운로드 요청 ${i + 1}~${i + chunk.length} / ${ids.length}...`)
    let dlMap = new Map()
    try { dlMap = await apifyDownload(chunk) } catch (e) { log('다운로더 배치 실패', String(e.message || e).slice(0, 150)) }
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
  log(`다운로드 완료: 성공 ${done} / 실패 ${fail} / 대상 ${ids.length} (실패분은 다시 실행 시 이어받음)`)
}

async function main() {
  log(`시작 (시간예산 ${TIME_BUDGET_MIN}분)`)
  await resolvePhase()   // 1) 영상 광고 상세 → 유튜브 URL 확보
  await downloadPhase()  // 2) 유튜브 URL → mp4 스토리지 저장
  log('전체 완료')
}

main().catch((e) => { console.error(e); process.exit(1) })
