// 온디맨드 로컬 영상 서버 — 재생 버튼 누르면 "내 PC(가정용 IP)"에서 그 영상만 즉시 받아 Supabase 저장 후 URL 반환.
//   Vercel+Apify(콜드스타트 20~60초) 대신 내 PC에서 yt-dlp(쿠키+deno)로 ~5초. 완전 무료.
//   브라우저(HTTPS 페이지)가 http://127.0.0.1:PORT/get?id=<유튜브ID> 로 요청 → 다운로드→업로드→ {url} 반환.
//   ⚠️ localhost 전용(외부 접근 불가). Chrome PNA(Private Network Access) 프리플라이트 헤더 포함.
//
// 실행: google-ads-monitor 폴더에서  node serve-videos.mjs   (또는 serve-videos.bat)
// 필요: cookies.txt(대량 다운로드와 동일), yt-dlp.exe/deno.exe(없으면 자동설치), ../meta-ad-monitor/.env

import { createClient } from '@supabase/supabase-js'
import { createServer } from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, createWriteStream, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { get } from 'node:https'

const HERE = dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === 'win32'
const YT = join(HERE, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp')
const DENO = join(HERE, IS_WIN ? 'deno.exe' : 'deno')
const TMP = join(HERE, '.servetmp')
const CHILD_ENV = { ...process.env, PATH: HERE + (IS_WIN ? ';' : ':') + (process.env.PATH || '') }
const BUCKET = 'google-ad-media'
const OM_BUCKET = 'owned-media' // 온드미디어(인스타 릴스) 저장 버킷
const PORT = Number(process.env.PORT) || 47615
const YT_HEIGHT = Number(process.env.YT_HEIGHT) || 720
const log = (...a) => console.log('[ga-serve]', ...a)

// ── 자격증명 ──
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
  if (existsSync(p)) { const e = loadEnvFile(p); SUPABASE_URL = SUPABASE_URL || e.SUPABASE_URL; SUPABASE_SERVICE_KEY = SUPABASE_SERVICE_KEY || e.SUPABASE_SERVICE_KEY }
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 를 찾을 수 없습니다.'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const COOKIES_FILE = (process.env.COOKIES_FILE || '').trim() || (existsSync(join(HERE, 'cookies.txt')) ? join(HERE, 'cookies.txt') : '')

// ── yt-dlp / deno 자동설치 ──
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const go = (u) => get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { res.resume(); return go(res.headers.location) }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)) }
      res.pipe(file); file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
    go(url)
  })
}
async function ensureBins() {
  if (!existsSync(YT)) {
    const asset = IS_WIN ? 'yt-dlp.exe' : (process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp')
    log(`yt-dlp 설치 중(${asset})…`); await download(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`, YT)
    if (!IS_WIN) { try { const { chmodSync } = await import('node:fs'); chmodSync(YT, 0o755) } catch {} }
  }
  if (!existsSync(DENO) && IS_WIN) {
    log('deno 설치 중…'); const zip = join(HERE, 'deno.zip')
    try { await download('https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip', zip); spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${HERE}" -Force`], { stdio: 'ignore' }) } catch {}
    try { rmSync(zip, { force: true }) } catch {}
  }
}

const validId = (id) => /^[\w-]{6,20}$/.test(id || '')

// yt-dlp 로 영상 1개 받기 → 파일경로(없으면 null).
function ytdlp(id) {
  return new Promise((resolve) => {
    const out = join(TMP, `${id}.%(ext)s`)
    const fmt = `best[ext=mp4][height<=${YT_HEIGHT}]/best[ext=mp4]/best`
    let cArgs = [], cookieTmp = null
    if (COOKIES_FILE) { cookieTmp = join(TMP, `${id}.cookies.txt`); try { copyFileSync(COOKIES_FILE, cookieTmp); cArgs = ['--cookies', cookieTmp] } catch {} }
    const args = ['-f', fmt, '--no-playlist', '--no-warnings', '--no-part', ...cArgs, '-o', out, `https://www.youtube.com/watch?v=${id}`]
    const p = spawn(YT, args, { stdio: ['ignore', 'ignore', 'pipe'], env: CHILD_ENV })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', () => {
      try { if (cookieTmp) rmSync(cookieTmp, { force: true }) } catch {}
      try { const f = readdirSync(TMP).find((n) => n.startsWith(id + '.') && !n.endsWith('.cookies.txt')); if (f) { const full = join(TMP, f); if (statSync(full).size > 0) return resolve(full) } } catch {}
      resolve(null)
    })
    p.on('error', () => resolve(null))
  })
}

// yt-dlp -g 로 "직접 스트림 URL"만 빠르게 추출(다운로드 X, ~2초). 실패 시 { url: null, err: 원인 }.
//   브라우저가 로컬서버와 같은 IP라 이 URL(IP잠금)을 그대로 재생 가능 → 다운로드/업로드 대기 없음.
function ytdlpGetUrl(id) {
  return new Promise((resolve) => {
    const fmt = `best[ext=mp4][height<=${YT_HEIGHT}]/best[ext=mp4]/best`
    let cArgs = [], cookieTmp = null
    if (COOKIES_FILE) { cookieTmp = join(TMP, `${id}.g.cookies.txt`); try { copyFileSync(COOKIES_FILE, cookieTmp); cArgs = ['--cookies', cookieTmp] } catch {} }
    const args = ['-g', '-f', fmt, '--no-playlist', '--no-warnings', ...cArgs, `https://www.youtube.com/watch?v=${id}`]
    const p = spawn(YT, args, { stdio: ['ignore', 'pipe', 'pipe'], env: CHILD_ENV })
    let out = '', err = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', () => {
      try { if (cookieTmp) rmSync(cookieTmp, { force: true }) } catch {}
      resolve({ url: out.split('\n').map((s) => s.trim()).find((s) => s.startsWith('http')) || null, err })
    })
    p.on('error', (e) => resolve({ url: null, err: String((e && e.message) || e) }))
  })
}

// 영구실패(다시 시도해도 소용없음): 삭제/비공개/지역차단 등. download-local.mjs 와 동일 판정.
const isPermanentFail = (err) => /removed for violating|not available on this country|Video unavailable\. This content is|Private video|no longer available|account (associated|has been) |members-only|Sign in to confirm your age/i.test(err || '')

// 빠른 경로: 이미 저장돼 있으면 그 URL, 아니면 직접 스트림 URL을 즉시 반환(+백그라운드로 Supabase 영구저장).
// 구글 광고(ga_ads)와 온드미디어(om_posts, post_id='yt_<id>') 양쪽에서 조회/갱신.
async function resolveFast(id) {
  try {
    const { data } = await sb.from('ga_ads').select('media_url').ilike('poster_url', `%${id}%`).eq('downloaded', true).limit(1)
    if (data?.[0]?.media_url) return data[0].media_url
  } catch {}
  try {
    const { data } = await sb.from('om_posts').select('media_url').eq('post_id', `yt_${id}`).limit(1)
    const u = data?.[0]?.media_url
    if (u && /\/storage\/v1\/object\//.test(u)) return u // 이미 스토리지에 저장된 쇼츠
  } catch {}
  const { url: direct, err } = await ytdlpGetUrl(id)
  if (!direct) {
    if (isPermanentFail(err)) {
      // 원본이 유튜브에서 내려간 영상 → 'dead' 표시(일일 다운로더와 동일 컨벤션)해 다음부터 시도 안 함.
      try { await sb.from('ga_ads').update({ media_path: 'dead' }).or(`poster_url.ilike.%${id}%,media_url.ilike.%${id}%`) } catch {}
      const e = new Error('원본 영상이 유튜브에서 삭제/차단돼 재생할 수 없어요.')
      e.dead = true
      throw e
    }
    throw new Error('영상 URL 추출 실패(일시 오류 또는 쿠키 만료) — 다시 시도해 주세요')
  }
  getOrDownload(id).catch(() => {}) // 백그라운드 영구저장(재생엔 영향 없음, inflight 로 중복 방지)
  return direct
}

// 이미 받은 영상이면 그 URL, 아니면 받아서 저장 후 URL.
const inflight = new Map() // id → Promise (동시 중복요청 합치기)
async function getOrDownload(id) {
  // 이미 스토리지에 있으면 즉시 반환
  const path = `youtube/${id}.mp4`
  try {
    const { data } = await sb.from('ga_ads').select('media_url').ilike('poster_url', `%${id}%`).eq('downloaded', true).limit(1)
    if (data?.[0]?.media_url) return data[0].media_url
  } catch {}
  if (inflight.has(id)) return inflight.get(id)
  const job = (async () => {
    const file = await ytdlp(id)
    if (!file) throw new Error('다운로드 실패(삭제/차단 영상이거나 쿠키 만료)')
    const buf = readFileSync(file)
    try { rmSync(file, { force: true }) } catch {}
    if (!buf.length || buf.length > 300 * 1024 * 1024) throw new Error('파일 크기 이상')
    const up = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (up.error) throw new Error(up.error.message)
    const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
    // 같은 영상 쓰는 모든 광고 갱신(poster 또는 media_url 에 id 포함) + 온드미디어 쇼츠(post_id 일치)도 갱신
    try { await sb.from('ga_ads').update({ media_url: publicUrl, downloaded: true, media_path: path }).or(`poster_url.ilike.%${id}%,media_url.ilike.%${id}%`) } catch {}
    try { await sb.from('om_posts').update({ media_url: publicUrl }).eq('post_id', `yt_${id}`) } catch {}
    return publicUrl
  })()
  inflight.set(id, job)
  try { return await job } finally { inflight.delete(id) }
}

// ─────────────────────────── 인스타 릴스(온드미디어) ───────────────────────────
// 임베드 iframe 은 타임라인 바가 없어 탐색 불가 → residential IP(내 PC) yt-dlp 로 원본 mp4 URL 을
// 뽑아 페이지가 네이티브 <video controls> 로 재생(타임라인 O). Vercel/데이터센터 IP 는 인스타가 차단.
const igValidCode = (c) => /^[\w-]+$/.test(c || '')

// yt-dlp -g 로 릴스 직접 스트림 URL(다운로드 X, 빠름). 없으면 null.
function ytdlpGetUrlUrl(pageUrl, tag) {
  return new Promise((resolve) => {
    let cArgs = [], cookieTmp = null
    if (COOKIES_FILE) { cookieTmp = join(TMP, `${tag}.g.cookies.txt`); try { copyFileSync(COOKIES_FILE, cookieTmp); cArgs = ['--cookies', cookieTmp] } catch {} }
    const args = ['-g', '-f', 'best[ext=mp4]/best', '--no-playlist', '--no-warnings', ...cArgs, pageUrl]
    const p = spawn(YT, args, { stdio: ['ignore', 'pipe', 'ignore'], env: CHILD_ENV })
    let out = ''
    p.stdout.on('data', (d) => { out += d.toString() })
    p.on('close', () => {
      try { if (cookieTmp) rmSync(cookieTmp, { force: true }) } catch {}
      resolve(out.split('\n').map((s) => s.trim()).find((s) => s.startsWith('http')) || null)
    })
    p.on('error', () => resolve(null))
  })
}

// 릴스 1개 다운로드 → 파일경로(없으면 null).
function ytdlpDownloadUrl(pageUrl, base) {
  return new Promise((resolve) => {
    const out = join(TMP, `${base}.%(ext)s`)
    let cArgs = [], cookieTmp = null
    if (COOKIES_FILE) { cookieTmp = join(TMP, `${base}.cookies.txt`); try { copyFileSync(COOKIES_FILE, cookieTmp); cArgs = ['--cookies', cookieTmp] } catch {} }
    const args = ['-f', 'best[ext=mp4]/best', '--no-playlist', '--no-warnings', '--no-part', ...cArgs, '-o', out, pageUrl]
    const p = spawn(YT, args, { stdio: ['ignore', 'ignore', 'ignore'], env: CHILD_ENV })
    p.on('close', () => {
      try { if (cookieTmp) rmSync(cookieTmp, { force: true }) } catch {}
      try { const f = readdirSync(TMP).find((n) => n.startsWith(base + '.') && !n.endsWith('.cookies.txt')); if (f) { const full = join(TMP, f); if (statSync(full).size > 0) return resolve(full) } } catch {}
      resolve(null)
    })
    p.on('error', () => resolve(null))
  })
}

const igInflight = new Map()
async function getOrDownloadIg(code) {
  const path = `reels/${code}.mp4`
  try {
    const { data } = await sb.from('om_posts').select('media_url').eq('post_id', `ig_${code}`).limit(1)
    const u = data?.[0]?.media_url
    if (u && /\/storage\/v1\/object\//.test(u)) return u
  } catch {}
  if (igInflight.has(code)) return igInflight.get(code)
  const job = (async () => {
    const file = await ytdlpDownloadUrl(`https://www.instagram.com/reel/${code}/`, `ig_${code}`)
    if (!file) throw new Error('릴스 다운로드 실패(비공개/삭제이거나 쿠키 만료)')
    const buf = readFileSync(file)
    try { rmSync(file, { force: true }) } catch {}
    if (!buf.length || buf.length > 300 * 1024 * 1024) throw new Error('파일 크기 이상')
    const up = await sb.storage.from(OM_BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (up.error) throw new Error(up.error.message)
    const publicUrl = sb.storage.from(OM_BUCKET).getPublicUrl(path).data.publicUrl
    try { await sb.from('om_posts').update({ media_url: publicUrl }).eq('post_id', `ig_${code}`) } catch {}
    return publicUrl
  })()
  igInflight.set(code, job)
  try { return await job } finally { igInflight.delete(code) }
}

// 빠른 경로: 저장돼 있으면 그 URL, 아니면 직접 스트림 URL 즉시 반환(+백그라운드 영구저장).
async function resolveFastIg(code) {
  try {
    const { data } = await sb.from('om_posts').select('media_url').eq('post_id', `ig_${code}`).limit(1)
    const u = data?.[0]?.media_url
    if (u && /\/storage\/v1\/object\//.test(u)) return u
  } catch {}
  const direct = await ytdlpGetUrlUrl(`https://www.instagram.com/reel/${code}/`, `ig_${code}`)
  if (!direct) throw new Error('릴스 URL 추출 실패(비공개/삭제이거나 쿠키 만료)')
  getOrDownloadIg(code).catch(() => {}) // 백그라운드 영구저장(재생엔 영향 없음)
  return direct
}

function cors(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true', // Chrome PNA
    'Access-Control-Max-Age': '86400',
  })
  res.end(body ? JSON.stringify(body) : '')
}

await ensureBins()
try { rmSync(TMP, { recursive: true, force: true }) } catch {}
mkdirSync(TMP, { recursive: true })

createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return cors(res, 204, null)
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
    if (u.pathname === '/health') return cors(res, 200, { ok: true, cookies: !!COOKIES_FILE })
    if (u.pathname === '/get') {
      const id = u.searchParams.get('id') || ''
      if (!validId(id)) return cors(res, 400, { error: '잘못된 id' })
      try { const url = await resolveFast(id); return cors(res, 200, { url }) }
      catch (e) { return cors(res, 502, { error: String(e.message || e).slice(0, 160), dead: !!e.dead }) }
    }
    if (u.pathname === '/ig') {
      const code = u.searchParams.get('code') || ''
      if (!igValidCode(code)) return cors(res, 400, { error: '잘못된 code' })
      try { const url = await resolveFastIg(code); return cors(res, 200, { url }) }
      catch (e) { return cors(res, 502, { error: String(e.message || e).slice(0, 160) }) }
    }
    return cors(res, 404, { error: 'not found' })
  } catch (e) { return cors(res, 500, { error: String(e.message || e).slice(0, 160) }) }
}).listen(PORT, '127.0.0.1', () => {
  log(`로컬 영상 서버 실행 중 → http://127.0.0.1:${PORT}  (쿠키 ${COOKIES_FILE ? '있음' : '없음'})`)
  log('이 창을 열어두면 페이지에서 재생 버튼이 빠르게(~2초) 동작합니다. 닫으면 안내만(과금 없음).')
})
