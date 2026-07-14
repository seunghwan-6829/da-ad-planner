// 쓰레드 수집 워커 — 내 PC에서 실행(collect.bat).
//   서버에 등록된 브랜드/카테고리를 읽어 Threads(공개 검색) + 외부 게시판(css)을 크롤링,
//   스크랩 + 지표(rank/views)를 서버로 밀어넣는다(POST /api/threads/ingest).
//   발행은 서버 크론이 담당(여긴 수집만). 로그인 세션은 .playwright-threads 프로필에 저장.
//   ⚠️ service_role 불필요(서버 URL + TH_AGENT_TOKEN 만). 창을 닫으면 수집이 멈춘다.

import { chromium } from 'playwright-core'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(HERE, 'logs'), { recursive: true })
const log = (...a) => console.log(`[threads-agent ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}]`, ...a)

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
let SERVER = process.env.CC_SERVER_URL || process.env.TH_SERVER_URL
let TOKEN = process.env.TH_AGENT_TOKEN
let INTERVAL_MIN = process.env.TH_COLLECT_INTERVAL_MIN
for (const p of [join(HERE, '.env'), join(HERE, '..', 'meta-ad-monitor', '.env')]) {
  if (SERVER && TOKEN) break
  if (existsSync(p)) { const e = loadEnvFile(p); SERVER ||= e.CC_SERVER_URL || e.TH_SERVER_URL; TOKEN ||= e.TH_AGENT_TOKEN; INTERVAL_MIN ||= e.TH_COLLECT_INTERVAL_MIN }
}
SERVER = (SERVER || 'https://da-ad-planner.vercel.app').replace(/\/+$/, '')
TOKEN = TOKEN || ''
const INTERVAL = Math.max(15, Number(INTERVAL_MIN) || 120) * 60_000

async function httpGet(path) {
  const r = await fetch(SERVER + path)
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}
async function httpPost(path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers['x-agent-token'] = TOKEN
  const r = await fetch(SERVER + path, { method: 'POST', headers, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// ── 브라우저: 설치된 Chrome/Edge 우선(채널), 실패 시 실행파일 경로 후보 ──
const PROFILE_DIR = process.env.TH_PROFILE_DIR || resolve(HERE, '.playwright-threads')
let context = null
async function getContext() {
  if (context) return context
  const opts = { headless: false, viewport: { width: 1280, height: 1000 }, args: ['--disable-blink-features=AutomationControlled'] }
  const tries = [
    () => chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'chrome' }),
    () => chromium.launchPersistentContext(PROFILE_DIR, { ...opts, channel: 'msedge' }),
  ]
  const paths = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean).filter((p) => existsSync(p))
  for (const p of paths) tries.push(() => chromium.launchPersistentContext(PROFILE_DIR, { ...opts, executablePath: p }))
  let lastErr
  for (const t of tries) { try { context = await t(); break } catch (e) { lastErr = e } }
  if (!context) throw new Error(`브라우저 실행 실패(Chrome/Edge 필요): ${String(lastErr?.message || lastErr).slice(0, 120)}`)
  context.on('close', () => { context = null })
  return context
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const keyOf = (src, brand, cat, url) => createHash('sha1').update(`${src}|${brand}|${cat}|${url}`).digest('hex').slice(0, 16)

// ── Threads 공개 검색 수집 ──
async function crawlThreads(page, keyword, url) {
  const target = url || `https://www.threads.com/search?q=${encodeURIComponent(keyword)}&serp_type=tags`
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45000 })
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 3000); await sleep(1200) }
  const items = await page.evaluate(() => {
    const seen = new Set(); const out = []
    document.querySelectorAll('a[href*="/post/"]').forEach((a) => {
      const url = a.href
      if (!/\/@?[^/]+\/post\//.test(url) || seen.has(url)) return
      seen.add(url)
      const m = url.match(/\/@?([^/]+)\/post\//); const author = m ? m[1] : ''
      let el = a, text = ''
      for (let i = 0; i < 6 && el; i++) { el = el.parentElement; if (el && el.innerText && el.innerText.length > text.length) text = el.innerText }
      out.push({ url, author, text: (text || '').replace(/\s+/g, ' ').trim().slice(0, 300) })
    })
    return out.slice(0, 40)
  })
  return items.map((it, i) => ({ ...it, rank: i + 1 }))
}

// ── 외부 게시판(css) 수집 — 범용 테이블 파싱(dcinside 등) ──
async function crawlCss(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(1500)
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('tr.ub-content, .gall_list tbody tr, table tbody tr')]
    const num = (r, sel) => { const e = r.querySelector(sel); return e ? Number((e.textContent || '').replace(/[^0-9]/g, '')) || null : null }
    return rows.map((r) => {
      const a = r.querySelector('.gall_tit a, td.gall_tit a, .title a, a.gall_tit')
      if (!a || !a.href) return null
      return { title: (a.textContent || '').trim().slice(0, 200), url: a.href, views: num(r, '.gall_count, .count'), likes: num(r, '.gall_recommend, .recommend'), comments: null }
    }).filter(Boolean).slice(0, 40)
  })
}

async function collectOnce() {
  const brands = await httpGet('/api/threads/brands')
  const active = (brands || []).filter((b) => b.enabled !== false)
  if (!active.length) { log('활성 브랜드 없음'); return }
  const ctx = await getContext()
  const page = ctx.pages()[0] || (await ctx.newPage())

  for (const brand of active) {
    let cats = []
    try { cats = await httpGet(`/api/threads/categories?brand_id=${brand.id}`) } catch { continue }
    for (const cat of cats) {
      try {
        const scraps = []; const metrics = []
        if (cat.type === 'css') {
          if (!cat.url) continue
          const rows = await crawlCss(page, cat.url)
          for (const it of rows) {
            const key = keyOf('css', brand.id, cat.id, it.url)
            scraps.push({ key, brand_id: brand.id, category_id: cat.id, source_type: 'css', title: it.title, url: it.url, author: '' })
            metrics.push({ scrap_key: key, views: it.views, likes: it.likes, comments: it.comments })
          }
        } else {
          const rows = await crawlThreads(page, cat.keyword, cat.url)
          for (const it of rows) {
            const key = keyOf('threads', brand.id, cat.id, it.url)
            scraps.push({ key, brand_id: brand.id, category_id: cat.id, source_type: 'threads_topic', title: it.text, url: it.url, author: it.author })
            metrics.push({ scrap_key: key, rank: it.rank })
          }
        }
        if (scraps.length) {
          const res = await httpPost('/api/threads/ingest', { scraps, metrics })
          log(`[${brand.name}/${cat.name}] 수집 ${scraps.length} (신규 ${res.new_scraps ?? '?'})`)
        } else {
          log(`[${brand.name}/${cat.name}] 수집 0(구조 변경/비로그인 제한 가능)`)
        }
        await sleep(2000 + Math.random() * 2000)
      } catch (e) {
        log(`[${brand.name}/${cat.name}] 수집 오류: ${String(e.message || e).slice(0, 120)}`)
      }
    }
  }
}

async function heartbeat() { try { await httpPost('/api/threads/agent', { info: 'collector' }) } catch {} }

log('쓰레드 수집 워커 시작')
log(`  서버: ${SERVER}`)
log(`  인증 토큰: ${TOKEN ? '설정됨' : '(없음 — 서버 TH_AGENT_TOKEN 미설정 시에만 동작)'}`)
log(`  프로필: ${PROFILE_DIR}`)
log(`  수집 주기: ${INTERVAL / 60000}분. 첫 로그인이 필요하면 열린 창에서 Threads 로그인 후 유지됩니다.`)
await heartbeat()
setInterval(heartbeat, 60_000)
for (;;) {
  try { await collectOnce() } catch (e) { log('수집 루프 오류:', String(e.message || e).slice(0, 200)) }
  log(`다음 수집까지 ${INTERVAL / 60000}분 대기…`)
  await sleep(INTERVAL)
}
