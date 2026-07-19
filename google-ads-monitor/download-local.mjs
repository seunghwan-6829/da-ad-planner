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
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, createWriteStream, copyFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { get } from 'node:https'
import { confirmDead, reviveWronglyDead } from './yt-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const IS_WIN = process.platform === 'win32'
const YT = join(HERE, IS_WIN ? 'yt-dlp.exe' : 'yt-dlp')
const DENO = join(HERE, IS_WIN ? 'deno.exe' : 'deno') // 유튜브 nsig(JS 챌린지) 해결용 런타임
const TMP = join(HERE, '.vidtmp')
// yt-dlp 가 이 폴더의 deno 를 찾도록 PATH 앞에 붙임.
const CHILD_ENV = { ...process.env, PATH: HERE + (IS_WIN ? ';' : ':') + (process.env.PATH || '') }
const BUCKET = 'google-ad-media'
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS) || 0
const YT_HEIGHT = Number(process.env.YT_HEIGHT) || 720
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY) || 6) // 동시 다운로드 수(병렬)
const COOKIES_FROM_BROWSER = (process.env.COOKIES_FROM_BROWSER || '').trim()
// COOKIES_FILE 미지정 시, 이 폴더의 cookies.txt 를 자동 사용(있으면). 파일만 넣어두면 됨.
const COOKIES_FILE = (process.env.COOKIES_FILE || '').trim() || (existsSync(join(HERE, 'cookies.txt')) ? join(HERE, 'cookies.txt') : '')
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

// ── deno(JS 런타임) 없으면 자동 설치 ── 유튜브 nsig 챌린지 해결에 필요(쿠키로 봇차단 우회 시 특히).
async function ensureDeno() {
  if (existsSync(DENO)) return
  if (!IS_WIN) { log('⚠️ deno 없음 — https://deno.com 에서 설치하면 유튜브 nsig 해결이 됩니다.'); return }
  log('deno(JS 런타임) 없음 → 다운로드/설치 중…')
  const zip = join(HERE, 'deno.zip')
  try {
    await download('https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip', zip)
    spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Path "${zip}" -DestinationPath "${HERE}" -Force`], { stdio: 'ignore' })
  } catch (e) { log('deno 설치 실패', String(e.message || e).slice(0, 100)) }
  try { rmSync(zip, { force: true }) } catch {}
  if (existsSync(DENO)) log('deno 준비 완료')
  else log('⚠️ deno 설치 실패 — 쿠키 사용 시 일부 영상 포맷을 못 받을 수 있어요.')
}

const idFrom = (u) => {
  const s = String(u || '')
  return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1]
    || s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1]
    || s.match(/shorts\/([\w-]{6,})/)?.[1] || s.match(/embed\/([\w-]{6,})/)?.[1] || null
}

// 아직 안 받은 영상 광고 로드 → 유튜브ID별로 library_id 묶기. (삭제/지역차단 등 영구실패 'dead' 는 제외)
async function loadPending() {
  const byId = new Map()
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads').select('library_id, media_url, poster_url, video_src_url')
      .eq('media_type', 'video').eq('downloaded', false)
      .or('media_path.is.null,media_path.neq.dead')
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

// 쿠키 인자 구성. 병렬 실행 시 yt-dlp 가 쿠키파일을 각자 덮어써 충돌하므로, 다운로드마다 사본을 준다.
function cookieArgsFor(id) {
  if (COOKIES_FILE) {
    const copy = join(TMP, `${id}.cookies.txt`)
    try { copyFileSync(COOKIES_FILE, copy); return { args: ['--cookies', copy], tmp: copy } } catch {}
  } else if (COOKIES_FROM_BROWSER) {
    return { args: ['--cookies-from-browser', COOKIES_FROM_BROWSER], tmp: null }
  }
  return { args: [], tmp: null }
}

// 영구실패로 "의심"되는 패턴. ⚠️ 이것만 보고 dead 로 찍으면 안 된다 — 반드시 confirmDead() 로 유튜브에 확인한다.
//   과거에 `Video unavailable. This content is` 패턴이 유튜브의 일시 오류
//   ("...not available on this app")까지 잡아 1,687건(오탐률 98.9%)을 영구히 죽여놨었다.
const looksPermanent = (err) => /removed for violating|not available on this country|Video unavailable|Private video|no longer available|account (associated|has been) |members-only|Sign in to confirm your age/i.test(err || '')

// yt-dlp 로 영상 1개를 TMP 에 고유파일로 받음. { file, err } 반환. 병렬 안전. ffmpeg 불필요.
function ytdlp(id) {
  return new Promise((resolve) => {
    const out = join(TMP, `${id}.%(ext)s`)
    const fmt = `best[ext=mp4][height<=${YT_HEIGHT}]/best[ext=mp4]/best`
    const { args: cArgs, tmp: cookieTmp } = cookieArgsFor(id)
    const args = ['-f', fmt, '--no-playlist', '--no-warnings', '--no-part', ...cArgs, '-o', out, `https://www.youtube.com/watch?v=${id}`]
    const p = spawn(YT, args, { stdio: ['ignore', 'ignore', 'pipe'], env: CHILD_ENV })
    let err = ''
    p.stderr.on('data', (d) => { err += d.toString() })
    p.on('close', () => {
      try { if (cookieTmp) rmSync(cookieTmp, { force: true }) } catch {} // 쿠키 사본 먼저 정리(영상파일 검색 오탐 방지)
      try {
        const f = readdirSync(TMP).find((n) => n.startsWith(id + '.'))
        if (f) { const full = join(TMP, f); if (statSync(full).size > 0) return resolve({ file: full, err: '' }) }
      } catch {}
      resolve({ file: null, err })
    })
    p.on('error', (e) => resolve({ file: null, err: String(e.message || e) }))
  })
}

// 영상 1개: 다운로드 → 업로드 → DB 갱신 → 임시파일 삭제. 영구실패는 'dead' 로 표시해 다음부터 스킵.
async function handleOne(id, libraryIds, n, total) {
  let file = null, err = ''
  for (let a = 0; a < 2; a++) {
    const r = await ytdlp(id)
    file = r.file; err = r.err
    if (file) break
    if (looksPermanent(err)) break // 영구실패로 보이면 재시도 대신 아래에서 유튜브에 확인
    if (a === 0) await sleep(1500) // 일시 실패 1회 재시도
  }
  if (!file) {
    // 영구실패처럼 보여도 유튜브가 GONE 이라고 확인해줄 때만 dead. (오탐이면 다음 실행에서 다시 시도됨)
    if (looksPermanent(err) && (await confirmDead(id))) {
      try { await sb.from('ga_ads').update({ media_path: 'dead' }).in('library_id', libraryIds) } catch {}
      console.log(`[ga-local] (${n}/${total}) ${id} 삭제/차단 확인 → 스킵표시(dead)`)
    } else {
      console.log(`[ga-local] (${n}/${total}) ${id} 실패(다음에 재시도): ${err.split('\n').filter(Boolean).pop()?.slice(0, 90) || ''}`)
    }
    return false
  }
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
  await ensureDeno()
  try { rmSync(TMP, { recursive: true, force: true }) } catch {}
  mkdirSync(TMP, { recursive: true })
  // 과거에 잘못 dead 로 찍힌 광고 자동 복구(유튜브가 OK 라고 답하는 것만). 오탐이 쌓이지 않게 매 실행 점검.
  if (process.env.GA_SKIP_REVIVE !== '1') {
    try { await reviveWronglyDead(sb, { log }) } catch (e) { log('dead 재검사 건너뜀:', String(e.message || e).slice(0, 80)) }
  }
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
