// 구글 광고 크롤러 — 구글 광고 투명성 센터를 Apify(silva95gustavo/google-ads-scraper)로 수집.
//   광고주(ga_targets)별로 광고를 긁어 ga_ads 에 적재. 영상 광고는 유튜브 URL → yt-dlp,
//   직접 영상 URL → fetch 로 받아 Supabase 스토리지에 영구 저장(광고 내려가도 소재 보존).
//   신규만 다운로드(기존은 last_shown/조회영역 갱신). 이번에 안 보인 active 는 ended 표기.
// ⚠️ 메타/온드미디어 크롤러와 완전 분리. ga_ 접두 테이블·google-ad-media 버킷 전용.
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY, APIFY_TOKEN
// 선택 env: CRAWL_TARGET_ID(단일 광고주 즉시), CRAWL_SINCE_HOURS(최근 N시간 추가분만),
//          GA_RESULTS_LIMIT(광고주당 최대 광고, 0=사실상 전량, 기본 0),
//          GA_CONCURRENCY(동시에 돌릴 광고주 수 = Apify 병렬 실행 수, 기본 5),
//          GA_MIN_INTERVAL_DAYS(광고주별 최소 재크롤 간격, 기본 40 / 0=가드 끔),
//          GA_FORCE=1(가드 무시하고 전량 강제 크롤)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const CRAWL_TARGET_ID = (process.env.CRAWL_TARGET_ID || '').trim()
// 0(기본) = 사실상 무제한(광고주 광고가 몇 천개여도 전부). 숫자로 상한 지정 가능.
const GA_RESULTS_LIMIT = Number(process.env.GA_RESULTS_LIMIT) || 0
const HARD_CAP = 100000 // resultsLimit 미지정 시 액터가 소량만 줄 수 있어 큰 값으로 명시.
const GA_CONCURRENCY = Math.max(1, Number(process.env.GA_CONCURRENCY) || 5)
// 광고주별 최소 재크롤 간격(일). 정기 크롤에서 이 기간 안에 이미 크롤된 광고주는 건너뛴다.
// 주간 크론 + 40일 가드 = 광고주 1명당 실제 재수집은 약 6주(42일)마다 → Apify 비용 대폭 절감 + 주 단위 분산.
const GA_MIN_INTERVAL_DAYS = Number(process.env.GA_MIN_INTERVAL_DAYS ?? 40)
const GA_FORCE = (process.env.GA_FORCE || '') === '1'
const ACTOR = 'silva95gustavo~google-ads-scraper'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[ga-crawl]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// Apify 액터 비동기 실행 → 완료까지 폴링 → 데이터셋 전량 반환.
// 광고주 1명당 1 실행. 실행 여러 개를 동시에 돌려(GA_CONCURRENCY) 시간 단축하고,
// 각 광고주가 자기 resultsLimit 예산을 온전히 써서 과소수집을 막는다.
async function runApifyOne(url, limit, label) {
  const input = {
    startUrls: [{ url }],
    resultsLimit: limit > 0 ? limit : HARD_CAP, // 0 이면 사실상 전량.
    // ⚠️ skipDetails=true: 상세페이지 안 열어 매우 빠름(광고주당 수백~천개 수집). 대신 영상/이미지 "원본 URL"은
    //    안 나오고 previewUrl(썸네일)+adLibraryUrl 만 나옴 → 영상은 백필/온디맨드로 상세를 따로 받는다.
    skipDetails: true,
    shouldDownloadAssets: false,
    ocr: false,
  }
  // 동시 실행 한도(429)·일시 오류 대비: 지수 백오프로 몇 번 재시도.
  let run = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const startRes = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?token=${APIFY_TOKEN}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    if (startRes.ok) { run = (await startRes.json()).data; break }
    const body = (await startRes.text()).slice(0, 200)
    if ((startRes.status === 429 || startRes.status >= 500) && attempt < 5) {
      const wait = Math.min(30000, 3000 * 2 ** attempt)
      log(`⏳ ${label} 시작 대기(${startRes.status}) ${wait / 1000}s 후 재시도`)
      await sleep(wait); continue
    }
    throw new Error(`Apify 시작 실패 ${startRes.status}: ${body}`)
  }
  if (!run) throw new Error('Apify 시작 실패(재시도 소진)')
  const runId = run.id
  const datasetId = run.defaultDatasetId
  let status = run.status
  const deadline = Date.now() + 75 * 60 * 1000 // 광고주 1명 기준 넉넉히.
  while (Date.now() < deadline && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
    await sleep(6000)
    try {
      const st = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_TOKEN}`)
      if (st.ok) status = (await st.json()).data.status
    } catch {}
  }
  // SUCCEEDED 아니어도(타임아웃 등) 데이터셋에 들어온 만큼은 사용 — 부분수집이라도 살린다.
  if (status !== 'SUCCEEDED') log(`⚠️ ${label} run 상태 ${status} — 수집분만 저장`)
  const all = []
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_TOKEN}&clean=true&limit=1000&offset=${offset}`)
    if (!r.ok) break
    const chunk = await r.json()
    if (!Array.isArray(chunk) || !chunk.length) break
    all.push(...chunk)
    if (chunk.length < 1000) break
  }
  return all
}

// 리스트를 워커 pool(동시 concurrency개)로 처리. 하나 끝나면 다음 것을 집어 계속.
async function runPool(items, concurrency, worker) {
  let idx = 0
  const next = async () => {
    while (idx < items.length) {
      const i = idx++
      await worker(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()))
}

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

  const preview = it.previewUrl || null
  // skipDetails=true 라 영상/이미지 원본 URL이 없을 수 있음.
  //  - 영상: media_url=null → 재생 시 온디맨드로 상세(유튜브 URL) 가져와 다운로드. poster는 previewUrl(썸네일).
  //  - 이미지/텍스트/캐러셀: 원본 이미지 있으면 그걸, 없으면 previewUrl 을 media_url 로(카드/상세에서 바로 표시).
  const mediaUrl = mediaType === 'video' ? null : (images[0] || preview || null)

  return {
    library_id: String(it.creativeId || it.adId || `${target.advertiser_id}_${Math.random().toString(36).slice(2, 9)}`),
    target_id: target.id,
    // 브랜드명은 사용자가 정한 라벨 사용. 구글 advertiserName 은 도메인 호스팅사(예: 카페24)로 뜨는 경우가 많아 안 씀.
    page_name: target.label,
    started_on: it.firstShown || null,
    last_shown: it.lastShown || null,
    ad_text: adText || null,
    media_type: mediaType,
    media_urls: images.length ? images : null,
    poster_url: preview || images[0] || null,
    landing_url: variations.find((v) => v && v.clickUrl)?.clickUrl || null,
    source_url: it.adLibraryUrl || null,
    format: format || null,
    regions: Array.isArray(it.regionStats) ? it.regionStats : null,
    video_src_url: videoSrc,
    _mediaUrl: mediaUrl,
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

async function saveTargetAds(target, items) {
  if (!items || !items.length) { log(`광고주 ${target.label} → 결과 0건`); return }
  const now = new Date().toISOString()
  const { data: existingRows } = await sb.from('ga_ads').select('library_id').eq('target_id', target.id)
  const existing = new Set((existingRows || []).map((x) => x.library_id))

  // ⚠️ profile_name 을 구글 advertiserName 으로 채우지 않는다(도메인 호스팅사=카페24 등으로 떠서 브랜드명이 뭉개짐).
  //    브랜드명은 사용자가 정한 target.label 을 그대로 표시.

  const seen = new Set()
  const newRows = []
  for (const it of items) {
    const row = normalizeAd(it, target)
    if (seen.has(row.library_id)) continue
    seen.add(row.library_id)

    // 구글이 원본을 막아 재생수단이 전혀 없는 영상(poster 썸네일·영상주소 모두 없음) → 담지 않음.
    //   정상 영상은 previewUrl(=i.ytimg.com 썸네일)이 있어 안 걸림. 이 조건은 "표시 불가" 광고만 걸러낸다.
    if (row.media_type === 'video' && !row.poster_url && !row.video_src_url) {
      continue
    }

    if (existing.has(row.library_id)) {
      // 기존: 마지막 게재일/상태만 갱신(저장 미디어 보존)
      try { await sb.from('ga_ads').update({ last_shown: row.last_shown, last_seen_at: now, status: 'active' }).eq('library_id', row.library_id) } catch {}
      continue
    }

    // 신규: 크롤 단계에선 다운로드 안 함(빠르게). 영상=media_url null(재생 시 온디맨드), 이미지/텍스트=previewUrl 표시.
    const { _images, _mediaUrl, video_src_url, ...clean } = row
    void _images
    newRows.push({
      ...clean,
      video_src_url,
      media_url: _mediaUrl, // 영상=null, 이미지/텍스트=previewUrl(또는 원본 이미지)
      downloaded: false,
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

// 이 광고주를 마지막으로 크롤한 시각(ms). 크롤할 때마다 ga_ads.last_seen_at 을 now 로 갱신하므로
// 그 최댓값을 '마지막 크롤 시각'으로 쓴다(별도 컬럼/마이그레이션 불필요).
// 광고가 한 건도 없으면 0 = '크롤된 적 없음' 취급 → 항상 크롤 대상(비용도 거의 안 듦).
async function lastCrawledAt(targetId) {
  try {
    const { data } = await sb
      .from('ga_ads').select('last_seen_at').eq('target_id', targetId)
      .order('last_seen_at', { ascending: false }).limit(1)
    const v = data?.[0]?.last_seen_at
    return v ? new Date(v).getTime() : 0
  } catch { return 0 }
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

  // ── 광고주별 재크롤 간격 가드(Apify 비용 절감) ──
  // 정기 크롤에서 최근 GA_MIN_INTERVAL_DAYS(기본 40일) 안에 이미 크롤된 광고주는 건너뛴다.
  // 예외(항상 크롤): 단일 광고주 지정(CRAWL_TARGET_ID) / 신규 추가분(CRAWL_SINCE_HOURS) / GA_FORCE=1
  if (!CRAWL_TARGET_ID && !sinceHours && !GA_FORCE && GA_MIN_INTERVAL_DAYS > 0) {
    const cutoff = Date.now() - GA_MIN_INTERVAL_DAYS * 86400 * 1000
    const before = list.length
    const due = []
    for (const t of list) {
      const last = await lastCrawledAt(t.id)
      if (!last || last < cutoff) due.push(t)
      else log(`건너뜀 — ${t.label} (${Math.round((Date.now() - last) / 86400000)}일 전 크롤 · ${GA_MIN_INTERVAL_DAYS}일 미경과)`)
    }
    list = due
    log(`${GA_MIN_INTERVAL_DAYS}일 가드: ${list.length}/${before}개 광고주가 이번 회차 대상`)
    if (!list.length) { log('이번 회차엔 크롤할 광고주가 없습니다(전부 최근 크롤됨). 종료.'); return }
  }

  log(`${list.length}개 광고주 크롤 시작 (동시 ${GA_CONCURRENCY}개 병렬, 광고주당 상한 ${GA_RESULTS_LIMIT || '무제한'})`)

  // 광고주 1명당 1 Apify 실행 → 최대 GA_CONCURRENCY개를 동시에. 끝나는 즉시 그 광고주 저장.
  let okCount = 0, totalAds = 0
  await runPool(list, GA_CONCURRENCY, async (t) => {
    const url = buildTransparencyUrl(t.advertiser_id, t.country || 'KR')
    try {
      const items = await runApifyOne(url, GA_RESULTS_LIMIT, t.label)
      totalAds += items.length
      await saveTargetAds(t, items)
      okCount++
    } catch (e) {
      log('광고주 처리 실패', t.label, String(e.message || e).slice(0, 160))
    }
  })
  log(`완료: ${okCount}/${list.length} 광고주, 수집 총 ${totalAds}건`)
}

main().catch((e) => { console.error(e); process.exit(1) })
