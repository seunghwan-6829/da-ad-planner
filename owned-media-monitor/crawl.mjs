// 온드미디어(숏폼 전용) 크롤러 — 유튜브 쇼츠=yt-dlp / 인스타 릴스=Apify.
//   ▶ 숏폼만 수집: 유튜브는 /shorts 탭, 인스타는 릴스(영상)만. 롱폼·이미지·캐러셀 제외.
//   목표는 단순: "조회수 + 영상". (좋아요/댓글은 best-effort, 없으면 null→'—')
//   - 유튜브: yt-dlp 로 채널 /shorts 나열(조회수·제목) → 신규는 mp4 다운로드해 Supabase 영구 저장.
//   - 인스타: Apify instagram-scraper → 릴스만 필터 → CDN 만료 대비 영상·썸네일을 Supabase 저장.
//   결과는 om_posts 에 적재. 이번 실행에서 안 보인 기존 active 는 status='ended'.
// ⚠️ 메타 광고 크롤러(meta-ad-monitor)와 완전 분리. Playwright 불필요(유튜브=yt-dlp, 인스타=Apify).
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY
// 선택 env: APIFY_TOKEN(인스타 — 없으면 인스타 스킵), CRAWL_CREATOR_ID(단일), CRAWL_SINCE_HOURS(최근 N시간 추가분만),
//          IG_RESULTS_LIMIT(인스타 프로필당 최신 개수, 기본 5), YT_MAX_POSTS(유튜브 쇼츠 나열 상한, 기본 0=무제한),
//          YT_DOWNLOAD(0=다운로드 끔), YT_MAX_FILESIZE(기본 150M)

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
const execFileP = promisify(execFile)

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const APIFY_TOKEN = (process.env.APIFY_TOKEN || '').trim()
const CRAWL_CREATOR_ID = (process.env.CRAWL_CREATOR_ID || '').trim()
// 인스타 프로필당 최신 게시물 수. 0=무제한(전량). 미지정 시 5(주간 크롤 비용 통제).
const IG_RESULTS_LIMIT = process.env.IG_RESULTS_LIMIT === undefined || process.env.IG_RESULTS_LIMIT === ''
  ? 5 : Math.max(0, Number(process.env.IG_RESULTS_LIMIT) || 0)
// 채널당 쇼츠 나열 상한. 기본 0=무제한(임베드 방식이라 다운로드가 없어 전부 나열해도 부담 없음).
const YT_MAX_POSTS = Number(process.env.YT_MAX_POSTS ?? '0') || 0
// 유튜브는 기본 "임베드"로 가져온다(다운로드 X — 저장공간·봇차단 리스크 없음).
//   임베드 차단된 쇼츠만 media_url=null 로 표시 → 페이지에서 재생 버튼 누르면 온디맨드(로컬 서버)로 받는다.
//   YT_DOWNLOAD=1 을 명시하면 예전처럼 mp4 다운로드(로컬 실행용).
const YT_DOWNLOAD = (process.env.YT_DOWNLOAD || '0') === '1'
const YT_MAX_FILESIZE = process.env.YT_MAX_FILESIZE || '150M'
const STORAGE_BUCKET = 'owned-media'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 가 필요합니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[om-crawl]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
    log('다운로드 실패', String(e.message || e).slice(0, 120))
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

// ─────────────────────────── 유튜브 쇼츠 (yt-dlp) ───────────────────────────
// 채널 /shorts 탭을 yt-dlp 로 나열(메타데이터만, 빠름). id/제목/조회수.
async function enumerateYouTubeShorts(creator) {
  const baseUrl = (creator.url || '').replace(/\/+$/, '')
  const shortsUrl = /\/shorts$/i.test(baseUrl) ? baseUrl : `${baseUrl}/shorts`
  let stdout = ''
  try {
    const out = await execFileP('yt-dlp', [
      '--flat-playlist', '--dump-json', '--no-warnings', '--ignore-errors',
      ...(YT_MAX_POSTS > 0 ? ['--playlist-end', String(YT_MAX_POSTS)] : []), // 0=무제한(채널 쇼츠 전부)
      shortsUrl,
    ], { timeout: 300000, maxBuffer: 1024 * 1024 * 256 })
    stdout = out.stdout || ''
  } catch (e) {
    stdout = (e && e.stdout) || ''
    if (!stdout) { log('유튜브 쇼츠 나열 실패', creator.label, String((e && e.message) || e).slice(0, 120)); return { results: [], profile: { name: null } } }
  }
  const results = []
  let channelName = null
  for (const line of stdout.split('\n')) {
    const s = line.trim()
    if (!s) continue
    let j
    try { j = JSON.parse(s) } catch { continue }
    if (!j.id) continue
    channelName = channelName || j.channel || j.uploader || null
    results.push({
      post_id: `yt_${j.id}`,
      platform: 'youtube',
      post_url: `https://www.youtube.com/shorts/${j.id}`,
      caption: j.title || '',
      media_type: 'video',
      media_url: `https://www.youtube.com/watch?v=${j.id}`, // 다운로드 실패 시 임베드 폴백
      poster_url: `https://i.ytimg.com/vi/${j.id}/hqdefault.jpg`,
      posted_at: null, // 정확한 게시일은 다운로드(전체 추출) 때 채움
      views: typeof j.view_count === 'number' ? j.view_count : null,
      likes: null,
      comments: null,
    })
  }
  return { results, profile: { name: channelName } }
}

// 쇼츠 1개 다운로드 → 스토리지 영구 저장 + 정확한 게시일·조회수 추출. 실패/대용량이면 storedUrl null.
async function downloadYouTubeShort(url, videoId) {
  if (!YT_DOWNLOAD) return { storedUrl: null, uploadDate: null, views: null }
  const tmp = `/tmp/om_${videoId}.mp4`
  const meta = { uploadDate: null, views: null }
  try {
    const out = await execFileP('yt-dlp', [
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--max-filesize', YT_MAX_FILESIZE,
      '--no-playlist', '--no-warnings',
      '--print', 'after_move:%(upload_date)s|%(view_count)s',
      '-o', tmp, url,
    ], { timeout: 180000, maxBuffer: 1024 * 1024 * 64 })
    const line = String(out.stdout || '').trim().split('\n').pop() || ''
    const [d, v] = line.split('|')
    if (d && /^\d{8}$/.test(d)) meta.uploadDate = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
    if (v && /^\d+$/.test(v)) meta.views = Number(v)
  } catch (e) {
    log('yt-dlp 다운로드 실패/스킵', videoId, String((e && e.message) || e).slice(0, 120))
    return { storedUrl: null, uploadDate: null, views: null }
  }
  try {
    const buf = await readFile(tmp).catch(() => null)
    await unlink(tmp).catch(() => {})
    if (!buf || !buf.length) return { storedUrl: null, ...meta } // 상한 초과 등
    const { error } = await sb.storage.from(STORAGE_BUCKET).upload(`youtube/${videoId}.mp4`, buf, { contentType: 'video/mp4', upsert: true })
    if (error) { log('yt 업로드 실패', error.message); return { storedUrl: null, ...meta } }
    return { storedUrl: sb.storage.from(STORAGE_BUCKET).getPublicUrl(`youtube/${videoId}.mp4`).data.publicUrl, ...meta }
  } catch (e) {
    log('yt 저장 실패', String((e && e.message) || e).slice(0, 120))
    return { storedUrl: null, ...meta }
  }
}

// 임베드 가능 여부: oEmbed 가 200 이면 iframe 임베드 OK, 401/403 이면 임베드 차단.
async function isEmbeddable(videoId) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
    return r.ok
  } catch { return true } // 확인 실패 시엔 일단 임베드로(재생 안 되면 페이지 폴백이 처리)
}

// 유튜브 저장: 기본 임베드(다운로드 X). 임베드 차단 쇼츠만 media_url=null(온디맨드). 기존은 조회수만 갱신.
async function saveYouTube(creator, results, profile) {
  if (profile.name && !creator.profile_name) { try { await sb.from('om_creators').update({ profile_name: profile.name }).eq('id', creator.id) } catch {} }
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
    const videoId = r.post_id.replace(/^yt_/, '')
    let mediaUrl = r.media_url // 기본: watch URL(임베드)
    let postedAt = r.posted_at
    let views = r.views
    if (YT_DOWNLOAD) {
      // (옵션) 로컬 실행 시 mp4 영구 저장
      const dl = await downloadYouTubeShort(r.post_url, videoId)
      if (dl.storedUrl) mediaUrl = dl.storedUrl
      if (dl.uploadDate) postedAt = dl.uploadDate
      if (dl.views != null) views = dl.views
    } else if (!(await isEmbeddable(videoId))) {
      // 임베드 차단 → null 로 표시. 페이지에서 재생 버튼 누르면 온디맨드(로컬 서버)로 받아 재생.
      mediaUrl = null
    }
    newRows.push({
      ...r,
      media_url: mediaUrl,
      posted_at: postedAt,
      views,
      creator_id: creator.id,
      creator_name: profile.name || creator.label,
      last_seen_at: now,
      status: 'active',
    })
  }
  if (newRows.length) {
    try { const { error } = await sb.from('om_posts').upsert(newRows, { onConflict: 'post_id' }); if (error) log('yt upsert 오류', error.message) }
    catch (e) { log('yt upsert 예외', e.message) }
  }
  log(`유튜브 ${creator.label} → 신규 ${newRows.length} / 총 ${results.length}`)
  await markEnded(creator.id, seen, now)
}

// ─────────────────────────── 인스타 릴스 (Apify) ───────────────────────────
async function runApifyInstagram(directUrls, limit) {
  // limit 0 = 무제한(프로필 게시물 전부). Apify 는 미지정 시 소량만 줄 수 있어 큰 값으로 명시.
  const input = { directUrls, resultsType: 'posts', resultsLimit: limit > 0 ? limit : 100000, addParentData: false }
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

const normHandle = (creator) =>
  (creator.handle || (creator.url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || '').toLowerCase().replace(/^@/, '')

// 릴스 판별: 영상(Video) 또는 productType clips. 이미지/캐러셀(Sidecar)은 제외.
const isReel = (it) => !!it.shortCode && (it.productType === 'clips' || it.type === 'Video')

// 인스타 저장: 신규 릴스만 영상·썸네일을 스토리지에 받아 영구화. 기존은 조회수만 갱신.
async function saveInstagram(creator, items) {
  const now = new Date().toISOString()
  const reels = (items || []).filter(isReel)

  const { data: existingRows } = await sb.from('om_posts').select('post_id').eq('creator_id', creator.id)
  const existing = new Set((existingRows || []).map((x) => x.post_id))

  const seen = new Set()
  const newRows = []
  for (const it of reels) {
    const postId = `ig_${it.shortCode}`
    seen.add(postId)
    const views = it.videoViewCount ?? it.videoPlayCount ?? null
    if (existing.has(postId)) {
      try { await sb.from('om_posts').update({ views, last_seen_at: now, status: 'active' }).eq('post_id', postId) } catch {}
      continue
    }
    const storedVideo = await downloadToStorage(it.videoUrl, `reels/${it.shortCode}.mp4`, 'video/mp4')
    const storedPoster = await downloadToStorage(it.displayUrl, `posters/${it.shortCode}.jpg`, 'image/jpeg')
    newRows.push({
      post_id: postId,
      creator_id: creator.id,
      creator_name: creator.label,
      platform: 'instagram',
      post_url: it.url || `https://www.instagram.com/reel/${it.shortCode}/`,
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
    try { const { error } = await sb.from('om_posts').upsert(newRows, { onConflict: 'post_id' }); if (error) log('instagram upsert 오류', error.message) }
    catch (e) { log('instagram upsert 예외', e.message) }
  }
  log(`인스타 ${creator.label} → 신규 릴스 ${newRows.length} / 릴스 ${reels.length}`)
  await markEnded(creator.id, seen, now)
}

// ─────────────────────────── 메인 ───────────────────────────
async function main() {
  let q = sb.from('om_creators').select('*').eq('enabled', true)
  if (CRAWL_CREATOR_ID) q = q.eq('id', CRAWL_CREATOR_ID)
  const { data: creators, error } = await q
  if (error) { console.error('크리에이터 로드 실패:', error.message); process.exit(1) }
  if (!creators?.length) { log('크롤할 크리에이터가 없습니다.'); return }

  // CRAWL_SINCE_HOURS: 최근 N시간 내 추가된 크리에이터만(0=전체). bat 즉시 크롤(24h)용 = 크리에이터 단위 중복 방지.
  const sinceHours = Number(process.env.CRAWL_SINCE_HOURS) || 0
  let list = creators
  if (sinceHours > 0) {
    const cutoff = Date.now() - sinceHours * 3600 * 1000
    const before = list.length
    list = list.filter((c) => c.created_at && new Date(c.created_at).getTime() >= cutoff)
    log(`최근 ${sinceHours}시간 내 추가된 크리에이터만: ${list.length}/${before}명`)
    if (!list.length) { log('해당 기간 내 새 크리에이터가 없습니다.'); return }
  }

  const youtube = list.filter((c) => c.platform === 'youtube')
  const instagram = list.filter((c) => c.platform === 'instagram')
  log(`유튜브 ${youtube.length}명(쇼츠) / 인스타 ${instagram.length}명(릴스) 크롤 시작`)

  // ── 유튜브 쇼츠: yt-dlp ──
  for (const c of youtube) {
    try {
      const { results, profile } = await enumerateYouTubeShorts(c)
      log(`유튜브 ${c.label} → 쇼츠 ${results.length}개`)
      await saveYouTube(c, results, profile)
    } catch (e) {
      log('유튜브 처리 실패', c.id, String((e && e.message) || e).slice(0, 120))
    }
  }

  // ── 인스타 릴스: Apify(한 번에 전체) ──
  if (instagram.length) {
    if (!APIFY_TOKEN) {
      log('⚠️ APIFY_TOKEN 미설정 → 인스타 수집 건너뜀. (GitHub 시크릿 APIFY_TOKEN 등록 필요)')
    } else {
      const urls = instagram.map((c) => `https://www.instagram.com/${normHandle(c)}/`).filter((u) => !u.endsWith('//'))
      try {
        const items = await runApifyInstagram(urls, IG_RESULTS_LIMIT)
        log(`Apify 인스타 결과 ${items.length}건`)
        const byHandle = new Map(instagram.map((c) => [normHandle(c), c]))
        const grouped = new Map()
        for (const it of items) {
          const h = (it.ownerUsername || '').toLowerCase()
          if (!byHandle.has(h)) continue
          if (!grouped.has(h)) grouped.set(h, [])
          grouped.get(h).push(it)
        }
        for (const c of instagram) {
          await saveInstagram(c, grouped.get(normHandle(c)) || [])
        }
      } catch (e) {
        log('Apify 인스타 실패', String((e && e.message) || e).slice(0, 120))
      }
    }
  }

  log('완료')
}

main().catch((e) => { console.error(e); process.exit(1) })
