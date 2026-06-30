// 온드미디어(UGC) 크롤러 — 유튜브=Playwright / 인스타=Apify.
//   목표는 단순: "조회수 + 영상"만 확실히 가져온다. (좋아요/댓글/공유/저장은 best-effort, 없으면 null→'—')
//   - 유튜브: 채널 /videos·/shorts 의 ytInitialData 에서 조회수·제목·썸네일. 영상은 임베드(watch URL)로 재생.
//   - 인스타: Apify instagram-scraper 로 릴스 수집 → CDN URL 은 만료되므로 영상·썸네일을 Supabase 스토리지에 받아 영구화.
//   결과는 om_posts 에 적재. 이번 실행에서 안 보인 기존 active 콘텐츠는 status='ended' 표기.
// ⚠️ 메타 광고 크롤러(meta-ad-monitor)와 완전 분리. 이 파일은 온드미디어 전용.
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY
// 선택 env: APIFY_TOKEN(인스타 수집에 필요 — 없으면 인스타는 건너뜀), CRAWL_CREATOR_ID(단일 즉시 크롤),
//          IG_RESULTS_LIMIT(인스타 프로필당 최신 개수, 기본 5), YT_MAX_POSTS(유튜브 채널당 최대, 기본 40)

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
const execFileP = promisify(execFile)

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const CRAWL_CREATOR_ID = (process.env.CRAWL_CREATOR_ID || '').trim()
const IG_RESULTS_LIMIT = Number(process.env.IG_RESULTS_LIMIT) || 5
const YT_MAX_POSTS = Number(process.env.YT_MAX_POSTS) || 40
// 유튜브 영상 다운로드(yt-dlp). 0이면 임베드만(다운로드 끔). 대용량 방지 상한(롱폼 자동 폴백).
const YT_DOWNLOAD = (process.env.YT_DOWNLOAD || '1') !== '0'
const YT_MAX_FILESIZE = process.env.YT_MAX_FILESIZE || '150M'
const STORAGE_BUCKET = 'owned-media'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[om-crawl]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// "조회수 1.2만회" / "1.2M views" / "1,234" → 정수(추정). 실패 시 null.
function parseCount(s) {
  if (s == null) return null
  if (typeof s === 'number') return Number.isFinite(s) ? s : null
  const str = String(s).replace(/조회수|views?|view|회|,|\s/gi, '').trim()
  if (!str) return null
  const m = str.match(/([\d.]+)\s*([만천억KMB]?)/i)
  if (!m) {
    const plain = Number(String(s).replace(/[^\d]/g, ''))
    return Number.isFinite(plain) && plain > 0 ? plain : null
  }
  const num = parseFloat(m[1])
  const unit = (m[2] || '').toUpperCase()
  const mult =
    unit === '만' ? 1e4 : unit === '천' ? 1e3 : unit === '억' ? 1e8 : unit === 'K' ? 1e3 : unit === 'M' ? 1e6 : unit === 'B' ? 1e9 : 1
  const v = Math.round(num * mult)
  return Number.isFinite(v) ? v : null
}

// 만료되는 CDN URL(인스타) → Supabase 스토리지에 받아 영구 공개 URL 반환. 실패 시 null.
async function downloadToStorage(url, path, contentType) {
  if (!url) return null
  try {
    const r = await fetch(url)
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > 80 * 1024 * 1024) return null
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, buf, { contentType, upsert: true })
    if (error) { log('storage 업로드 실패', error.message); return null }
    return sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    log('다운로드 실패', e.message)
    return null
  }
}

// 유튜브 영상을 yt-dlp 로 mp4 추출 → 스토리지 영구 저장. 실패/대용량(상한 초과)이면 null(임베드 폴백).
async function downloadYouTubeVideo(videoUrl, videoId) {
  if (!YT_DOWNLOAD) return null
  const tmp = `/tmp/om_${videoId}.mp4`
  try {
    await execFileP(
      'yt-dlp',
      [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '--max-filesize', YT_MAX_FILESIZE,
        '--no-playlist', '--no-warnings', '--quiet',
        '-o', tmp,
        videoUrl,
      ],
      { timeout: 150000, maxBuffer: 1024 * 1024 * 64 }
    )
  } catch (e) {
    log('yt-dlp 실패/스킵', videoId, String(e.message || e).slice(0, 120))
    return null
  }
  try {
    const buf = await readFile(tmp).catch(() => null)
    await unlink(tmp).catch(() => {})
    if (!buf || !buf.length) return null // 상한 초과 시 파일 미생성 → null
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(`youtube/${videoId}.mp4`, buf, { contentType: 'video/mp4', upsert: true })
    if (error) { log('yt 업로드 실패', error.message); return null }
    return sb.storage.from(STORAGE_BUCKET).getPublicUrl(`youtube/${videoId}.mp4`).data.publicUrl
  } catch (e) {
    log('yt 저장 실패', String(e.message || e).slice(0, 120))
    return null
  }
}

// 이번 실행에서 안 보인 기존 active 콘텐츠 → ended 표기(best-effort).
async function markEnded(creatorId, seenIds, now) {
  try {
    const { data: existing } = await sb.from('om_posts').select('post_id').eq('creator_id', creatorId).eq('status', 'active')
    const gone = (existing || []).map((x) => x.post_id).filter((id) => !seenIds.has(id))
    if (gone.length) {
      await sb.from('om_posts').update({ status: 'ended', ended_at: now }).in('post_id', gone)
      log(`${gone.length}개 종료 표기`)
    }
  } catch {}
}

// ─────────────────────────── 유튜브 (Playwright) ───────────────────────────
async function crawlYouTube(page, creator) {
  const base = (creator.url || '').replace(/\/+$/, '')
  const results = []
  let profile = { name: null, image: null }

  for (const sub of ['/videos', '/shorts']) {
    let data = null
    try {
      await page.goto(base + sub, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(1500)
      data = await page.evaluate(() => window.ytInitialData || null)
    } catch (e) {
      log('youtube goto 실패', base + sub, e.message)
      continue
    }
    if (!data) continue

    // 채널 프로필(이름/아바타)
    try {
      const md = data.metadata?.channelMetadataRenderer
      if (md) {
        profile.name = profile.name || md.title || null
        const av = md.avatar?.thumbnails
        if (av?.length) profile.image = profile.image || av[av.length - 1].url
      }
    } catch {}

    // 영상 그리드 → 조회수·제목·썸네일
    try {
      const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || []
      for (const tab of tabs) {
        const items = tab.tabRenderer?.content?.richGridRenderer?.contents || []
        for (const it of items) {
          const vr = it.richItemRenderer?.content?.videoRenderer || it.richItemRenderer?.content?.reelItemRenderer
          if (!vr?.videoId) continue
          const videoId = vr.videoId
          const title = vr.title?.runs?.[0]?.text || vr.title?.simpleText || vr.headline?.simpleText || ''
          const thumbs = vr.thumbnail?.thumbnails || []
          const poster = thumbs.length ? thumbs[thumbs.length - 1].url : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
          const viewText = vr.viewCountText?.simpleText || vr.viewCountText?.runs?.map((r) => r.text).join('') || null
          const published = vr.publishedTimeText?.simpleText || null
          results.push({
            post_id: `yt_${videoId}`,
            platform: 'youtube',
            post_url: `https://www.youtube.com/watch?v=${videoId}`,
            caption: title,
            media_type: 'video',
            media_url: `https://www.youtube.com/watch?v=${videoId}`, // 임베드 재생(영구)
            poster_url: poster,
            posted_at: published,
            views: parseCount(viewText),
            likes: null,
            comments: null,
          })
          if (results.length >= YT_MAX_POSTS) break
        }
        if (results.length >= YT_MAX_POSTS) break
      }
    } catch (e) {
      log('youtube 파싱 실패', e.message)
    }
    if (results.length >= YT_MAX_POSTS) break
  }

  return { results, profile }
}

// 유튜브 저장: 신규 영상만 yt-dlp 로 받아 스토리지에 영구 저장(실패 시 임베드용 watch URL 유지).
// 기존 항목은 조회수만 갱신(저장된 mp4 보존).
async function saveYouTube(creator, results, profile) {
  // 프로필 보강
  const cPatch = {}
  if (profile.name && !creator.profile_name) cPatch.profile_name = profile.name
  if (profile.image && !creator.profile_image) cPatch.profile_image = profile.image
  if (Object.keys(cPatch).length) { try { await sb.from('om_creators').update(cPatch).eq('id', creator.id) } catch {} }

  if (!results.length) return
  const now = new Date().toISOString()

  const { data: existingRows } = await sb.from('om_posts').select('post_id').eq('creator_id', creator.id)
  const existing = new Set((existingRows || []).map((x) => x.post_id))

  const seen = new Set()
  const newRows = []
  for (const r of results) {
    seen.add(r.post_id)
    if (existing.has(r.post_id)) {
      try { await sb.from('om_posts').update({ views: r.views, last_seen_at: now, status: 'active' }).eq('post_id', r.post_id) } catch {}
      continue
    }
    // 신규: 영상 다운로드 시도(실패/대용량이면 watch URL 유지 → 페이지가 임베드 폴백)
    const videoId = r.post_id.replace(/^yt_/, '')
    const stored = await downloadYouTubeVideo(r.post_url, videoId)
    newRows.push({
      ...r,
      media_url: stored || r.media_url,
      creator_id: creator.id,
      creator_name: profile.name || creator.label,
      last_seen_at: now,
      status: 'active',
    })
  }
  if (newRows.length) {
    try {
      const { error } = await sb.from('om_posts').upsert(newRows, { onConflict: 'post_id' })
      if (error) log('youtube upsert 오류', error.message)
    } catch (e) { log('youtube upsert 예외', e.message) }
  }
  log(`유튜브 ${creator.label} → 신규 ${newRows.length} / 총 ${results.length}`)
  await markEnded(creator.id, seen, now)
}

// ─────────────────────────── 인스타 (Apify) ───────────────────────────
// Apify instagram-scraper 를 비동기로 실행 → 완료까지 폴링 → 데이터셋 아이템 반환.
async function runApifyInstagram(directUrls, limit) {
  const input = { directUrls, resultsType: 'posts', resultsLimit: limit, addParentData: false }
  const startRes = await fetch(`https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!startRes.ok) throw new Error(`Apify 시작 실패 ${startRes.status}: ${(await startRes.text()).slice(0, 200)}`)
  const run = (await startRes.json()).data
  const runId = run.id
  const datasetId = run.defaultDatasetId
  let status = run.status
  const deadline = Date.now() + 12 * 60 * 1000 // 최대 12분
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

const normHandle = (creator) =>
  (creator.handle || (creator.url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || '').toLowerCase().replace(/^@/, '')

// 인스타 저장: 신규 릴스만 영상·썸네일을 스토리지에 받아 저장(영구). 기존 것은 조회수만 갱신(저장된 미디어 보존).
async function saveInstagram(creator, items) {
  const now = new Date().toISOString()
  // 영상(릴스)만 — 조회수+영상이 목적. 이미지/사이드카는 조회수가 없어 제외.
  const videos = (items || []).filter((it) => (it.type === 'Video' || it.productType === 'clips' || it.videoUrl) && it.shortCode)

  // 기존 보유분(미디어 보존용)
  const { data: existingRows } = await sb.from('om_posts').select('post_id').eq('creator_id', creator.id)
  const existing = new Set((existingRows || []).map((x) => x.post_id))

  const seen = new Set()
  const newRows = []
  for (const it of videos) {
    const postId = `ig_${it.shortCode}`
    seen.add(postId)
    const views = it.videoViewCount ?? it.videoPlayCount ?? null

    if (existing.has(postId)) {
      // 조회수만 갱신(미디어 URL 은 이미 스토리지에 영구 저장돼 있으니 건드리지 않음)
      try { await sb.from('om_posts').update({ views, last_seen_at: now, status: 'active' }).eq('post_id', postId) } catch {}
      continue
    }

    // 신규: 영상·썸네일을 스토리지에 받아 영구화(실패 시 CDN URL 폴백)
    const storedVideo = await downloadToStorage(it.videoUrl, `reels/${it.shortCode}.mp4`, 'video/mp4')
    const storedPoster = await downloadToStorage(it.displayUrl, `posters/${it.shortCode}.jpg`, 'image/jpeg')
    newRows.push({
      post_id: postId,
      creator_id: creator.id,
      creator_name: creator.label,
      platform: 'instagram',
      post_url: it.url || `https://www.instagram.com/p/${it.shortCode}/`,
      caption: it.caption || '',
      media_type: 'video',
      media_url: storedVideo || it.videoUrl || null,
      poster_url: storedPoster || it.displayUrl || null,
      posted_at: it.timestamp ? String(it.timestamp).slice(0, 10) : null,
      views,
      likes: it.likesCount ?? null,
      comments: it.commentsCount ?? null,
      last_seen_at: now,
      status: 'active',
    })
  }

  if (newRows.length) {
    try {
      const { error } = await sb.from('om_posts').upsert(newRows, { onConflict: 'post_id' })
      if (error) log('instagram upsert 오류', error.message)
    } catch (e) { log('instagram upsert 예외', e.message) }
  }
  log(`인스타 ${creator.label} → 신규 ${newRows.length} / 영상 ${videos.length}`)
  await markEnded(creator.id, seen, now)
}

// ─────────────────────────── 메인 ───────────────────────────
async function main() {
  let q = sb.from('om_creators').select('*').eq('enabled', true)
  if (CRAWL_CREATOR_ID) q = q.eq('id', CRAWL_CREATOR_ID)
  const { data: creators, error } = await q
  if (error) { console.error('크리에이터 로드 실패:', error.message); process.exit(1) }
  if (!creators?.length) { log('크롤할 크리에이터가 없습니다.'); return }

  const youtube = creators.filter((c) => c.platform === 'youtube')
  const instagram = creators.filter((c) => c.platform === 'instagram')
  log(`유튜브 ${youtube.length}명 / 인스타 ${instagram.length}명 크롤 시작`)

  // ── 유튜브: Playwright ──
  if (youtube.length) {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      locale: 'ko-KR',
      viewport: { width: 1280, height: 900 },
    })
    for (const c of youtube) {
      const page = await context.newPage()
      page.setDefaultTimeout(45000)
      try {
        const { results, profile } = await crawlYouTube(page, c)
        log(`유튜브 ${c.label} → ${results.length}개`)
        await saveYouTube(c, results, profile)
      } catch (e) {
        log('유튜브 처리 실패', c.id, e.message)
      } finally {
        await page.close().catch(() => {})
      }
    }
    await browser.close().catch(() => {})
  }

  // ── 인스타: Apify 배치(한 번에 전체) ──
  if (instagram.length) {
    if (!APIFY_TOKEN) {
      log('⚠️ APIFY_TOKEN 미설정 → 인스타 수집 건너뜀. (GitHub 시크릿 APIFY_TOKEN 등록 필요)')
    } else {
      const urls = instagram.map((c) => `https://www.instagram.com/${normHandle(c)}/`).filter((u) => !u.endsWith('//'))
      try {
        const items = await runApifyInstagram(urls, IG_RESULTS_LIMIT)
        log(`Apify 인스타 결과 ${items.length}건`)
        // ownerUsername 으로 크리에이터에 매핑
        const byHandle = new Map(instagram.map((c) => [normHandle(c), c]))
        const grouped = new Map()
        for (const it of items) {
          const h = (it.ownerUsername || '').toLowerCase()
          if (!byHandle.has(h)) continue
          if (!grouped.has(h)) grouped.set(h, [])
          grouped.get(h).push(it)
        }
        for (const c of instagram) {
          const its = grouped.get(normHandle(c)) || []
          await saveInstagram(c, its)
        }
      } catch (e) {
        log('Apify 인스타 실패', e.message)
      }
    }
  }

  log('완료')
}

main().catch((e) => { console.error(e); process.exit(1) })
