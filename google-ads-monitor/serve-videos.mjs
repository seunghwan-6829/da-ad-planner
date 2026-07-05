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
    // 같은 영상 쓰는 모든 광고 갱신(poster 또는 media_url 에 id 포함)
    try { await sb.from('ga_ads').update({ media_url: publicUrl, downloaded: true, media_path: path }).or(`poster_url.ilike.%${id}%,media_url.ilike.%${id}%`) } catch {}
    return publicUrl
  })()
  inflight.set(id, job)
  try { return await job } finally { inflight.delete(id) }
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
      try { const url = await getOrDownload(id); return cors(res, 200, { url }) }
      catch (e) { return cors(res, 502, { error: String(e.message || e).slice(0, 160) }) }
    }
    return cors(res, 404, { error: 'not found' })
  } catch (e) { return cors(res, 500, { error: String(e.message || e).slice(0, 160) }) }
}).listen(PORT, '127.0.0.1', () => {
  log(`로컬 영상 서버 실행 중 → http://127.0.0.1:${PORT}  (쿠키 ${COOKIES_FILE ? '있음' : '없음'})`)
  log('이 창을 열어두면 페이지에서 재생 버튼이 빠르게(~5초) 동작합니다. 닫으면 Apify 폴백.')
})
