// 네이버 카페 발행 에이전트 v3 — 내 PC에서 실행(publish-agent.bat).
//   리뉴얼 계약: 에이전트는 "손"만. 서버가 페이스(계정 밴 방지) 게이트를 걸어 발행 허용 여부를 판정한다.
//   - GET  {SERVER}/api/naver-cafe/agent/next   → {none,reason} | {job}  (승인+페이스 통과 시에만 job)
//   - POST {SERVER}/api/naver-cafe/agent/result → 발행 결과 보고(성공/실패)
//   - POST {SERVER}/api/naver-cafe/agent        → 하트비트(온라인 표시)
//   - GET/POST {SERVER}/api/naver-cafe/agent/track → 24h 반응 측정 큐/결과
//   로그인된 웨일 브라우저 프로필(playwright-core)로 사람처럼 실제 타이핑해 등록/댓글.
//   ⚠️ service_role 키가 필요 없다(서버 URL + AGENT 토큰만). 창을 닫으면 자동 발행이 멈춘다.
//
// 실행 모드
//   node agent.mjs           발행 루프(기본). = publish-agent.bat
//   node agent.mjs --login   네이버 로그인 세션 만들기(최초 1회). = login-setup.bat
//   node agent.mjs --check   자가검사 — 로그인/카페접근/글쓰기 화면 요소를 점검만 하고 절대 등록하지 않음. = self-check.bat
//   node agent.mjs --dry-run 모의발행 — 브라우저도 안 열고, DB도 안 바꾸고, "지금 발행하면 무엇이 어디로
//                            나가는지"만 계산해 보여준다. 네이버 로그인 전에도 확인 가능. = dry-run.bat

import { chromium } from 'playwright-core'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const ARGS = process.argv.slice(2)
const MODE = ARGS.includes('--login')
  ? 'login'
  : ARGS.includes('--check')
    ? 'check'
    : ARGS.includes('--dry-run')
      ? 'dry'
      : 'run'

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

/* ── 브라우저 선택 ──
   ⚠️ 실측(2026-07-21): 네이버 웨일은 "단일 인스턴스"라, 평소 쓰는 웨일 창이 하나라도 열려 있으면
      --user-data-dir 을 따로 줘도 새 프로세스가 기존 창에 넘기고 즉시 종료(exit 0)한다.
      그래서 playwright 가 "Target page, context or browser has been closed" 로 실패한다.
      → 사장님이 웨일을 쓰는 동안에는 자동화가 아예 못 뜬다(= 상시 실행 불가).
   그래서 기본값은 이미 설치된 엣지/크롬을 "전용 프로필"로 띄우는 것이다. 크롬·엣지는 프로필이 다르면
   따로 뜨므로(웨일과 달리) 평소 쓰던 창을 닫을 필요가 없다 — 실측으로 확인.
   ※ playwright 번들 크로미움은 이 PC에서 VC++ 런타임 문제(side-by-side)로 실행되지 않아 후순위.
   웨일을 꼭 쓰고 싶으면 NC_BROWSER=whale (단, 웨일 창을 전부 닫아야 함). */
const BROWSER_PREF = (process.env.NC_BROWSER || 'auto').toLowerCase()
// auto 일 때 시도 순서. 설치돼 있고 실행되는 첫 번째를 쓴다.
const BROWSER_CHAIN = [
  { key: 'msedge', label: '엣지', opts: { channel: 'msedge' } },
  { key: 'chrome', label: '크롬', opts: { channel: 'chrome' } },
  { key: 'chromium', label: '크로미움', opts: {} },
]
let resolvedBrowser = null // 한번 성공한 브라우저를 기억
const WHALE = [
  process.env.WHALE_PATH,
  'C:\\Program Files\\Naver\\Naver Whale\\Application\\whale.exe',
  'C:\\Program Files (x86)\\Naver\\Naver Whale\\Application\\whale.exe',
  join(process.env.LOCALAPPDATA || '', 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
].filter(Boolean).find((p) => existsSync(p))

/** 웨일이 지금 실행 중인가(윈도우). 실행 중이면 웨일 모드는 반드시 실패한다. */
function whaleRunning() {
  if (process.platform !== 'win32') return false
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq whale.exe" /NH', { encoding: 'utf8', timeout: 8000 })
    return /whale\.exe/i.test(out)
  } catch { return false }
}
/* 네이버 로그인 세션 프로필.
   ⚠️ 예전에는 옆 폴더('네이버카페 자동화_신규버전/.whale-profile')만 봤는데, 그 폴더가 사라지면
      에이전트가 아예 못 뜨고 만드는 방법도 없었다. 이제 이 폴더 안(.whale-profile)을 기본으로 쓰고,
      옛 경로가 남아 있으면 그대로 재사용한다. 없으면 `--login` 으로 새로 만들 수 있다. */
// 브라우저별로 프로필을 분리한다 — 웨일 프로필을 다른 브라우저가 열어 망가뜨리는 일이 없게.
const PROFILE_DIR = (() => {
  if (process.env.NC_PROFILE_DIR) return process.env.NC_PROFILE_DIR
  if (BROWSER_PREF === 'whale') {
    const whaleDirs = [join(HERE, '.whale-profile'), resolve(HERE, '..', '네이버카페 자동화_신규버전', '.whale-profile'), resolve(HERE, '..', '네이버 카페 자동화', '.whale-profile')]
    return whaleDirs.find((p) => existsSync(p)) || whaleDirs[0]
  }
  return join(HERE, '.browser-profile')
})()

let context = null
async function getPage({ createProfile = false } = {}) {
  if (context) { try { return context.pages()[0] || (await context.newPage()) } catch { context = null } }

  const useWhale = BROWSER_PREF === 'whale'
  if (useWhale) {
    if (!WHALE) throw new Error('웨일 브라우저(whale.exe)를 찾을 수 없어요. WHALE_PATH 환경변수로 지정해 주세요.')
    if (whaleRunning()) {
      throw new Error(
        '평소 쓰는 웨일 창이 열려 있어 자동화용 웨일을 띄울 수 없어요(웨일은 창을 하나만 띄웁니다).\n' +
        '    → 웨일 창을 전부 닫고 다시 실행하거나, NC_BROWSER 설정을 지워 전용 브라우저를 쓰세요(권장).'
      )
    }
  }

  if (!existsSync(PROFILE_DIR)) {
    if (!createProfile) {
      throw new Error(`네이버 로그인이 아직 안 돼 있어요. login-setup.bat 을 먼저 한 번 실행해 주세요. (프로필: ${PROFILE_DIR})`)
    }
    mkdirSync(PROFILE_DIR, { recursive: true })
  }

  const common = {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    timeout: 45000,
  }

  if (useWhale) {
    log('브라우저 실행(웨일 + 로그인 프로필)…')
    context = await chromium.launchPersistentContext(PROFILE_DIR, { ...common, executablePath: WHALE })
  } else {
    // 설치된 브라우저를 순서대로 시도 — 하나라도 뜨면 그걸 기억해 다음부터 바로 쓴다.
    const chain = resolvedBrowser ? BROWSER_CHAIN.filter((b) => b.key === resolvedBrowser) : BROWSER_CHAIN
    const tried = []
    for (const b of chain) {
      try {
        log(`브라우저 실행(${b.label} + 자동화 전용 프로필)…`)
        context = await chromium.launchPersistentContext(PROFILE_DIR, { ...common, ...b.opts })
        resolvedBrowser = b.key
        break
      } catch (e) {
        tried.push(`${b.label}: ${String((e && e.message) || e).split('\n')[0].slice(0, 60)}`)
        context = null
      }
    }
    if (!context) {
      throw new Error(`자동화에 쓸 브라우저를 띄우지 못했어요. 엣지나 크롬이 설치돼 있어야 합니다.\n    시도: ${tried.join(' | ')}`)
    }
  }
  context.on('close', () => { context = null })
  return context.pages()[0] || (await context.newPage())
}

/** 네이버에 로그인돼 있는지 확인(카페 메인에서 로그인 흔적을 본다). */
async function isLoggedIn(page) {
  await page.goto('https://cafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(1500)
  if (page.url().includes('nid.naver.com')) return false
  try {
    // 로그아웃 링크나 내 정보 영역이 보이면 로그인 상태.
    const html = await page.content()
    if (/logout|로그아웃|nid\.naver\.com\/nidlogin\.logout/i.test(html)) return true
    // 로그인 버튼만 보이면 비로그인.
    if (/로그인하세요|nidlogin\.login/i.test(html)) return false
  } catch {}
  return true // 판단 애매하면 통과시키고, 실제 글쓰기 화면에서 다시 검증한다.
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function humanType(page, text) {
  for (const ch of String(text)) {
    await page.keyboard.type(ch, { delay: 0 })
    await sleep(25 + Math.random() * 65)
    if (ch === ' ' && Math.random() < 0.12) await sleep(200 + Math.random() * 400)
  }
}

/* 네이버 카페 글쓰기 화면 요소 — 발행과 자가검사가 "같은 셀렉터"를 쓰도록 한곳에서 관리한다.
   (예전엔 검사 수단이 없어서, 셀렉터가 깨졌는지는 실제 발행이 실패해야만 알 수 있었다.)
   네이버가 화면을 바꾸면 여기만 고치면 되고, self-check.bat 으로 즉시 확인할 수 있다. */
const TITLE_SEL = [
  'textarea[placeholder*="제목"]',
  'input[placeholder*="제목"]',
  '.textarea_input',
  'textarea.textarea_input',
  '[class*="Subject"] textarea',
  '[class*="subject"] textarea',
].join(', ')
const BODY_SEL = [
  '.se-component-content [contenteditable="true"]',
  '.se-content [contenteditable="true"]',
  '.se-text-paragraph',
  '[class*="Editor"] [contenteditable="true"]',
  'div[contenteditable="true"]',
  '[contenteditable="true"]',
].join(', ')
const SUBMIT_SEL = [
  'a.BaseButton--skinGreen',
  'button.BaseButton--skinGreen',
  '[class*="write_footer"] a:has-text("등록")',
  '[class*="WriteFooter"] button:has-text("등록")',
  'a:has-text("등록")',
  'button:has-text("등록")',
].join(', ')

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
  await page.locator(TITLE_SEL).first().click({ timeout: 8000 }).catch(() => {
    throw new Error('제목 입력칸을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  })
  await humanType(page, job.title)

  // 본문
  await page.locator(BODY_SEL).first().click({ timeout: 8000 }).catch(() => {
    throw new Error('본문 입력칸을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  })
  const lines = String(job.body || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await humanType(page, lines[i])
    if (i < lines.length - 1) { await page.keyboard.press('Enter'); await sleep(120 + Math.random() * 240) }
  }
  await sleep(500)

  // 등록
  await page.locator(SUBMIT_SEL).first().click({ timeout: 8000 }).catch(() => {
    throw new Error('등록 버튼을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  })
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

// ── 최초 1회: 네이버 로그인 세션 만들기 ──
async function loginSetup() {
  log('로그인 설정을 시작합니다. 열리는 웨일 창에서 네이버에 로그인해 주세요.')
  log(`  프로필 저장 위치: ${PROFILE_DIR}`)
  const page = await getPage({ createProfile: true })
  await page.goto('https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fcafe.naver.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  log('')
  log('  ⏳ 창에서 직접 로그인해 주세요(아이디/비밀번호는 이 프로그램이 절대 만지지 않습니다).')
  log('     로그인이 끝나면 자동으로 감지합니다. 최대 5분 기다립니다.')
  const deadline = Date.now() + 5 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(3000)
    let url = ''
    try { url = page.url() } catch { log('  창이 닫혔습니다. 다시 실행해 주세요.'); return false }
    if (!url.includes('nid.naver.com')) {
      await sleep(2000)
      if (await isLoggedIn(page)) {
        log('')
        log('  ✅ 로그인 완료! 세션이 저장됐습니다. 이제 publish-agent.bat 으로 발행을 돌릴 수 있어요.')
        log('     (이 창은 닫으셔도 됩니다)')
        return true
      }
    }
  }
  log('  ⏱ 5분 안에 로그인이 확인되지 않았습니다. 다시 실행해 주세요.')
  return false
}

// ── 자가검사: 실제 등록은 절대 하지 않고, 발행에 필요한 조건만 하나씩 확인 ──
async function selfCheck() {
  const rows = []
  const mark = (name, ok, detail = '') => { rows.push({ name, ok, detail }); log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`) }

  log('── 1. 서버 연결 ──')
  let targets = []
  try {
    const j = await http('/api/naver-cafe/agent/targets', 'GET')
    targets = Array.isArray(j?.cafes) ? j.cafes : []
    mark('서버 연결 + 인증', true, `발행처 ${targets.length}곳`)
  } catch (e) {
    mark('서버 연결 + 인증', false, String((e && e.message) || e).slice(0, 120))
    log('\n서버에 연결할 수 없어 검사를 중단합니다.')
    return rows
  }

  log('\n── 2. 브라우저 / 로그인 ──')
  if (BROWSER_PREF === 'whale') {
    if (!WHALE) { mark('웨일 브라우저', false, 'whale.exe 를 찾지 못했어요'); return rows }
    if (whaleRunning()) { mark('웨일 브라우저', false, '평소 쓰는 웨일 창이 열려 있어요 → 전부 닫거나 NC_BROWSER 설정을 지우세요(권장)'); return rows }
    mark('웨일 브라우저', true, WHALE)
  } else {
    mark('자동화 전용 브라우저', true, '평소 쓰는 브라우저와 분리 — 웨일을 켜둔 채로 돌려도 됩니다')
  }
  if (!existsSync(PROFILE_DIR)) {
    mark('네이버 로그인 세션', false, 'login-setup.bat 을 먼저 실행해 주세요')
    return rows
  }
  let page
  try {
    page = await getPage()
  } catch (e) {
    mark('브라우저 실행', false, String((e && e.message) || e).split('\n')[0].slice(0, 160))
    return rows
  }
  const logged = await isLoggedIn(page)
  mark('네이버 로그인 세션', logged, logged ? '' : '세션이 만료됐어요 → login-setup.bat 다시 실행')
  if (!logged) return rows

  log('\n── 3. 발행처별 글쓰기 화면 ──')
  for (const c of targets) {
    const label = c.name || c.id
    const m = String(c.cafe_url || '').match(/cafe\.naver\.com\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)(?:\/menus\/(\d+))?/i)
    const clubId = c.club_id || m?.[1] || null
    const menuId = c.board_id || m?.[2] || null
    if (!clubId) { mark(`[${label}] 카페 주소`, false, `club_id 도 cafe_url 도 없음 (${c.cafe_url || '주소 없음'})`); continue }

    try {
      await page.goto(`https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/write?boardType=L${menuId ? `&menuId=${menuId}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(3000)
      if (page.url().includes('nid.naver.com')) { mark(`[${label}] 글쓰기 화면`, false, '로그인 요구됨'); continue }
      try { const btn = page.locator('button:has-text("취소")').first(); if (await btn.isVisible({ timeout: 1200 })) await btn.click() } catch {}

      const titleOk = await page.locator(TITLE_SEL).first().isVisible({ timeout: 6000 }).catch(() => false)
      const bodyOk = await page.locator(BODY_SEL).first().isVisible({ timeout: 6000 }).catch(() => false)
      const submitOk = await page.locator(SUBMIT_SEL).first().isVisible({ timeout: 6000 }).catch(() => false)
      const shot = join(LOGS, `check-${String(label).replace(/[^\w가-힣]/g, '_')}.png`)
      try { await page.screenshot({ path: shot }) } catch {}
      const parts = [`제목 ${titleOk ? 'OK' : '실패'}`, `본문 ${bodyOk ? 'OK' : '실패'}`, `등록버튼 ${submitOk ? 'OK' : '실패'}`]
      mark(`[${label}] 글쓰기 화면`, titleOk && bodyOk && submitOk, `${parts.join(' · ')} → ${shot}`)
    } catch (e) {
      mark(`[${label}] 글쓰기 화면`, false, String((e && e.message) || e).slice(0, 100))
    }
    await sleep(1200)
  }
  return rows
}

// ── 진입점 ──
// process.exit() 을 바로 부르면 열려 있던 브라우저/소켓 핸들 때문에 윈도우에서 libuv 어설션이 뜬다.
// 핸들을 정리하고 exitCode 만 세팅해 자연 종료시킨다.
async function finish(code) {
  try { await context?.close() } catch {}
  process.exitCode = code
}

// ── 모의발행: 브라우저도 DB도 건드리지 않고 "무엇이 어디로 나갈지"만 확인 ──
async function dryRun() {
  log('모의발행 — 글을 등록하지 않고, 데이터도 바꾸지 않습니다.')
  log(`  서버: ${SERVER}\n`)
  let res
  try {
    res = await http('/api/naver-cafe/agent/next?dry=1', 'GET')
  } catch (e) {
    log(`❌ 서버 조회 실패: ${String((e && e.message) || e).slice(0, 140)}`)
    return 1
  }

  for (const c of res.checks || []) log(`  ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)

  if (res.none || !res.job) {
    log(`\n발행할 대상이 없습니다: ${res.reason || ''}`)
    return 1
  }

  const j = res.job
  log('\n── 지금 발행한다면 ──')
  if (res.simulated) log('  ⚠️ 승인된 글이 없어 최신 "초안"으로 대신 계산했습니다(실제 발행 대상 아님)')
  log(`  발행처 : ${j.cafe?.name || '-'}`)
  log(`  종류   : ${j.kind === 'comment' ? '댓글' : '게시글'}${j.prefix ? ` (말머리 "${j.prefix}")` : ''}`)
  log(`  주소   : ${res.writeUrl || '(계산 실패)'}`)
  log(`  제목   : ${j.title || '(없음)'}`)
  const lines = String(j.body || '').split('\n').filter(Boolean)
  log(`  본문   : ${String(j.body || '').length}자 / ${lines.length}줄`)
  for (const ln of lines.slice(0, 3)) log(`           ${ln.slice(0, 68)}${ln.length > 68 ? '…' : ''}`)
  if (lines.length > 3) log(`           … 외 ${lines.length - 3}줄`)

  const bad = (res.checks || []).filter((c) => !c.ok)
  log(`\n── 결과: ${(res.checks || []).length - bad.length}/${(res.checks || []).length} 통과 ──`)
  if (bad.length) for (const b of bad) log(`  ❌ ${b.name} — ${b.detail}`)
  else log('  🎉 서버 쪽 준비는 끝났습니다. 남은 건 네이버 로그인(login-setup.bat)뿐이에요.')
  return bad.length ? 1 : 0
}

if (MODE === 'login') {
  const ok = await loginSetup()
  await finish(ok ? 0 : 1)
} else if (MODE === 'dry') {
  const code = await dryRun()
  await finish(code)
} else if (MODE === 'check') {
  log('네이버 카페 자동화 자가검사 — 글은 절대 등록하지 않습니다.')
  log(`  서버: ${SERVER}`)
  log(`  프로필: ${PROFILE_DIR}\n`)
  let rows = []
  try {
    rows = await selfCheck()
  } catch (e) {
    // ⚠️ 검사 도중 예외가 나면 rows 가 비어 "0/0 통과 → 🎉" 처럼 거짓 합격이 나올 수 있다.
    //    예외 자체를 실패 항목으로 기록해 절대 통과로 보이지 않게 한다.
    const msg = String((e && e.message) || e).split('\n')[0].slice(0, 200)
    log(`  ❌ 검사 중단 — ${msg}`)
    rows.push({ name: '검사 진행', ok: false, detail: msg })
  }
  const bad = rows.filter((r) => !r.ok)
  log(`\n── 결과: ${rows.length - bad.length}/${rows.length} 통과 ──`)
  if (bad.length || !rows.length) {
    log('해결이 필요한 항목:')
    if (!rows.length) log('  ❌ 검사가 아무것도 수행하지 못했습니다.')
    for (const b of bad) log(`  ❌ ${b.name} — ${b.detail}`)
  } else {
    log('  🎉 발행에 필요한 조건이 모두 준비됐습니다. 웹에서 글을 승인하면 발행됩니다.')
  }
  await finish(bad.length ? 1 : 0)
} else {
  log('네이버 카페 발행 에이전트 v3 시작')
  log(`  서버: ${SERVER}`)
  log(`  인증 토큰: ${TOKEN ? '설정됨' : '(없음 — 서버가 NC_AGENT_TOKEN 미설정 시에만 동작)'}`)
  log(`  프로필: ${PROFILE_DIR}${existsSync(PROFILE_DIR) ? '' : '  ⚠️ 아직 로그인 안 됨 → login-setup.bat 먼저 실행'}`)
  log(`  브라우저: ${BROWSER_PREF === 'whale' ? `웨일 ${WHALE || '(못 찾음)'}` : '엣지/크롬을 자동화 전용 프로필로 사용(평소 쓰는 창과 분리 — 켜둔 채로 돌아갑니다)'}`)
  log(`  승인된 글을 ${POLL / 1000}초 간격으로 확인합니다(페이스 규칙은 서버가 판정). 이 창을 닫으면 멈춥니다.`)
  await heartbeat()
  setInterval(heartbeat, 30_000)
  for (;;) {
    try { await publishTick() } catch (e) { log('루프 오류:', String((e && e.message) || e).slice(0, 200)) }
    try { await trackReactions() } catch (e) { log('추적 오류:', String((e && e.message) || e).slice(0, 200)) }
    await sleep(POLL)
  }
}
