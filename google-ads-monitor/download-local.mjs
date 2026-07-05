// 구글 광고 영상 — "내 PC(가정용 IP)"에서 yt-dlp 로 무료 다운로드 → Supabase 영구 저장.
//   구글 광고영상은 임베드차단·비공개 유튜브라 iframe 재생 불가, 클라우드(GitHub/Vercel) IP는 봇차단됨.
//   → 가정용 IP인 내 PC에서 yt-dlp 로 받으면 무료로 잘 됨(로컬 검증 완료). 받은 mp4 를 google-ad-media 버킷에
//   올리고 ga_ads.media_url 을 그 공개 URL 로 교체 → 페이지에서 <video> 로 "즉시" 재생(재생버튼 대기 없음).
//   유튜브ID는 poster_url(i.ytimg.com/vi/<id>/…)에서 공짜로 추출 → Apify 상세조회 불필요.
//
// 실행: google-ads-monitor 폴더에서  node download-local.mjs   (또는 download-videos-local.bat 더블클릭)
// 자격증명: 환경변수 → 이 폴더 .env → ../meta-ad-monitor/.env 순으로 SUPABASE_URL / SUPABASE_SERVICE_KEY 자동 탐색.
// 선택 env: MAX_VIDEOS(이번 실행 최대 영상 수, 0=전체), YT_HEIGHT(최대 해상도, 기본 720),
//          CONCURRENCY(동시 다운로드 수, 기본 6),
//          COOKIES_FROM_BROWSER(chrome|edge|firefox|brave|whale …) 또는 COOKIES_FILE(cookies.txt 경로)
//            → 로그인 쿠키로 유튜브 "봇 확인" 차단을 우회(한 IP로 대량 받을 때 필요).

import { createClient } from '@supabase/supabase-js'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { get } from 'node:https'

const HERE = dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === 'win32'
const YT = join(HERE, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp')
const TMP = join(HERE, '.vidtmp')
const BUCKET = 'google-ad-media'
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS) || 0
const YT_HEIGHT = Number(process.env.YT_HEIGHT) || 720
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6) // 동시 다운로드 수(병렬)
const COOKIES_FROM_BROWSER = (process.env.COOKIES_FROM_BROWSER || '').trim()
// COOKIES_FILE 미지정 시, 이 폴더의 cookies.txt 를 자동 사용(있으면). 파일만 넣어두면 됨.
const COOKIES_FILE = (process.env.COOKIES_FILE || '').trim() || (existsSync(join(HERE, 'cookies.txt')) ? join(HERE, 'cookies.txt') : '')
// 쿠키 인증 옵션(있으면 유튜브 봇확인 우회). 브라우저 쿠키 우선, 없으면 cookies.txt.
const COOKIE_ARGS = COOKIES_FROM_BROWSER ? ['--cookies-from-browser', COOKIES_FROM_BROWSER]
  : COOKIES_FILE ? ['--cookies', COOKIES_FILE] : []
const log = (...a) => console.log('[ga-local]', ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 자격증명 로드(환경변수 → .env → ../meta-ad-monitor/.env) ──
function loadEnvFile(p) {
  try {
    const o = {}
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const s = line.trim(); if (!s || s.startsWith('#')) continue
      const i = s.indexOf('='); if (i < 0) continue
      o[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    }
    return o
  } catch { return {} }
}
let SUPABASE_URL = process.env.SUPABASE_URL
let SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
for (const p of [join(HERE, '.env'), join(HERE, '..', 'meta-ad-monitor', '.env')]) {
  if (SUPABASE_URL && SUPABASE_SERVICE_KEY) break
  if (existsSync(p)) {
    const e = loadEnvFile(p)
    SUPABASE_URL = SUPABASE_URL || e.SUPABASE_URL
    SUPABASE_SERVICE_KEY = SUPABASE_SERVICE_KEY || e.SUPABASE_SERVICE_KEY
  }
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 를 찾을 수 없습니다. (환경변수나 ../meta-ad-monitor/.env 확인)')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// ── yt-dlp.exe 없으면 자동 다운로드 ──
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const go = (u) => get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return go(res.headers.location) }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
    go(url)
  })
}
async function ensureYtdlp() {
  if (existsSync(YT)) return
  const asset = IS_WIN ? 'yt-dlp.exe' : (process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp')
  log(`yt-dlp 없음 → 다운로드 중(${asset})…`)
  await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, YT)
  if (!IS_WIN) { try { const { chmodSync } = await import('node:fs'); chmodSync(YT, 0o755) } catch {} }
  log('yt-dlp 준비 완료')
}

const idFrom = (u) => {
  const s = String(u || '')
  return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1]
    || s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1]
    || s.match(/shorts\/([\w-]{6,})/)?.[1] || s.match(/embed\/([\w-]{6,})/)?.[1] || null
}

// 아직 안 받은 영상 광고 로드 → 유튜브ID별로 library_id 묶기.
async function loadPending() {
  const byId = new Map()
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads').select('library_id, media_url, poster_url, video_src_url')
      .eq('media_type', 'video').eq('downloaded', false)
      .range(off, off + 999)
    if (error) { log('로드 오류', error.message); break }
    if (!data || !data.length) break
    for (const r of data) {
      const id = idFrom(r.poster_url) || idFrom(r.media_url) || idFrom(r.video_src_url)
      if (!id) continue
      if (!byId.has(id)) byId.set(id, [])
      byId.get(id).push(r.library_id)
    }
    if (data.length < 1000) break
  }
  return byId
}

// yt-dlp 로 영상 1개를 TMP 에 고유파일로 받아 경로 반환(없으면 null). 병렬 안전(공유 TMP 안 지움). ffmpeg 불필요.
function ytdlp(id) {
  return new Promise((resolve) => {
    const out = join(TMP, `${id}.%(ext)s`)
    const fmt = `best[ext=mp4][height<=${YT_HEIGHT}]/best[ext=mp4]/best`
    const args = ['-f', fmt, '--no-playlist', '--no-warnings', '--no-part', ...COOKIE_ARGS, '-o', out, `https://www.youtube.com/watch?v=${id}`]
    const p = spawn(YT, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', () => {
      try {
        const f = readdirSync(TMP).find((n) => n.startsWith(id + '.'))
        if (f) { const full = join(TMP, f); if (statSync(full).size > 0) return resolve(full) }
      } catch {}
      if (err) log(`  yt-dlp 실패(${id}): ${err.split('\n').filter(Boolean).pop()?.slice(0, 140)}`)
      resolve(null)
    })
    p.on('error', (e) => { log('yt-dlp 실행 오류', e.message); resolve(null) })
  })
}

// 영상 1개: 다운로드 → 업로드 → DB 갱신 → 임시파일 삭제.
async function handleOne(id, libraryIds, n, total) {
  let file = null
  for (let a = 0; a < 2 && !file; a++) {
    if (a) await sleep(1500) // 403(throttle) 등 일시 실패 시 1회 재시도
    file = await ytdlp(id)
  }
  if (!file) { console.log(`[ga-local] (${n}/${total}) ${id} 실패`); return false }
  try {
    const buf = readFileSync(file)
    if (buf.length > 300 * 1024 * 1024) { console.log(`[ga-local] (${n}/${total}) ${id} 너무 큼(스킵)`); return false }
    const path = `youtube/${id}.mp4`
    const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (up.error) { console.log(`[ga-local] (${n}/${total}) ${id} 업로드 실패:`, up.error.message); return false }
    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    await sb.from('ga_ads').update({ media_url: publicUrl, downloaded: true, media_path: path }).in('library_id', libraryIds)
    console.log(`[ga-local] (${n}/${total}) ${id} 저장 (${(buf.length / 1024 / 1024).toFixed(1)}MB, 광고 ${libraryIds.length}건)`)
    return true
  } catch (e) {
    console.log(`[ga-local] (${n}/${total}) ${id} 오류:`, String(e.message || e).slice(0, 120)); return false
  } finally {
    try { rmSync(file, { force: true }) } catch {}
  }
}

async function main() {
  await ensureYtdlp()
  try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  mkdirSync(TMP, { recursive: true })
  const byId = await loadPending()
  let ids = [...byId.keys()]
  if (MAX_VIDEOS > 0) ids = ids.slice(0, MAX_VIDEOS)
  const cookieMode = COOKIES_FROM_BROWSER ? `브라우저쿠키(${COOKIES_FROM_BROWSER})` : COOKIES_FILE ? 'cookies.txt' : '쿠키없음'
  log(`받을 고유 영상 ${byId.size}개 중 이번 처리 ${ids.length}개 (동시 ${CONCURRENCY}개, 최대 ${YT_HEIGHT}p, ${cookieMode})`)
  if (!ids.length) { log('받을 영상이 없습니다.'); return }

  let done = 0, fail = 0, idx = 0
  const worker = async () => {
    while (idx < ids.length) {
      const i = idx++
      const id = ids[i]
      const ok = await handleOne(id, byId.get(id), i + 1, ids.length)
      if (ok) done++; else fail++
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))

  try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  log(`완료: 성공 ${done} / 실패 ${fail} / 대상 ${ids.length}. (실패분은 다시 실행하면 이어받음)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
