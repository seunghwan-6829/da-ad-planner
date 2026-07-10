// 네이버 카페 발행 에이전트 — 내 PC에서 실행(publish-agent.bat).
//   웹(제작 사이트)에서 [발행 대기]로 넘긴 글(nc_posts.status='queued')을
//   로그인된 웨일 브라우저 프로필(디버깅 모드/CDP 기반 playwright-core)로 실제 카페에 등록한다.
//   - 등록 성공 → status='published' + 글 URL 기록
//   - 실패 → status='failed' + 원인 + 스크린샷(logs/<글id>.png)
//   - 30초마다 하트비트(nc_agent) → 웹 UI에 "에이전트 온라인" 표시
//   ⚠️ 창을 닫으면 자동 발행이 멈춘다(글 저장/AI 초안은 웹에서 계속 가능).

import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright-core'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const LOGS = join(HERE, 'logs')
mkdirSync(LOGS, { recursive: true })
const log = (...a) => console.log(`[cafe-agent ${new Date().toLocaleTimeString('ko-KR', { hour12: false })}]`, ...a)

// ── 자격증명(.env → ../meta-ad-monitor/.env) ──
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
  if (existsSync(p)) { const e = loadEnvFile(p); SUPABASE_URL ||= e.SUPABASE_URL; SUPABASE_SERVICE_KEY ||= e.SUPABASE_SERVICE_KEY }
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 를 찾을 수 없습니다.'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// ── 브라우저: 웨일 실행파일 + 로그인된 프로필 ──
const WHALE_CANDIDATES = [
  process.env.WHALE_PATH,
  'C:\\Program Files\\Naver\\Naver Whale\\Application\\whale.exe',
  'C:\\Program Files (x86)\\Naver\\Naver Whale\\Application\\whale.exe',
  join(process.env.LOCALAPPDATA || '', 'Naver', 'Naver Whale', 'Application', 'whale.exe'),
].filter(Boolean)
const WHALE = WHALE_CANDIDATES.find((p) => existsSync(p))
// 네이버 로그인 세션이 담긴 프로필(별도 폴더 — 평소 쓰는 웨일 창과 충돌 없음)
const PROFILE_DIR = process.env.NC_PROFILE_DIR || resolve(HERE, '..', '네이버 카페 자동화', '.whale-profile')

let context = null
async function getPage() {
  if (context) {
    try { return context.pages()[0] || (await context.newPage()) } catch { context = null }
  }
  if (!WHALE) throw new Error('웨일 브라우저(whale.exe)를 찾을 수 없어요. WHALE_PATH 환경변수로 지정해 주세요.')
  if (!existsSync(PROFILE_DIR)) throw new Error(`브라우저 프로필이 없어요: ${PROFILE_DIR}`)
  log('브라우저 실행(웨일 + 로그인 프로필)…')
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: WHALE,
    headless: false, // 발행 과정이 눈에 보임(문제 시 이 창에서 직접 로그인/조치)
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
  context.on('close', () => { context = null })
  return context.pages()[0] || (await context.newPage())
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 사람 타이핑 시뮬레이션: 글자당 25~90ms 랜덤 + 가끔 짧은 멈춤(단어 사이) — 자동입력 감지/티 방지.
async function humanType(page, text) {
  for (const ch of String(text)) {
    await page.keyboard.type(ch, { delay: 0 })
    await sleep(25 + Math.random() * 65)
    if (ch === ' ' && Math.random() < 0.12) await sleep(200 + Math.random() * 400) // 단어 사이 숨 고르기
  }
}

// ── 카페 글 등록(핵심) ──
async function publishPost(post, cafe) {
  const page = await getPage()
  const cluburl = (cafe.cafe_url || '').match(/cafe\.naver\.com\/([^/?#]+)/i)?.[1]
  if (!cluburl) throw new Error(`카페 URL 형식이 이상해요: ${cafe.cafe_url}`)

  // 1) 카페 홈 → 내부 clubid 추출(레거시 홈 HTML의 g_sClubId)
  await page.goto(`https://cafe.naver.com/${cluburl}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  if (page.url().includes('nid.naver.com')) {
    throw new Error('네이버 로그인 세션이 만료됐어요. 열린 브라우저 창에서 로그인한 뒤 이 글을 다시 [발행 대기]로 돌려주세요.')
  }
  const html = await page.content()
  const clubId = html.match(/g_sClubId\s*=\s*["'](\d+)["']/)?.[1]
  if (!clubId) throw new Error('카페 ID를 찾지 못했어요(카페 미가입이거나 페이지 구조 변경).')

  // 2) 글쓰기(스마트에디터 ONE) 진입
  await page.goto(`https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/write?boardType=L`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  if (page.url().includes('nid.naver.com')) {
    throw new Error('네이버 로그인 세션이 만료됐어요. 열린 브라우저 창에서 로그인한 뒤 이 글을 다시 [발행 대기]로 돌려주세요.')
  }
  await sleep(2500) // 에디터 로딩

  // 임시저장 복원 팝업이 뜨면 '취소'(새 글로 시작)
  try {
    const cancel = page.locator('button:has-text("취소")').first()
    if (await cancel.isVisible({ timeout: 1500 })) await cancel.click()
  } catch {}

  // 3) 게시판 선택(설정돼 있으면 — 실패해도 기본 게시판으로 진행)
  if (cafe.board_name) {
    try {
      await page.locator('.FormSelectButton button, button.button_select, [class*="select_board"] button').first().click({ timeout: 4000 })
      await page.locator(`li:has-text("${cafe.board_name}"), [role="option"]:has-text("${cafe.board_name}")`).first().click({ timeout: 4000 })
      log(`  게시판 선택: ${cafe.board_name}`)
    } catch {
      log(`  ⚠️ 게시판 "${cafe.board_name}" 자동선택 실패 → 기본 게시판으로 진행`)
    }
  }

  // 4) 제목 — 사람이 타이핑하는 것처럼(자동입력 티 안 나게 랜덤 딜레이)
  const titleBox = page.locator('textarea[placeholder*="제목"], .textarea_input').first()
  await titleBox.click({ timeout: 8000 })
  await humanType(page, post.title)

  // 5) 본문(스마트에디터 본문 영역 클릭 후 실제 타이핑 — 문단 유지)
  const bodyBox = page.locator('.se-component-content [contenteditable="true"], .se-content [contenteditable="true"], [contenteditable="true"]').first()
  await bodyBox.click({ timeout: 8000 })
  const lines = String(post.body || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await humanType(page, lines[i])
    if (i < lines.length - 1) { await page.keyboard.press('Enter'); await sleep(120 + Math.random() * 240) }
  }
  await sleep(500)

  // 6) 등록
  await page.locator('a:has-text("등록"), button:has-text("등록")').first().click({ timeout: 8000 })
  // 등록 후 글 페이지로 이동할 때까지 대기
  await page.waitForURL((u) => /articles\/\d+|articleid=\d+|ArticleRead/i.test(String(u)), { timeout: 20000 })
  return page.url()
}

// ── 메인 루프 ──
async function heartbeat() {
  try { await sb.from('nc_agent').upsert({ id: 1, last_seen: new Date().toISOString(), info: 'pc-agent' }) } catch {}
}

async function tick() {
  // 발행 대기 글 1개 집기(오래된 것부터)
  const { data: posts } = await sb
    .from('nc_posts')
    .select('*, nc_cafes(*)')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
  const post = posts?.[0]
  if (!post) return

  // 낙관적 잠금: queued → publishing (다른 실행과 중복 방지)
  const { data: locked } = await sb
    .from('nc_posts')
    .update({ status: 'publishing', updated_at: new Date().toISOString() })
    .eq('id', post.id)
    .eq('status', 'queued')
    .select()
  if (!locked?.length) return

  const cafe = post.nc_cafes
  log(`발행 시작: [${cafe?.name}] ${post.title}`)
  try {
    const url = await publishPost(post, cafe || {})
    const now = new Date()
    await sb.from('nc_posts').update({
      status: 'published',
      published_at: now.toISOString(),
      published_url: url,
      // 24시간 뒤 반응(조회/좋아요/댓글) 측정 예약 — PC 꺼져 있었으면 다음에 켜질 때 밀린 것까지 한번에.
      track_due_at: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
      error: null,
      updated_at: now.toISOString(),
    }).eq('id', post.id)
    log(`✅ 발행 완료: ${url}`)
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300)
    log(`❌ 발행 실패: ${msg}`)
    try { const page = context?.pages()[0]; if (page) await page.screenshot({ path: join(LOGS, `${post.id}.png`), fullPage: false }) } catch {}
    await sb.from('nc_posts').update({ status: 'failed', error: msg, updated_at: new Date().toISOString() }).eq('id', post.id)
  }
}

// ── 24시간 후 반응 추적: 카페 가입자만 열람 가능 → 로그인된 이 브라우저로 직접 방문해 측정.
//    PC가 꺼져 있어 놓친 것들도 track_due_at 지난 순서로 밀린 만큼 전부 처리(대시보드의 '측정 대기' 소진).
async function trackReactions() {
  const { data: due } = await sb
    .from('nc_posts')
    .select('id, published_url, title')
    .not('published_url', 'is', null)
    .is('tracked_at', null)
    .lte('track_due_at', new Date().toISOString())
    .order('track_due_at', { ascending: true })
    .limit(5) // 틱당 5개씩(밀린 건 다음 틱에 이어서)
  if (!due?.length) return
  const page = await getPage()
  for (const post of due) {
    try {
      log(`반응 측정: ${post.title}`)
      await page.goto(post.published_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(2500)
      // iframe 구조(구형 카페)면 본문 프레임에서, 아니면 페이지에서 텍스트 수집
      let text = ''
      try {
        for (const f of page.frames()) { try { text += ' ' + (await f.evaluate(() => document.body?.innerText || '')) } catch {} }
      } catch { text = await page.evaluate(() => document.body?.innerText || '') }
      const num = (re) => { const m = text.match(re); return m ? Number(String(m[1]).replace(/,/g, '')) : null }
      const views = num(/조회\s*([\d,]+)/)
      const comments = num(/댓글\s*([\d,]+)/)
      const likes = num(/(?:좋아요|공감)\s*([\d,]+)/)
      await sb.from('nc_posts').update({
        views, likes, comments,
        tracked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', post.id)
      log(`  → 조회 ${views ?? '?'} · 좋아요 ${likes ?? '?'} · 댓글 ${comments ?? '?'}`)
      await sleep(1500 + Math.random() * 2000)
    } catch (e) {
      log(`  반응 측정 실패(다음 틱에 재시도): ${String((e && e.message) || e).slice(0, 100)}`)
    }
  }
}

log('네이버 카페 발행 에이전트 시작')
log(`  프로필: ${PROFILE_DIR}`)
log(`  브라우저: ${WHALE || '(웨일 못 찾음 — 발행 시 오류로 안내)'}`)
log('  웹의 [발행 대기] 글을 20초 간격으로 확인합니다. 이 창을 닫으면 멈춥니다.')
await heartbeat()
setInterval(heartbeat, 30_000)
// 순차 루프(브라우저 1개로 하나씩): 발행 → 밀린 반응 측정
for (;;) {
  try { await tick() } catch (e) { log('루프 오류:', String((e && e.message) || e).slice(0, 200)) }
  try { await trackReactions() } catch (e) { log('추적 오류:', String((e && e.message) || e).slice(0, 200)) }
  await sleep(20_000)
}
