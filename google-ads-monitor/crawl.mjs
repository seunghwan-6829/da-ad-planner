// 구글 광고 크롤러 — 구글 광고 투명성 센터를 Apify(silva95gustavo/google-ads-scraper)로 수집.
//   광고주(ga_targets)별로 광고를 긁어 ga_ads 에 적재. 영상 광고는 유튜브 URL → yt-dlp,
//   직접 영상 URL → fetch 로 받아 Supabase 스토리지에 영구 저장(광고 내려가도 소재 보존).
//   신규만 다운로드(기존은 last_shown/조회영역 갱신). 이번에 안 보인 active 는 ended 표기.
// ⚠️ 메타/온드미디어 크롤러와 완전 분리. ga_ 접두 테이블·google-ad-media 버킷 전용.
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFY_TOKEN
// 선택 env: CRAWL_TARGET_ID(단일 광고주 즉시), CRAWL_SINCE_HOURS(최근 N시간 추가분만),
//          GA_RESULTS_LIMIT(광고주당 최대 광고, 기본 120), YT_DOWNLOAD(0=영상 다운로드 끔), YT_MAX_FILESIZE(기본 200M)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const CRAWL_TARGET_ID = (process.env.CRAWL_TARGET_ID || '').trim()
const GA_RESULTS_LIMIT = Number(process.env.GA_RESULTS_LIMIT) || 120
const STORAGE_BUCKET = 'google-ad-media'
const ACTOR = 'silva95gustavo~google-ads-scraper'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[ga-crawl]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 직접 미디어 URL(이미지/영상) → 스토리지 영구 저장. 실패 시 null.
async function downloadToStorage(url, path, contentType) {
  if (!url) return null
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 100 * 1024 * 1024) return null
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, buf, { contentType, upsert: true })
    if (error) { log('storage 업로드 실패', error.message); return null }
    return sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    log('다운로드 실패', String(e.message || e).slice(0, 120))
    return null
  }
}

async function markEnded(targetId, seenIds, now) {
  try {
    const { data: existing } = await sb.from('ga_ads').select('library_id').eq('target_id', targetId).eq('status', 'active')
    const gone = (existing || []).map((x) => x.library_id).filter((id) => !seenIds.has(id))
    if (gone.length) {
      await sb.from('ga_ads').update({ status: 'ended', ended_at: now }).in('library_id', gone)
      log(`${gone.length}개 종료 표기`)
    }
  } catch {}
}

// Apify 액터 비동기 실행 → 완료까지 폴링 → 데이터셋 반환.
async function runApify(url, limit) {
  const input = {
    startUrls: [{ url }],
    resultsLimit: limit,
    skipDetails: false,
    shouldDownloadAssets: true, // 영상 등 크리에이티브 asset URL 확보
    ocr: true, // 이미지 광고의 텍스트도 추출(카피 보강)
  }
  const startRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
  if (!startRes.ok) throw new Error(`Apify 시작 실패 ${startRes.status}: ${(await startRes.text()).slice(0, 200)}`)
  const run = (await startRes.json()).data
  const runId = run.id
  const datasetId = run.defaultDatasetId
  let status = run.status
  const deadline = Date.now() + 12 * 60 * 1000
  while (Date.now() < deadline && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    await sleep(5000)
    try {
      const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
      if (st.ok) status = (await st.json()).data.status
    } catch {}
  }
  if (status !== 'SUCCEEDED') throw new Error(`Apify run 상태 ${status}`)
  const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true`)
  if (!itemsRes.ok) throw new Error(`Apify items ${itemsRes.status}`)
  return await itemsRes.json()
}

const isYouTube = (u) => /youtube\.com|youtu\.be|googlevideo\.com/i.test(u || '')

// Apify 광고 아이템 → ga_ads row 형태로 정규화.
function normalizeAd(it, target) {
  const format = (it.format || '').toString().toUpperCase()
  const variations = Array.isArray(it.variations) ? it.variations : []
  const images = variations.map((v) => v && v.imageUrl).filter(Boolean)
  // 영상 URL: 여러 가능 필드 방어적으로 탐색
  const videoSrc =
    it.videoUrl || it.video || it.videoUrls?.[0] ||
    variations.map((v) => v && (v.videoUrl || v.video)).find(Boolean) || null

  let mediaType = 'image'
  if (format === 'VIDEO' || videoSrc) mediaType = 'video'
  else if (format === 'TEXT') mediaType = 'text'
  else if (images.length > 1) mediaType = 'carousel'

  // 카피: 변형들의 description/cta/headline + OCR 취합
  const copyParts = []
  for (const v of variations) {
    if (!v) continue
    if (v.description) copyParts.push(v.description)
    if (v.cta) copyParts.push(`[CTA] ${v.cta}`)
    if (v.headline) copyParts.push(v.headline)
  }
  if (it.ocrText) copyParts.push(it.ocrText)
  if (it.text) copyParts.push(it.text)
  const adText = Array.from(new Set(copyParts.map((s) => String(s).trim()).filter(Boolean))).join('\n')

  return {
    library_id: String(it.creativeId || it.adId || `${target.advertiser_id}_${Math.random().toString(36).slice(2, 9)}`),
    target_id: target.id,
    page_name: it.advertiserName || target.label,
    started_on: it.firstShown || null,
    last_shown: it.lastShown || null,
    ad_text: adText || null,
    media_type: mediaType,
    media_urls: images.length ? images : null,
    poster_url: it.previewUrl || images[0] || null,
    landing_url: variations.find((v) => v && v.clickUrl)?.clickUrl || null,
    source_url: it.adLibraryUrl || null,
    format: format || null,
    regions: Array.isArray(it.regionStats) ? it.regionStats : null,
    video_src_url: videoSrc,
    _images: images,
  }
}

// advertiser_id 가 'AR...' 이면 광고주 URL, 'domain:xxx' 이면 도메인 검색 URL 로 Apify 에 넘긴다.
function buildTransparencyUrl(advertiserId, region) {
  const aid = String(advertiserId || '')
  if (aid.startsWith('domain:')) {
    return `https://adstransparency.google.com/?region=${region}&domain=${encodeURIComponent(aid.slice(7))}`
  }
  return `https://adstransparency.google.com/advertiser/${aid}?region=${region}`
}

async function processTarget(target) {
  const region = target.country || 'KR'
  const url = buildTransparencyUrl(target.advertiser_id, region)
  let items = []
  try {
    items = await runApify(url, GA_RESULTS_LIMIT)
  } catch (e) {
    log('Apify 실패', target.label, String(e.message || e).slice(0, 160))
    return
  }
  log(`광고주 ${target.label} → Apify 결과 ${items.length}건`)
  if (!items.length) return

  const now = new Date().toISOString()
  const { data: existingRows } = await sb.from('ga_ads').select('library_id').eq('target_id', target.id)
  const existing = new Set((existingRows || []).map((x) => x.library_id))

  // 광고주명 보강
  const firstName = items.find((x) => x.advertiserName)?.advertiserName
  if (firstName && !target.profile_name) { try { await sb.from('ga_targets').update({ profile_name: firstName }).eq('id', target.id) } catch {} }

  const seen = new Set()
  const newRows = []
  for (const it of items) {
    const row = normalizeAd(it, target)
    if (seen.has(row.library_id)) continue
    seen.add(row.library_id)

    if (existing.has(row.library_id)) {
      // 기존: 마지막 게재일/상태만 갱신(저장 미디어 보존)
      try { await sb.from('ga_ads').update({ last_shown: row.last_shown, last_seen_at: now, status: 'active' }).eq('library_id', row.library_id) } catch {}
      continue
    }

    // 신규: 미디어 처리
    //   - 유튜브 영상 광고(대부분) → 다운로드 X, 임베드(유튜브 URL 그대로). 빠르고 영구.
    //   - 비유튜브 영상(구글 CDN 등, 만료 가능) → 스토리지 저장.
    //   - 이미지 → 대표 1장 스토리지 저장(썸네일용).
    let mediaUrl = null
    let downloaded = false
    const key = row.library_id.replace(/[^\w-]/g, '').slice(0, 40)
    if (row.media_type === 'video' && row.video_src_url) {
      if (/youtube\.com|youtu\.be/i.test(row.video_src_url)) {
        mediaUrl = row.video_src_url
        downloaded = false
      } else {
        mediaUrl = await downloadToStorage(row.video_src_url, `video/${key}.mp4`, 'video/mp4')
        downloaded = !!mediaUrl
      }
    } else if (row._images && row._images.length) {
      mediaUrl = await downloadToStorage(row._images[0], `image/${key}.jpg`, 'image/jpeg')
      downloaded = !!mediaUrl
    }

    const { _images, ...clean } = row
    void _images
    newRows.push({
      ...clean,
      media_url: mediaUrl || row.video_src_url || (row._images && row._images[0]) || null,
      poster_url: (downloaded && row.media_type !== 'video' ? mediaUrl : null) || row.poster_url,
      downloaded,
      last_seen_at: now,
      status: 'active',
    })
  }

  if (newRows.length) {
    try { const { error } = await sb.from('ga_ads').upsert(newRows, { onConflict: 'library_id' }); if (error) log('upsert 오류', error.message) }
    catch (e) { log('upsert 예외', e.message) }
  }
  log(`광고주 ${target.label} → 신규 ${newRows.length} / 총 ${seen.size}`)
  await markEnded(target.id, seen, now)
}

async function main() {
  if (!APIFY_TOKEN) { console.error('APIFY_TOKEN 이 필요합니다.'); process.exit(1) }

  let q = sb.from('ga_targets').select('*').eq('enabled', true)
  if (CRAWL_TARGET_ID) q = q.eq('id', CRAWL_TARGET_ID)
  const { data: targets, error } = await q
  if (error) { console.error('광고주 로드 실패:', error.message); process.exit(1) }
  if (!targets?.length) { log('크롤할 광고주가 없습니다.'); return }

  // CRAWL_SINCE_HOURS: 최근 N시간 내 추가된 광고주만(0=전체). bat 즉시 크롤(24h)용.
  const sinceHours = Number(process.env.CRAWL_SINCE_HOURS) || 0
  let list = targets
  if (sinceHours > 0) {
    const cutoff = Date.now() - sinceHours * 3600 * 1000
    const before = list.length
    list = list.filter((t) => t.created_at && new Date(t.created_at).getTime() >= cutoff)
    log(`최근 ${sinceHours}시간 내 추가된 광고주만: ${list.length}/${before}개`)
    if (!list.length) { log('해당 기간 내 새 광고주가 없습니다.'); return }
  }
  // advertiser_id 없는 항목은 스킵
  list = list.filter((t) => t.advertiser_id)
  log(`${list.length}개 광고주 크롤 시작`)

  for (const t of list) {
    try { await processTarget(t) } catch (e) { log('광고주 처리 예외', t.id, String(e.message || e).slice(0, 120)) }
  }
  log('완료')
}

main().catch((e) => { console.error(e); process.exit(1) })
