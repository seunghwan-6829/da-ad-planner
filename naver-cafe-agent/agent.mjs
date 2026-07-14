// 네이버 카페 발행 에이전트 v3 — 내 PC에서 실행(publish-agent.bat).
//   리뉴얼 계약: 에이전트는 "손"만. 서버가 페이스(계정 밴 방지) 게이트를 걸어 발행 허용 여부를 판정한다.
//   - GET  {SERVER}/api/naver-cafe/agent/next   → {none,reason} | {job}  (승인+페이스 통과 시에만 job)
//   - POST {SERVER}/api/naver-cafe/agent/result → 발행 결과 보고(성공/실패)
//   - POST {SERVER}/api/naver-cafe/agent        → 하트비트(온라인 표시)
//   - GET/POST {SERVER}/api/naver-cafe/agent/track → 24h 반응 측정 큐/결과
//   로그인된 웨일 브라우저 프로필(playwright-core)로 사람처럼 실제 타이핑해 등록/댓글.
//   ⚠️ service_role 키가 필요 없다(서버 URL + AGENT 토큰만). 창을 닫으면 자동 발행이 멈춘다.

import { chromium } from 'playwright-core'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOGS = join(HERE, 'logs')
mkdirSync(LOGS, { recursive: true })
const log = (...a) => console.log(`[cafe-agent ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}]`, ...a)

// ── 설정(.env → ../meta-ad-monitor/.env) ──
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
let SERVER = process.env.CC_SERVER_URL
let TOKEN = process.env.NC_AGENT_TOKEN
let POLL_SEC = process.env.CC_POLL_SEC
for (const p of [join(HERE, '.env'), join(HERE, '..', 'meta-ad-monitor', '.env')]) {
  if (SERVER && TOKEN) break
  if (existsSync(p)) { const e = loadEnvFile(p); SERVER ||= e.CC_SERVER_URL; TOKEN ||= e.NC_AGENT_TOKEN; POLL_SEC ||= e.CC_POLL_SEC }
}
SERVER = (SERVER || 'https://da-ad-planner.vercel.app').replace(/\/+$/, '')
TOKEN = TOKEN || ''
const POLL = Math.max(5, Number(POLL_SEC) || 20) * 1000

async function http(path, method, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (TOKEN) headers['x-agent-token'] = TOKEN
  const r = await fetch(SERVER + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
  return j
}

// ── 브라우저: 웨일 실행파일 + 로그인된 프로필 ──
const WHALE = [
  process.env.WHALE_PATH,
  'C:\\Program Files\\Naver\\Naver Whale\\Application\\whale.exe',
  'C:\\Program Files (x86)\\Naver\\Naver Whale\\Application\\whale.exe',
  join(process.env.LOCALAPPDATA || '', 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
].filter(Boolean).find((p) => existsSync(p))
// 네이버 로그인 세션 프로필(신규/구 폴더 모두 탐색 — 평소 쓰는 웨일 창과 충돌 없음)
const PROFILE_CANDIDATES = [
  process.env.NC_PROFILE_DIR,
  resolve(HERE, '..', '네이버카페 자동화_신규버전', '.whale-profile'),
  resolve(HERE, '..', '네이버 카페 자동화', '.whale-profile'),
].filter(Boolean)
const PROFILE_DIR = PROFILE_CANDIDATES.find((p) => existsSync(p)) || PROFILE_CANDIDATES[PROFILE_CANDIDATES.length - 1]

let context = null
async function getPage() {
  if (context) { try { return context.pages()[0] || (await context.newPage()) } catch { context = null } }
  if (!WHALE) throw new Error('웨일 브라우저(whale.exe)를 찾을 수 없어요. WHALE_PATH 환경변수로 지정해 주세요.')
  if (!existsSync(PROFILE_DIR)) throw new Error(`브라우저 프로필이 없어요: ${PROFILE_DIR}`)
  log('브라우저 실행(웨일 + 로그인 프로필)…')
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: WHALE,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
  context.on('close', () => { context = null })
  return context.pages()[0] || (await context.newPage())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function humanType(page, text) {
  for (const ch of String(text)) {
    await page.keyboard.type(ch, { delay: 0 })
    await sleep(25 + Math.random() * 65)
    if (ch === ' ' && Math.random() < 0.12) await sleep(200 + Math.random() * 400)
  }
}

// 로그인 세션 만료 감지
function assertLoggedIn(page) {
  if (page.url().includes('nid.naver.com')) {
    throw new Error('네이버 로그인 세션이 만료됐어요. 열린 브라우저 창에서 로그인한 뒤 이 글을 다시 승인해 주세요.')
  }
}

// ── 글 등록(job.kind==='post') ──
async function publishPost(job) {
  const page = await getPage()
  const cafeUrl = job.cafe?.url || ''
  // clubId/menuId: job 값 우선 → URL 파싱 폴백
  const direct = cafeUrl.match(/cafe\.naver\.com\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)(?:\/menus\/(\d+))?/i)
  let clubId = job.cafe?.club_id || direct?.[1] || null
  const menuId = job.board_id || direct?.[2] || null
  if (!clubId) {
    const slug = cafeUrl.match(/cafe\.naver\.com\/([^/?#]+)/i)?.[1]
    if (!slug) throw new Error(`카페 URL 형식이 이상해요: ${cafeUrl}`)
    await page.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    assertLoggedIn(page)
    clubId = (await page.content()).match(/g_sClubId\s*=\s*["'](\d+)["']/)?.[1] || null
    if (!clubId) throw new Error('카페 ID를 찾지 못했어요(미가입이거나 페이지 구조 변경).')
  }

  await page.goto(`https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/write?boardType=L${menuId ? `&menuId=${menuId}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  assertLoggedIn(page)
  await sleep(2500)

  // 임시저장 복원 팝업 → 취소(새 글)
  try { const c = page.locator('button:has-text("취소")').first(); if (await c.isVisible({ timeout: 1500 })) await c.click() } catch {}

  // 게시판 선택(menuId 없을 때만 이름으로)
  const boardName = job.board?.name || ''
  if (boardName && !menuId) {
    try {
      await page.locator('.FormSelectButton button, button.button_select, [class*="select_board"] button').first().click({ timeout: 4000 })
      await page.locator(`li:has-text("${boardName}"), [role="option"]:has-text("${boardName}")`).first().click({ timeout: 4000 })
    } catch { log(`  ⚠️ 게시판 "${boardName}" 자동선택 실패 → 기본 게시판 진행`) }
  }

  // 말머리(선택) — best-effort
  if (job.prefix) {
    try {
      await page.locator('button:has-text("말머리"), [class*="prefix"] button, [class*="Prefix"] button').first().click({ timeout: 2500 })
      await page.locator(`li:has-text("${job.prefix}"), [role="option"]:has-text("${job.prefix}")`).first().click({ timeout: 2500 })
    } catch {}
  }

  // 제목
  await page.locator('textarea[placeholder*="제목"], .textarea_input').first().click({ timeout: 8000 })
  await humanType(page, job.title)

  // 본문
  await page.locator('.se-component-content [contenteditable="true"], .se-content [contenteditable="true"], [contenteditable="true"]').first().click({ timeout: 8000 })
  const lines = String(job.body || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await humanType(page, lines[i])
    if (i < lines.length - 1) { await page.keyboard.press('Enter'); await sleep(120 + Math.random() * 240) }
  }
  await sleep(500)

  // 등록
  await page.locator('a:has-text("등록"), button:has-text("등록")').first().click({ timeout: 8000 })
  await page.waitForURL((u) => /articles\/\d+|articleid=\d+|ArticleRead/i.test(String(u)), { timeout: 20000 })
  return page.url()
}

// ── 댓글 등록(job.kind==='comment') — best-effort DOM ──
async function publishComment(job) {
  if (!job.source_url) throw new Error('댓글 대상 원글 URL이 없어요.')
  const page = await getPage()
  await page.goto(job.source_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  assertLoggedIn(page)
  await sleep(2500)
  // 댓글 입력창(카페 구조에 따라 iframe 안일 수 있음 — 프레임까지 탐색)
  const targets = [page, ...page.frames()]
  let typed = false
  for (const t of targets) {
    try {
      const box = t.locator('textarea.comment_inbox_text, textarea[placeholder*="댓글"], .comment_inbox textarea, [class*="CommentWrite"] textarea').first()
      if (await box.isVisible({ timeout: 2000 })) {
        await box.click()
        await humanType(page, job.body)
        typed = true
        // 등록 버튼
        try { await t.locator('a.button_comment, button:has-text("등록"), a:has-text("등록")').first().click({ timeout: 4000 }) } catch {}
        break
      }
    } catch {}
  }
  if (!typed) throw new Error('댓글 입력창을 찾지 못했어요(페이지 구조 변경).')
  await sleep(1500)
  return null // 댓글은 별도 URL/24h 추적 없음
}

// ── 하트비트 ──
async function heartbeat() { try { await http('/api/naver-cafe/agent', 'POST', { info: 'pc-agent' }) } catch {} }

// 결과 보고(작은 호출). 실패 시 백오프 재시도. ★확정된 발행 성공을 절대 실패로 낮추지 않기 위해 분리.
async function reportResult(payload) {
  for (let i = 0; i < 5; i++) {
    try { await http('/api/naver-cafe/agent/result', 'POST', payload); return true }
    catch (e) { log(`결과 보고 재시도(${i + 1}/5): ${String((e && e.message) || e).slice(0, 80)}`); await sleep(3000 * (i + 1)) }
  }
  return false
}

// ── 발행 틱: 서버가 넘겨준 job 하나 처리 ──
let idleReason = ''
async function publishTick() {
  let res
  try { res = await http('/api/naver-cafe/agent/next', 'GET') } catch (e) { log('next 조회 실패:', String(e.message || e).slice(0, 120)); return }
  if (res.none || !res.job) {
    if (res.reason && res.reason !== idleReason) { log(`대기: ${res.reason}`); idleReason = res.reason }
    return
  }
  idleReason = ''
  const job = res.job
  log(`발행 시작: [${job.cafe?.name}] (${job.kind}) ${job.title || job.source_url || ''}`)

  // 1) 발행 시도 — 여기서 던지면 '진짜 미발행 실패'. 실패 보고 → 서버가 재시도용으로 approved 복귀(+간격 예약).
  let url
  try {
    url = job.kind === 'comment' ? await publishComment(job) : await publishPost(job)
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300)
    log(`❌ 발행 실패: ${msg}`)
    try { const p = context?.pages()[0]; if (p) await p.screenshot({ path: join(LOGS, `${job.id}.png`), fullPage: false }) } catch {}
    await reportResult({ id: job.id, ok: false, kind: job.kind, cafe_id: job.cafe_id, note: msg })
    return
  }

  // 2) 발행 확정됨 — 성공 보고는 재시도만 하고 절대 실패로 낮추지 않는다(이중발행 방지).
  const ok = await reportResult({ id: job.id, ok: true, kind: job.kind, cafe_id: job.cafe_id, published_url: url || undefined })
  if (ok) log(`✅ 발행 완료${url ? `: ${url}` : ''}`)
  else log(`⚠️ 발행은 됐지만 결과 보고 실패 — 서버에 '발행 중'으로 남습니다. 웹에서 확인 후 처리하세요(중복 발행 방지).`)
}

// ── 24h 반응 측정: 서버가 준 대기 목록을 로그인 브라우저로 방문해 수집 ──
async function trackReactions() {
  let due
  try { due = await http('/api/naver-cafe/agent/track', 'GET') } catch { return }
  if (!Array.isArray(due) || !due.length) return
  const page = await getPage()
  for (const post of due) {
    try {
      log(`반응 측정: ${post.title}`)
      await page.goto(post.published_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(2500)
      let text = ''
      try { for (const f of page.frames()) { try { text += ' ' + (await f.evaluate(() => document.body?.innerText || '')) } catch {} } }
      catch { text = await page.evaluate(() => document.body?.innerText || '') }
      const num = (re) => { const m = text.match(re); return m ? Number(String(m[1]).replace(/,/g, '')) : null }
      const views = num(/조회\s*([\d,]+)/)
      const comments = num(/댓글\s*([\d,]+)/)
      const likes = num(/(?:좋아요|공감)\s*([\d,]+)/)
      await http('/api/naver-cafe/agent/track', 'POST', { id: post.id, views, likes, comments })
      log(`  → 조회 ${views ?? '?'} · 좋아요 ${likes ?? '?'} · 댓글 ${comments ?? '?'}`)
      await sleep(1500 + Math.random() * 2000)
    } catch (e) { log(`  반응 측정 실패(다음 틱 재시도): ${String((e && e.message) || e).slice(0, 100)}`) }
  }
}

log('네이버 카페 발행 에이전트 v3 시작')
log(`  서버: ${SERVER}`)
log(`  인증 토큰: ${TOKEN ? '설정됨' : '(없음 — 서버가 NC_AGENT_TOKEN 미설정 시에만 동작)'}`)
log(`  프로필: ${PROFILE_DIR}`)
log(`  브라우저: ${WHALE || '(웨일 못 찾음 — 발행 시 오류로 안내)'}`)
log(`  승인된 글을 ${POLL / 1000}초 간격으로 확인합니다(페이스 규칙은 서버가 판정). 이 창을 닫으면 멈춥니다.`)
await heartbeat()
setInterval(heartbeat, 30_000)
for (;;) {
  try { await publishTick() } catch (e) { log('루프 오류:', String((e && e.message) || e).slice(0, 200)) }
  try { await trackReactions() } catch (e) { log('추적 오류:', String((e && e.message) || e).slice(0, 200)) }
  await sleep(POLL)
}
