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
      /* 가장 흔한 원인은 "이미 다른 프로세스가 이 프로필을 쓰는 중"이다.
         발행 에이전트를 켜둔 채 self-check 를 돌리면 여기 걸린다 —
         브라우저 미설치로 오해하지 않게 구분해서 알려준다. */
      const inUse = existsSync(join(PROFILE_DIR, 'SingletonLock')) || existsSync(join(PROFILE_DIR, 'lockfile'))
      if (inUse) {
        throw new Error(
          '이미 실행 중인 자동화 브라우저가 프로필을 쓰고 있어요.\n' +
          '    → 발행 에이전트(publish-agent.bat) 창을 닫고 다시 실행해 주세요. 둘을 동시에 켤 수는 없습니다.'
        )
      }
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
/* ⚠️ 셀렉터는 "배열"로 두고 하나씩 순서대로 시도한다.
   쉼표로 이어 붙여 locator(...).first() 를 쓰면 우선순위가 무시되고 **문서 순서**로 잡힌다.
   그래서 의도한 요소가 아니라 페이지 앞쪽의 엉뚱한 요소가 선택되는 사고가 난다. */
const TITLE_SEL = [
  'textarea[placeholder*="제목"]',
  'input[placeholder*="제목"]',
  'textarea.textarea_input',
  '.textarea_input',
  '[class*="Subject"] textarea',
  '[class*="subject"] textarea',
]
/* 본문 셀렉터. ⚠️ 스마트에디터에는 클립보드용 "숨김(aria-hidden) contenteditable" 이 있어서
   그냥 div[contenteditable] 을 잡으면 그 숨김칸이 걸려 클릭이 타임아웃난다(실측한 실패 원인).
   그래서 aria-hidden 을 제외하고, 실제 본문 영역은 아래 clickBodyEditor 로 좌표 클릭한다. */
const BODY_SEL = [
  '.se-content [contenteditable="true"]:not([aria-hidden="true"])',
  '.se-section-text [contenteditable="true"]:not([aria-hidden="true"])',
  '.se-main-container [contenteditable="true"]:not([aria-hidden="true"])',
  'div[contenteditable="true"]:not([aria-hidden="true"])',
]

/** 후보를 순서대로 시도해 처음 "보이는" 것을 돌려준다. 못 찾으면 null. */
async function firstVisible(scope, selectors, timeout = 4000) {
  for (const sel of selectors) {
    const loc = scope.locator(sel).first()
    if (await loc.isVisible({ timeout }).catch(() => false)) return loc
  }
  return null
}

/** 본문 편집칸을 찾아 실제로 포커스한다.
 *  숨김(aria-hidden)·초소형 편집칸을 걸러내고, "보이는 것 중 가장 큰" contenteditable 을 좌표로 클릭한다.
 *  좌표 클릭이라 aria-hidden 같은 attribute 판정과 무관하게 실제 편집 영역에 커서가 들어간다. */
/* 본문에 커서가 실제로 들어갔는지 확인.
   ⚠️ 스마트에디터 본문은 iframe 기반이라, 편집 영역을 클릭하면 activeElement 가 IFRAME 이 된다(실측).
      그래서 IFRAME 포커스도 '본문 포커스됨'으로 인정한다. 메인 문서의 숨김(aria-hidden) 칸은 제외. */
async function bodyFocused(page) {
  return await page.evaluate(() => {
    const a = document.activeElement
    if (!a) return false
    if (a.tagName === 'IFRAME') return true
    if (a.getAttribute?.('aria-hidden') === 'true') return false
    if (a.getAttribute?.('contenteditable') === 'true') return true
    return !!a.closest?.('[contenteditable="true"]:not([aria-hidden="true"])')
  }).catch(() => false)
}

/* 본문 편집칸에 커서를 넣는다.
   ⚠️ 메인 문서의 contenteditable 은 클립보드용 숨김칸뿐이다. 그걸 클릭하면 타임아웃난다(실측).
      실제 본문은 SE 텍스트 영역(.se-text-paragraph 등)을 클릭하면 편집 iframe 에 포커스가 간다.
      입력된 글자는 메인 .se-content 에도 그대로 반영돼 검수·읽기가 정상 동작한다(실측 확인). */
async function clickBodyEditor(page) {
  const el = await firstVisible(page, [
    '.se-text-paragraph',
    '.se-module-text',
    '.se-section-text',
    '.se-content',
    '.se-viewer',
  ], 6000)
  if (!el) return false
  for (let i = 0; i < 2; i++) {
    try { await el.click({ timeout: 5000 }) } catch {}
    await sleep(400)
    if (await bodyFocused(page)) return true
  }
  return await bodyFocused(page)
}
/* ⚠️ 등록 버튼은 "정확히 등록"인 것만 잡아야 한다.
   네이버 카페 에디터에는 [임시등록]과 [등록]이 나란히 있는데,
   has-text("등록")는 부분 일치라 **임시등록에도 걸린다**. 그걸 누르면 글이 올라가지 않고
   임시저장만 되어, 겉보기엔 "버튼이 안 눌린" 것처럼 보인다.
   그래서 :text-is()(완전 일치)를 쓰고, 혹시 모를 경우를 위해 임시등록을 명시적으로 제외한다. */
/* 등록 버튼. "정확히 등록"인 것만 잡는다 —
   has-text 는 부분 일치라 [임시등록]에도 걸리고, 그걸 누르면 임시저장만 되어
   겉보기엔 "버튼이 안 눌린" 것처럼 보인다(실측한 실패 원인). */
const SUBMIT_SEL = [
  'a:text-is("등록")',
  'button:text-is("등록")',
  '[class*="write_footer"] a:text-is("등록")',
  '[class*="WriteFooter"] button:text-is("등록")',
  'a.BaseButton--skinGreen:not(:has-text("임시"))',
  'button.BaseButton--skinGreen:not(:has-text("임시"))',
]

/* 에디터에 실제로 들어간 본문을 읽는다.
   ⚠️ SE 에디터는 문단마다 별도의 contenteditable 로 쪼개진다. 그래서 셀렉터에 .first() 를 쓰면
      첫 줄 하나만 읽혀 "본문이 덜 입력됨" 오탐이 난다(실측: 356자 본문을 8자로 읽음).
      그래서 페이지 안의 모든 후보를 훑어 "가장 긴 텍스트"를 본문으로 본다. */
async function readEditorBody(page) {
  const pick = async (frame) => {
    try {
      return await frame.evaluate(() => {
        let best = ''
        const take = (el) => {
          const t = ((el && el.innerText) || '').trim()
          if (t.length > best.length) best = t
        }
        /* 문단이 쪼개져 있어도 컨테이너 단위로 읽으면 전체가 잡힌다.
           ⚠️ [class*="Editor"] 같은 큰 래퍼는 넣지 않는다 — 제목·툴바·플레이스홀더까지 섞여
              본문 길이가 부풀고, 그러면 검수가 통과해도 의미가 없어진다. */
        for (const sel of ['.se-content', '.se-main-container', '[class*="se-content"]']) {
          document.querySelectorAll(sel).forEach(take)
        }
        document.querySelectorAll('[contenteditable="true"]').forEach(take)
        return best
      })
    } catch { return '' }
  }
  let best = await pick(page)
  for (const f of page.frames()) {
    const t = await pick(f)
    if (t.length > best.length) best = t
  }
  return best
}

/* 게시판 선택.
   ⚠️ 글쓰기 URL 에 menuId 를 넣어도 게시판이 자동 선택되지 않는 경우가 있다(실측).
      그 상태로는 [등록]이 비활성이라 눌러도 아무 일이 없다 — "버튼이 안 눌린다"의 진짜 원인.
   그래서 화면에서 직접 골라주고, 실제로 선택됐는지 확인까지 한다. */
/** 임시저장 복원 팝업 닫기. 모달 안으로 한정한다 — 페이지 전체에서 "취소"를 찾으면 엉뚱한 버튼을 누른다. */
async function dismissRestoreDialog(page) {
  const dialog = page.locator('[role="dialog"], [class*="Modal"], [class*="layer_popup"]').first()
  if (!(await dialog.isVisible({ timeout: 1500 }).catch(() => false))) return
  const btn = await firstVisible(dialog, ['button:text-is("취소")', 'a:text-is("취소")', 'button:has-text("새로 작성")'], 1200)
  if (btn) { try { await btn.click({ timeout: 2000 }); await sleep(400) } catch {} }
}

/**
 * 방금 올린 글을 게시판 목록에서 찾아 URL 을 돌려준다(없으면 null).
 * 등록 후 리다이렉트가 늦거나 목록으로 돌아가는 카페에서 "실패로 오판 → 재발행 → 중복"을 막는 장치다.
 */
async function findPostedArticle(page, clubId, menuId, title) {
  const needle = String(title || '').replace(/\s+/g, '').slice(0, 20)
  if (!needle) return null
  const listUrl = `https://cafe.naver.com/ca-fe/cafes/${clubId}/menus/${menuId || 0}?viewType=L`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 25000 })
      await sleep(2500)
      const href = await page.evaluate((n) => {
        const links = [...document.querySelectorAll('a[href*="articles/"], a[href*="articleid="]')]
        for (const a of links) {
          if ((a.textContent || '').replace(/\s+/g, '').includes(n)) return a.href
        }
        return null
      }, needle)
      if (href) return href
    } catch {}
    await sleep(3000) // 목록 반영이 늦을 수 있어 한 번 더
  }
  return null
}

/** 게시판 목록 페이지에서 지금 보고 있는 게시판 이름을 읽는다(설정에 이름이 없어도 학습하기 위해). */
async function readActiveBoardName(page) {
  try {
    return await page.evaluate(() => {
      const clean = (s) => (s || '').replace(/\s+/g, ' ').trim()
      // 1) 활성 메뉴/게시판 제목 후보
      const sels = [
        '[class*="BoardTitle"]',
        '[class*="board_title"]',
        '.ArticleBoard h2',
        '.menu_list li.on a, .cafe-menu li.on a, li.on > a[href*="menus/"]',
        'a[aria-current="page"]',
      ]
      for (const s of sels) {
        const t = clean(document.querySelector(s)?.textContent)
        if (t && t.length <= 30) return t
      }
      // 2) 문서 제목("게시판명 : 카페명" 형태)에서 앞부분
      const dt = clean(document.title).split(/[:|｜]/)[0].trim()
      if (dt && dt.length <= 30 && !/네이버\s*카페/.test(dt)) return dt
      return ''
    })
  } catch {
    return ''
  }
}

/** 카페/게시판 화면의 [글쓰기] 버튼을 찾는다. menuId 를 담은 게시판 전용 버튼을 우선한다. */
async function findWriteButton(page, menuId) {
  const sels = [
    ...(menuId ? [`a[href*="articles/write"][href*="menuId=${menuId}"]`, `a[href*="menus/${menuId}"][href*="write"]`] : []),
    'a[href*="articles/write"]',
    'a[href*="ArticleWrite"]',
    'a:has-text("글쓰기")',
    'button:has-text("글쓰기")',
  ]
  const found = await firstVisible(page, sels, 2500)
  if (found) return found
  for (const f of page.frames()) {
    const inFrame = await firstVisible(f, sels, 1500)
    if (inFrame) return inFrame
  }
  return null
}

/**
 * 글쓰기 화면을 연다.
 * ★ 기본 경로: 설정해둔 카페/게시판 주소로 가서 [글쓰기]를 누른다.
 *   ⚠️ 이 버튼은 대개 **새 탭**에서 글쓰기를 연다. 그래서 새 탭을 붙잡아 그쪽으로 전환한다.
 *      (예전엔 기존 탭에 남아 아무 동작도 못 하고 멈췄다 — 이번 실측 실패의 핵심 원인)
 *   목록 페이지에서 게시판 이름도 미리 학습한다(설정이 비어 있어도 나중에 정확히 고르기 위해).
 * 폴백: [글쓰기]를 못 찾으면 글쓰기 주소로 직접 이동한다.
 * @returns {{ page, how:'from-board'|'direct', learnedBoardName:string }}
 */
const isWriteUrl = (u) => /articles\/write|ArticleWrite/i.test(String(u || ''))

/** 지금 열려 있는 탭들 중 "글쓰기 화면인, 살아있는" 탭을 고른다(가장 최근 것 우선). 없으면 null.
 *  ⚠️ 네이버 [글쓰기]는 중간 팝업을 열었다가 진짜 글쓰기 탭으로 교체하기도 한다.
 *     그래서 첫 'page' 이벤트를 믿지 말고, 상황이 안정된 뒤 실제 글쓰기 탭을 훑어 고른다. */
function findWriteTab() {
  const pages = (context?.pages() || []).filter((p) => { try { return !p.isClosed() } catch { return false } })
  for (let i = pages.length - 1; i >= 0; i--) {
    try { if (isWriteUrl(pages[i].url())) return pages[i] } catch {}
  }
  return null
}

async function openWriteForm(basePage, cafeUrl, clubId, menuId) {
  let learnedBoardName = ''
  if (cafeUrl) {
    try {
      await basePage.goto(cafeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      assertLoggedIn(basePage)
      await sleep(2500)
      learnedBoardName = await readActiveBoardName(basePage)

      const btn = await findWriteButton(basePage, menuId)
      if (btn) {
        await btn.click({ timeout: 8000 }).catch(() => {})

        /* 클릭 뒤 탭들이 "안정될 때까지" 기다린다 — 중간 팝업이 열렸다 닫히고 진짜 글쓰기 탭이
           자리잡는 흐름을 통과시키기 위해. write URL 탭이 연속 2회 같게 잡히면 안정된 것으로 본다. */
        let writePage = null
        let stableStreak = 0
        for (let i = 0; i < 15; i++) { // 최대 ~15초
          await sleep(1000)
          const cand = findWriteTab()
          if (cand && cand === writePage && !cand.isClosed()) {
            if (++stableStreak >= 2) break
          } else {
            writePage = cand
            stableStreak = cand ? 1 : 0
          }
        }
        if (writePage && !writePage.isClosed() && isWriteUrl(writePage.url())) {
          await writePage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {})
          await writePage.bringToFront().catch(() => {})
          await sleep(1200)
          if (!writePage.isClosed() && isWriteUrl(writePage.url())) {
            return { page: writePage, how: writePage === basePage ? 'from-board' : 'from-board(새 탭)', learnedBoardName }
          }
        }
      }
    } catch { /* 폴백으로 넘어간다 */ }
  }
  // 폴백: 글쓰기 주소로 직접 이동(같은 탭).
  await basePage.goto(`https://cafe.naver.com/ca-fe/cafes/${clubId}/articles/write?boardType=L${menuId ? `&menuId=${menuId}` : ''}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  assertLoggedIn(basePage)
  await sleep(2500)
  return { page: basePage, how: 'direct', learnedBoardName }
}

/** 게시판 드롭다운에 어떤 게시판들이 있는지 읽어온다(실패 안내에 그대로 보여주기 위해). */
async function listBoardOptions(page) {
  try {
    const names = await page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('[role="option"], li')) {
        const t = (el.textContent || '').trim()
        if (t && t.length <= 30 && !/게시판을?\s*선택/.test(t)) out.push(t)
      }
      return [...new Set(out)].slice(0, 20)
    })
    return names || []
  } catch { return [] }
}

/** 지금 화면에 "게시판을 선택해 주세요" 안내가 보이는가? (= 아직 게시판을 골라야 하는가)
 *  ★ 핵심: 게시판 [글쓰기]로 들어오면 게시판이 이미 고정돼 이 안내 자체가 없다 → 고를 필요 없음. */
async function boardNeedsSelection(page) {
  try {
    return await page.evaluate(() => {
      for (const el of document.querySelectorAll('button, [role="button"], a, div, span')) {
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
        if (/게시판을?\s*선택/.test(own) && !/말머리/.test(own)) {
          const r = el.getBoundingClientRect()
          if (r.width > 0 && r.height > 0) return true
        }
      }
      return false
    })
  } catch {
    return false
  }
}

/** 게시판 선택 드롭다운 트리거(안내 텍스트가 있을 때만 존재). 못 찾으면 null. */
async function findBoardControl(page) {
  return await firstVisible(page, [
    'select[name*="menu" i]',
    'select[class*="board" i]',
    'button:has-text("게시판을 선택")',
    '[role="button"]:has-text("게시판을 선택")',
    '[class*="BoardSelect"] button',
    '[class*="board_select"] button',
  ], 1500)
}

/**
 * 게시판이 정해졌는지 확인하고, 안 됐으면 골라준다.
 *  ① 게시판 [글쓰기]로 들어오면 게시판이 이미 고정 → "게시판을 선택" 안내가 없음 → 그대로 OK.
 *  ② 안내가 보이면(직접 URL 진입 등) 아는 이름/menuId 로만 고른다. 임의 선택은 절대 안 한다.
 * @param {boolean} readOnly 자가검사용 — 클릭하지 않고 현재 상태만 본다.
 * @returns {{ok:boolean, detail:string}}
 */
async function ensureBoardSelected(page, menuId, boardName, readOnly = false) {
  // SPA 라 안내가 늦게 뜰 수 있어 잠깐 지켜본다. "안내 없음"이 곧 "게시판 정해짐".
  let needs = await boardNeedsSelection(page)
  for (let i = 0; i < 5 && needs; i++) { await sleep(700); needs = await boardNeedsSelection(page) }
  if (!needs) return { ok: true, detail: '게시판 고정됨(선택 불필요)' }

  if (readOnly) return { ok: false, detail: '게시판 미선택 상태(발행 시 이름/ID로 선택 시도)' }
  if (!menuId && !boardName) {
    return { ok: false, detail: '어느 게시판인지 알 수 없습니다 — 발행처 설정에 게시판 이름을 넣어주세요' }
  }

  // 1) 네이티브 select 면 값/이름으로 바로 고른다.
  const nativeSel = await firstVisible(page, ['select[name*="menu" i]', 'select[class*="board" i]'], 1200)
  if (nativeSel) {
    for (const opt of [menuId ? { value: String(menuId) } : null, boardName ? { label: boardName } : null].filter(Boolean)) {
      try {
        await nativeSel.selectOption(opt)
        await sleep(400)
        if (!(await boardNeedsSelection(page))) return { ok: true, detail: '선택함(native select)' }
      } catch {}
    }
  }

  // 2) 커스텀 드롭다운: 열고 → 아는 값(menuId/이름)에 해당하는 항목만 클릭.
  //    ⚠️ 두 번 시도한다(첫 클릭에서 안 열리거나 늦게 뜨는 경우 대비).
  const want = String(boardName || '').replace(/\s+/g, '')
  for (let round = 0; round < 2; round++) {
    const trigger = await findBoardControl(page)
    if (trigger) { try { await trigger.click({ timeout: 3000 }) } catch {} }
    await sleep(900)

    /* 열린 목록에서 항목을 브라우저 안에서 직접 찾아 클릭한다.
       - menuId 가 붙은 항목을 최우선, 없으면 "공백 무시 이름 일치"로. 스크롤도 in-page 로 처리.
       - 이름 매칭은 완전 일치를 우선하고, 없을 때만 시작-부분 일치(자유게시판 ⊃ 자유 게시판)를 쓴다. */
    const clicked = await page.evaluate(({ menuId, want }) => {
      const norm = (s) => (s || '').replace(/\s+/g, '')
      const items = [...document.querySelectorAll('[role="option"], li[role="menuitem"], ul li, [class*="option"]')]
        .filter((el) => {
          const t = norm(el.textContent)
          return t && t.length <= 30 && !/게시판을?선택/.test(t)
        })
      const tryClick = (el) => {
        if (!el) return false
        el.scrollIntoView({ block: 'center' })
        el.click()
        return true
      }
      // ① menuId 로
      if (menuId) {
        const byId = items.find((el) => {
          const a = el.matches('a') ? el : el.querySelector('a')
          const hay = `${el.getAttribute('data-menuid') || ''} ${el.getAttribute('data-value') || ''} ${a?.getAttribute('href') || ''}`
          return new RegExp(`(^|[^\\d])${menuId}([^\\d]|$)`).test(hay)
        })
        if (tryClick(byId)) return 'menuId'
      }
      // ② 이름 완전 일치 → ③ 시작 부분 일치
      if (want) {
        const exact = items.find((el) => norm(el.textContent) === want)
        if (tryClick(exact)) return 'name'
        const starts = items.find((el) => { const t = norm(el.textContent); return t.startsWith(want) || want.startsWith(t) })
        if (tryClick(starts)) return 'name~'
      }
      return ''
    }, { menuId: menuId ? String(menuId) : '', want }).catch(() => '')

    if (clicked) {
      await sleep(700)
      if (!(await boardNeedsSelection(page))) return { ok: true, detail: `선택함(${clicked})` }
    }
  }

  // 아는 값으로 못 찾으면 여기서 멈춘다. 임의 선택 금지.
  return {
    ok: false,
    detail: `게시판을 찾지 못했습니다(${boardName ? `이름 "${boardName}"` : `menuId ${menuId}`}). 발행처 설정의 게시판 이름이 카페 화면과 정확히 같은지 확인해 주세요`,
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
  const basePage = await getPage()
  let page = basePage // 새 탭에서 글쓰기가 열리면 이 값이 그 탭으로 바뀐다.
  const cafeUrl = job.cafe?.url || ''
  // clubId/menuId: job 값 우선 → URL 파싱 폴백
  const direct = cafeUrl.match(/cafe\.naver\.com\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)(?:\/menus\/(\d+))?/i)
  let clubId = job.cafe?.club_id || direct?.[1] || null
  const menuId = job.board_id || direct?.[2] || null
  if (!clubId) {
    const slug = cafeUrl.match(/cafe\.naver\.com\/([^/?#]+)/i)?.[1]
    if (!slug) throw new Error(`카페 URL 형식이 이상해요: ${cafeUrl}`)
    await basePage.goto(`https://cafe.naver.com/${slug}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    assertLoggedIn(basePage)
    clubId = (await basePage.content()).match(/g_sClubId\s*=\s*["'](\d+)["']/)?.[1] || null
    if (!clubId) throw new Error('카페 ID를 찾지 못했어요(미가입이거나 페이지 구조 변경).')
  }

  /* ★ 설정해둔 카페/게시판 주소에서 [글쓰기]를 눌러 들어간다.
     이 버튼은 보통 새 탭을 여는데, openWriteForm 이 그 탭을 붙잡아 돌려준다 → 그 탭에서 이어서 작업한다. */
  const opened = await openWriteForm(basePage, cafeUrl, clubId, menuId)
  page = opened.page
  log(`  진입: ${opened.how}${opened.learnedBoardName ? ` · 게시판 학습="${opened.learnedBoardName}"` : ''}`)

  // 임시저장 복원 팝업 → 취소(새 글). ⚠️ 모달 안으로 한정 — 페이지 전체에서 "취소"를 찾으면 엉뚱한 걸 누른다.
  await dismissRestoreDialog(page)

  /* 게시판 확인. [글쓰기]로 들어와도 자동 선택이 안 되는 카페가 있어(실측) 반드시 확인·선택한다.
     설정에 이름이 없으면 목록에서 학습한 이름으로 고른다. */
  const boardName = job.board?.name || opened.learnedBoardName || ''
  const board = await ensureBoardSelected(page, menuId, boardName)
  if (!board.ok) {
    try { await page.screenshot({ path: join(LOGS, `${job.id}-board.png`), fullPage: true }) } catch {}
    const options = await listBoardOptions(page)
    const hint = options.length
      ? `\n    이 카페의 게시판: ${options.join(' / ')}\n    → 발행처 설정의 [게시판 이름]에 위 이름 중 하나를 그대로 넣어주세요.`
      : ''
    throw new Error(`게시판을 선택하지 못해 등록하지 않았습니다 — ${board.detail}.${hint} logs/${job.id}-board.png 확인`)
  }
  log(`  게시판 ${board.detail}`)
  // 자동으로 잡힌 게시판 이름을 서버에 알려 다음부터 확실해지게 한다(설정이 비어 있을 때만 채운다).
  const detectedBoard = (board.detail.match(/\(([^)]+)\)\s*$/)?.[1] || '').trim()

  // 말머리(선택) — best-effort
  if (job.prefix) {
    try {
      await page.locator('button:has-text("말머리"), [class*="prefix"] button, [class*="Prefix"] button').first().click({ timeout: 2500 })
      await page.locator(`li:has-text("${job.prefix}"), [role="option"]:has-text("${job.prefix}")`).first().click({ timeout: 2500 })
    } catch {}
  }

  // 입력 직전 탭 생존 확인 — 네이버가 글쓰기 탭을 교체/종료했다면 여기서 정직하게 실패로 돌린다
  // (그래야 재시도로 회복된다. 크래시로 이어지지 않게).
  if (page.isClosed()) {
    const alt = findWriteTab()
    if (alt && !alt.isClosed()) { page = alt; log('  글쓰기 탭이 교체되어 새 탭으로 이어갑니다') }
    else throw new Error('글쓰기 탭이 닫혔어요(네이버가 창을 교체함). 다시 시도합니다.')
  }

  // 제목 — 필드의 maxlength 를 넘으면 잘려 들어가므로, 미리 맞춰 자른다(검수 오탐 방지).
  const titleEl = await firstVisible(page, TITLE_SEL, 8000)
  if (!titleEl) throw new Error('제목 입력칸을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  const maxLen = Number(await titleEl.getAttribute('maxlength').catch(() => null)) || 0
  const titleToType = maxLen > 0 ? String(job.title).slice(0, maxLen) : String(job.title)
  if (titleToType !== job.title) log(`  ⚠️ 제목이 카페 제한(${maxLen}자)에 맞춰 잘립니다`)
  await titleEl.click({ timeout: 5000 })
  await humanType(page, titleToType)

  // 본문 — 숨김(aria-hidden) 클립보드 칸을 피해 "보이는 본문 영역"에 좌표로 커서를 넣는다.
  if (!(await clickBodyEditor(page))) {
    throw new Error('본문 입력칸을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  }
  const lines = String(job.body || '').replace(/\r\n/g, '\n').split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await humanType(page, lines[i])
    if (i < lines.length - 1) { await page.keyboard.press('Enter'); await sleep(120 + Math.random() * 240) }
  }
  await sleep(500)

  /* ── 등록 직전 내부 검수 ──
     검수 대기에서 사람이 이미 승인한 글이므로, 여기서 또 확인을 받지는 않는다.
     대신 "제대로 입력됐는지"만 기계가 확인하고, 이상하면 등록하지 않고 실패로 보고한다.
     사람처럼 한 글자씩 치는 방식이라 중간에 씹히는 일이 실제로 생길 수 있는데,
     그 상태로 올라가는 것이 가장 나쁘다. */
  {
    let tTitle = null // null = 못 읽음(빈 문자열과 구분한다)
    try { tTitle = await titleEl.inputValue({ timeout: 3000 }) } catch {
      try { tTitle = (await titleEl.innerText({ timeout: 2000 })).trim() } catch { tTitle = null }
    }
    const tBody = await readEditorBody(page)

    const squash = (s) => String(s || '').replace(/\s+/g, '')
    const wantT = squash(titleToType)
    const wantB = squash(job.body)
    const gotB = squash(tBody)

    const problems = []
    // 제목: 못 읽으면 통과시키지 않는다 — 엉뚱한 칸에 쳤을 가능성이 바로 이 경우다.
    if (wantT) {
      if (tTitle === null) problems.push('제목을 다시 읽지 못함(엉뚱한 칸에 입력됐을 수 있음)')
      else if (squash(tTitle) !== wantT) problems.push(`제목이 원문과 다름(원문 ${wantT.length}자 / 입력 ${squash(tTitle).length}자)`)
    }
    /* 본문: 길이 비율 대신 "마지막 줄이 들어갔는가"로 본다.
       ① 길이는 에디터가 링크를 카드로 바꾸거나 공백을 다르게 처리하면 쉽게 어긋나 오탐이 난다.
       ② 실제 실패 모드는 '중간에 끊김'이라, 마지막 줄 존재 여부가 훨씬 정확한 신호다.
       읽기 자체가 실패(빈 문자열)면 막지 않고 경고만 — 검수가 정상 발행을 막는 일이 없게. */
    if (wantB && !gotB) {
      log('  ⚠️ 본문을 읽지 못해 내용 검수를 건너뜁니다(입력 자체는 정상일 수 있음)')
    } else if (wantB) {
      const srcLines = String(job.body).replace(/\r\n/g, '\n').split('\n').map((l) => squash(l)).filter((l) => l.length >= 6)
      const lastLine = srcLines[srcLines.length - 1]
      if (lastLine && !gotB.includes(lastLine)) {
        problems.push(`본문 끝부분이 들어가지 않았어요(마지막 줄 누락, 원문 ${wantB.length}자 / 읽힘 ${gotB.length}자)`)
      }
    }

    if (problems.length) {
      try { await page.screenshot({ path: join(LOGS, `${job.id}-check.png`), fullPage: true }) } catch {}
      throw new Error(`입력 검수 실패로 등록하지 않았습니다 — ${problems.join(', ')}. logs/${job.id}-check.png 확인`)
    }
    if (gotB) log(`  ✓ 입력 검수 통과(제목 ${wantT.length}자 · 본문 ${gotB.length}자) — 등록합니다`)
  }

  /* 발행 전 미리보기(옵션).
     기본은 꺼져 있다. 켜 두면 등록을 누르지 않고 화면을 캡처해 올린 뒤
     사람이 웹에서 '이대로 등록'을 누를 때까지 기다린다. 취소하면 아무것도 올리지 않는다. */
  if (job.require_preview) {
    log('  등록 직전 캡처를 올리고 확인을 기다립니다…')
    /* 화면 전체를 담는다(fullPage). 뷰포트만 찍으면 위아래가 잘려서 확인의 의미가 없다.
       추가로 "에디터에 실제로 들어간 글자"를 그대로 읽어 함께 보낸다 —
       캡처는 스크롤/레이아웃에 따라 일부가 안 보일 수 있지만, 이 텍스트는 항상 전체가 남는다.
       타이핑이 중간에 씹혔는지도 웹에서 원문과 비교해 바로 알 수 있다. */
    let typedTitle = ''
    let typedBody = ''
    try { typedTitle = await titleEl.inputValue({ timeout: 3000 }) } catch {
      try { typedTitle = (await titleEl.innerText({ timeout: 2000 })).trim() } catch {}
    }
    typedBody = await readEditorBody(page)

    const shot = await page.screenshot({ type: 'png', fullPage: true })
    await http('/api/naver-cafe/agent/preview', 'POST', {
      id: job.id,
      image: shot.toString('base64'),
      typed_title: typedTitle,
      typed_body: typedBody,
    })
    log('  ⏸ 웹 대시보드에서 [이대로 등록] 또는 [취소]를 눌러주세요. (최대 15분 대기)')

    const deadline = Date.now() + 15 * 60 * 1000
    let decision = null
    while (Date.now() < deadline) {
      await sleep(5000)
      try {
        const r = await http(`/api/naver-cafe/agent/preview?id=${encodeURIComponent(job.id)}`, 'GET')
        if (r.decision === 'approve' || r.decision === 'cancel') { decision = r.decision; break }
      } catch { /* 일시적 통신 오류는 계속 대기 */ }
    }
    if (decision === 'cancel') {
      // 서버가 이미 발행 대기로 되돌렸다. 실패가 아니므로 보고하지 않는다.
      const e = new Error('사람이 취소함')
      e.cancelled = true
      throw e
    }
    if (decision !== 'approve') {
      /* 시간 초과. ⚠️ 여기서 보고를 생략하면 글이 'preview' 상태로 영원히 남아
         아무도 집어가지 못한다(next 는 approved/queued 만 본다). 반드시 실패로 보고해
         서버가 발행 대기로 되돌리게 한다. */
      throw new Error('등록 직전 확인이 15분 안에 이뤄지지 않아 등록하지 않았습니다(발행 대기로 되돌립니다)')
    }
    log('  ✅ 확인됨 — 등록합니다.')
  }

  /* 등록.
     ⚠️ "정확히 등록"인 버튼만 누른다. 글자를 못 읽으면 누르지 않는다 —
        확인 못 한 버튼을 누르는 건 임시등록을 누르는 것만큼 위험하다. */
  const submit = await firstVisible(page, SUBMIT_SEL, 8000)
  if (!submit) throw new Error('등록 버튼을 찾지 못했어요(네이버 화면 변경). self-check.bat 으로 확인해 주세요.')
  let btnText = ''
  try { btnText = (await submit.innerText({ timeout: 3000 })).trim().replace(/\s+/g, ' ') } catch {}
  if (!btnText) throw new Error('등록 버튼의 글자를 읽지 못해 누르지 않았어요(오클릭 방지). self-check.bat 으로 확인해 주세요.')
  if (btnText !== '등록') throw new Error(`등록 버튼 대신 "${btnText}"이(가) 잡혔어요. 누르지 않았습니다(self-check.bat 확인).`)
  // <a> 는 disabled 속성이 없어 Playwright 가 막아주지 못한다 — 비활성 표시를 직접 본다.
  const disabled = await submit.evaluate((n) => n.getAttribute('aria-disabled') === 'true' || n.classList.contains('is-disabled') || n.disabled === true).catch(() => false)
  if (disabled) throw new Error('등록 버튼이 아직 비활성 상태예요(필수 항목 미입력 가능성). 등록하지 않았습니다.')

  await submit.click({ timeout: 8000 })
  log(`  [등록] 클릭 — 게시 확인 중…`)

  try {
    await page.waitForURL((u) => /articles\/\d+|articleid=\d+|ArticleRead/i.test(String(u)), { timeout: 20000 })
    return { url: page.url(), boardName: detectedBoard }
  } catch {
    /* 주소가 안 바뀌었다고 해서 "안 올라갔다"고 단정하면 안 된다.
       느린 리다이렉트, 승인제 게시판, 목록으로 돌아가는 카페 설정 등에서는 글이 실제로 올라간다.
       여기서 실패로 보고하면 서버가 재시도해 **같은 글이 여러 번 올라간다** — 가장 나쁜 결과.
       그래서 목록에서 방금 쓴 제목을 직접 찾아보고 판단한다. */
    log('  주소가 바뀌지 않아 목록에서 직접 확인합니다…')
    const found = await findPostedArticle(page, clubId, menuId, titleToType)
    if (found) {
      log('  ✅ 목록에서 방금 올린 글을 확인했습니다(리다이렉트만 늦었던 것)')
      return { url: found, boardName: detectedBoard }
    }
    try { await page.screenshot({ path: join(LOGS, `${job.id}-submit.png`), fullPage: true }) } catch {}
    throw new Error(`등록을 눌렀지만 글이 확인되지 않았어요(현재 주소: ${page.url().slice(0, 80)}). 필수 항목이나 카페 규칙 때문일 수 있어요. logs/${job.id}-submit.png 확인`)
  }
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
        // ⚠️ 줄바꿈은 그대로 치면 Enter 로 들어가 댓글이 중간에 등록돼 버린다. 한 줄로 합친다.
        await humanType(page, String(job.body || '').replace(/\s*\n+\s*/g, ' ').trim())
        typed = true
        // 등록 버튼 — 실패를 삼키지 않는다(삼키면 안 올라갔는데 성공으로 보고된다).
        const btn = await firstVisible(t, ['a.button_comment', 'button:text-is("등록")', 'a:text-is("등록")'], 3000)
        if (!btn) throw new Error('댓글 등록 버튼을 찾지 못했어요(페이지 구조 변경).')
        await btn.click({ timeout: 4000 })
        break
      }
    } catch (e) {
      if (typed) throw e // 입력까지 됐는데 등록에서 막힌 경우는 그대로 실패로 올린다
    }
  }
  if (!typed) throw new Error('댓글 입력창을 찾지 못했어요(페이지 구조 변경).')

  // 실제로 달렸는지 확인한다 — 클릭만으로 성공을 단정하면 '올렸다는데 없는' 상태가 된다.
  await sleep(2500)
  const needle = String(job.body || '').replace(/\s+/g, '').slice(0, 15)
  const ok = await page.evaluate((n) => (document.body?.innerText || '').replace(/\s+/g, '').includes(n), needle).catch(() => false)
  if (!ok) throw new Error('댓글을 등록했지만 화면에서 확인되지 않았어요(등록 실패 가능성).')
  return { url: null, boardName: '' } // 댓글은 별도 URL/24h 추적 없음
}

// ── 하트비트 ──
async function heartbeat() { try { await http('/api/naver-cafe/agent', 'POST', { info: 'pc-agent' }) } catch {} }

/* 처리 한 건이 끝나면 브라우저를 통째로 닫는다.
   글쓰기 탭뿐 아니라 그 앞의 '게시판 목록 창'(첫 창)까지 함께 닫혀, 대기 중에는 창이 하나도 남지 않는다.
   다음 발행 때 프로필째 다시 열리며, 네이버 로그인은 프로필에 저장돼 있어 그대로 유지된다.
   (발행 간격이 25~90분이라 매번 새로 여는 부담은 사실상 없다.) */
async function closeBrowserSession() {
  try { if (context) await context.close() } catch {}
  context = null
}

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
let halted = false // 서버가 자동 중단한 상태인지(로그 도배 방지용)
async function publishTick() {
  let res
  try { res = await http('/api/naver-cafe/agent/next', 'GET') } catch (e) { log('next 조회 실패:', String(e.message || e).slice(0, 120)); return }
  if (res.none || !res.job) {
    // 서버가 연속 실패로 자동 중단한 상태 — 조용히 기다린다(웹에서 [재개]하면 풀린다).
    if (res.halted && !halted) { halted = true; log(`🛑 ${res.reason}`) }
    if (!res.halted) halted = false
    if (res.reason && res.reason !== idleReason) { log(`대기: ${res.reason}`); idleReason = res.reason }
    return
  }
  halted = false
  idleReason = ''
  const job = res.job
  log(`발행 시작: [${job.cafe?.name}] (${job.kind}) ${job.title || job.source_url || ''}`)

  // 1) 발행 시도 — 여기서 던지면 '진짜 미발행 실패'. 실패 보고 → 서버가 재시도용으로 approved 복귀(+간격 예약).
  let result = null
  try {
    result = job.kind === 'comment' ? await publishComment(job) : await publishPost(job)
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 300)
    // 사람이 미리보기에서 취소한 건 '실패'가 아니다 — 서버가 이미 발행 대기로 되돌렸고,
    // 실패로 보고하면 연속 실패 카운터가 올라가 엉뚱하게 자동 중단된다.
    if (e && e.cancelled) { log(`⏹ 등록하지 않았습니다: ${msg}`); await closeBrowserSession(); return }
    log(`❌ 발행 실패: ${msg}`)
    try { const p = context?.pages().slice(-1)[0]; if (p) await p.screenshot({ path: join(LOGS, `${job.id}.png`), fullPage: true }) } catch {}
    const reported = await reportResult({ id: job.id, ok: false, kind: job.kind, cafe_id: job.cafe_id, note: msg })
    // 실패 보고마저 실패하면 글이 '발행 중'으로 남아 아무도 집어가지 못한다 — 크게 알린다.
    if (!reported) log(`⚠️ 실패 보고를 전송하지 못했습니다. 이 글은 서버에 '발행 중'으로 남습니다 — 대시보드에서 [되돌리기]를 눌러주세요.`)
    await closeBrowserSession()
    return
  }

  // 2) 발행 확정됨 — 성공 보고는 재시도만 하고 절대 실패로 낮추지 않는다(이중발행 방지).
  const url = result?.url || null
  const ok = await reportResult({
    id: job.id,
    ok: true,
    kind: job.kind,
    cafe_id: job.cafe_id,
    published_url: url || undefined,
    // 이번에 실제로 쓰인 게시판 이름 — 서버가 설정이 비어 있을 때만 채워 다음부터 확실해진다.
    board_name: result?.boardName || undefined,
  })
  if (ok) log(`✅ 발행 완료${url ? `: ${url}` : ''}`)
  else log(`⚠️ 발행은 됐지만 결과 보고 실패 — 서버에 '발행 중'으로 남습니다. 웹에서 확인 후 처리하세요(중복 발행 방지).`)
  await closeBrowserSession()
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
  await closeBrowserSession() // 측정용으로 연 창도 끝나면 닫아 대기 중 창이 남지 않게 한다.
}

/* ── 카페 관찰: 발행처 게시판 + '인기글' 페이지에 들러 글 제목·조회수·댓글수 수집 ──
   서버가 카페당 11시간에 1번(하루 2회) 배정하고, 카페 사이엔 최소 25분을 띄운다.
   같은 글을 두 번 이상 보면서 조회·댓글이 얼마나 늘었는지가 쌓이고,
   서버가 첫 수집 24시간 뒤 그 증가폭으로 '잘 나온 글'을 가려낸다(광고는 자동 제외).
   · 최근 글 목록 → 카페의 말투·소재 결 맞추기
   · 인기글(조회·댓글 포함) → 반응이 검증된 '소재 시드'(주제만 차용해 우리 글로 재창작 — 복제는 서버가 차단) */
/* 목록에서 글을 뽑아낸다. 카페 스킨(신형 f-e / 구형 iframe)마다 구조가 달라 여러 전략을 겹쳐 쓴다.
   ⚠️ 예전 버전의 두 가지 문제를 고쳤다:
     ① 같은 글의 '댓글 수 링크'(<a>[4]</a>)까지 별도 게시글로 수집돼 제목이 "[ 4 ]" 인 쓰레기 행이 생겼다.
        → 글 번호(article_id)로 묶고, 숫자뿐인 링크는 제목이 아니라 '댓글 수'로 쓴다.
     ② 조회수를 "조회 123" 라벨로만 찾아서, 라벨 없이 숫자만 있는 신형 목록에서 항상 null 이 됐다.
        → 지표를 못 읽으면 24시간 증가폭을 못 재고 전부 '측정 불가'가 된다(실제로 그렇게 됐음).
        → 라벨 → 클래스명 → '날짜/시각 뒤 첫 숫자' 순으로 겹쳐 찾는다(대부분 목록이 제목·작성자·날짜·조회 순). */
async function extractCafePosts(page) {
  const items = []
  const seen = new Set()
  for (const f of page.frames()) {
    let rows = []
    try {
      rows = await f.evaluate(() => {
        const num = (s) => {
          if (s === null || s === undefined) return null
          const m = String(s).replace(/,/g, '').match(/\d+/)
          if (!m) return null
          const n = Number(m[0])
          return Number.isFinite(n) && n >= 0 && n < 10000000 ? n : null
        }

        // 같은 글의 여러 링크(제목·댓글수)를 글 번호로 묶는다
        const groups = new Map()
        document.querySelectorAll('a[href*="/articles/"], a[href*="articleid="], a.article').forEach((a) => {
          const href = a.href || ''
          const m = href.match(/articles\/(\d+)/) || href.match(/articleid=(\d+)/i)
          const id = m ? m[1] : null
          const raw = (a.textContent || '').replace(/\s+/g, ' ').trim()
          const key = id || raw
          if (!key) return
          let g = groups.get(key)
          if (!g) { g = { article_id: id, titles: [], comments: null, row: null }; groups.set(key, g) }
          // 텍스트가 숫자(또는 [숫자])뿐인 링크 = 댓글 수. 제목으로 쓰면 안 된다.
          const cm = raw.match(/^\[?\s*(\d{1,5})\s*\]?$/)
          if (cm) {
            const n = Number(cm[1])
            if (g.comments === null || n > g.comments) g.comments = n
          } else if (raw.length >= 2) {
            g.titles.push(raw)
          }
          if (!g.row) g.row = a.closest('tr, li, .board-list, [class*="ArticleItem"], [class*="article-board"], [class*="item"]') || a.parentElement
        })

        const out = []
        groups.forEach((g) => {
          // 제목 = 후보 중 가장 긴 것(아이콘·배지 텍스트 배제), 끝의 [댓글수] 꼬리는 제거
          let title = g.titles.sort((a, b) => b.length - a.length)[0] || ''
          title = title.replace(/\s*\[\s*\d+\s*\]\s*$/, '').trim()
          if (!title) return
          // \s 는 줄바꿈과   (nbsp) 를 모두 포함 — 한 줄 문자열로 눌러야 아래 정규식들이 안정적으로 걸린다
          const rowText = g.row ? String(g.row.innerText || '').replace(/\s+/g, ' ').trim() : ''

          // ── 댓글 수 ──
          let comments = g.comments
          if (comments === null) {
            const lm = rowText.match(/댓글\s*([\d,]+)/)
            if (lm) comments = num(lm[1])
          }
          if (comments === null && g.row) {
            const el = g.row.querySelector('[class*="comment" i], [class*="cmt" i], [class*="reply" i]')
            if (el) comments = num(el.textContent)
          }

          // ── 조회수 ──
          let views = null
          const vm = rowText.match(/조회\s*([\d,]+)/)
          if (vm) views = num(vm[1])
          if (views === null && g.row) {
            const el = g.row.querySelector('[class*="view_count" i], [class*="viewCount" i], [class*="td_view" i], [class*="article_view" i], [class*="num_view" i], [class*="count_view" i]')
            if (el) views = num(el.textContent)
          }
          if (views === null && rowText) {
            // 목록 대부분이 "제목 … 작성자 … 2026.08.12. … 15" 순 — 날짜(또는 오늘 글의 시각) 뒤 첫 숫자를 조회수로 본다
            const afterDate = rowText.split(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?/)[1]
            if (afterDate) views = num(afterDate)
            if (views === null) {
              const afterTime = rowText.split(/\b\d{1,2}:\d{2}\b/)[1]
              if (afterTime) views = num(afterTime)
            }
          }

          out.push({ title, article_id: g.article_id, views, comments })
        })
        return out
      })
    } catch {}
    for (const r of rows) {
      const key = r.article_id || r.title
      if (seen.has(key) || !r.title || r.title.length < 5 || r.title.length > 100) continue
      seen.add(key)
      items.push(r)
    }
  }
  return items
}

async function observeCafes() {
  let j
  try { j = await http('/api/naver-cafe/agent/observe', 'GET') } catch { return }
  const cafe = j && j.cafe
  if (!cafe || !cafe.cafe_url) return
  try {
    log(`카페 관찰: ${cafe.name || cafe.id} — 최근 글 + 인기글 수집`)
    const page = await getPage()

    // ① 발행 게시판 최근 글
    await page.goto(cafe.cafe_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(3500 + Math.random() * 2000) // 목록이 뒤늦게 그려지는 카페(클라이언트 렌더) 대비
    const recent = await extractCafePosts(page)

    // ② 카페 인기글 페이지(신형 UI) — 없거나 실패해도 조용히 넘어간다(best-effort)
    let popular = []
    const cm = String(cafe.cafe_url || '').match(/cafe\.naver\.com\/(?:f-e\/|ca-fe\/)?cafes\/(\d+)/i)
    const clubId = cafe.club_id || cm?.[1] || null
    if (clubId) {
      try {
        await page.goto(`https://cafe.naver.com/f-e/cafes/${clubId}/popular`, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await sleep(3000 + Math.random() * 1500)
        popular = await extractCafePosts(page)
      } catch {}
    }

    /* 합치기 — 같은 글이면 is_popular 로 승격하되, 지표는 '필드 단위'로 합친다.
       ⚠️ 통째로 덮어쓰면 인기글 페이지에 조회수가 없을 때(레이아웃이 달라 자주 그렇다)
          게시판 목록에서 방금 읽은 조회·댓글이 날아가 결국 '측정 불가'가 된다. */
    const byKey = new Map()
    for (const r of recent) byKey.set(r.article_id || r.title, { ...r, is_popular: false })
    for (const r of popular.slice(0, 15)) {
      const key = r.article_id || r.title
      const prev = byKey.get(key)
      byKey.set(key, {
        ...(prev || {}),
        ...r,
        views: r.views ?? prev?.views ?? null,
        comments: r.comments ?? prev?.comments ?? null,
        is_popular: true,
      })
    }
    const items = [...byKey.values()]

    if (items.length) {
      const res = await http('/api/naver-cafe/agent/observe', 'POST', { cafe_id: cafe.id, items: items.slice(0, 40) })
      log(`  → ${res?.stored ?? 0}개 저장(새 글 ${res?.fresh ?? 0} · 인기글 ${popular.length ? Math.min(popular.length, 15) : 0} 포함) — 이 카페는 약 11시간 뒤 다시 관찰(하루 2회)`)
    } else {
      log('  → 목록에서 글을 찾지 못했습니다(다음 관찰 때 재시도)')
    }
  } catch (e) {
    log(`  관찰 실패: ${String((e && e.message) || e).slice(0, 120)}`)
  } finally {
    await closeBrowserSession()
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
      await dismissRestoreDialog(page)

      const titleEl = await firstVisible(page, TITLE_SEL, 6000)
      const bodyEl = await firstVisible(page, BODY_SEL, 6000)
      const submitEl = await firstVisible(page, SUBMIT_SEL, 6000)
      // 어떤 버튼이 잡혔는지까지 확인한다 — '임시등록'이 잡히면 글이 안 올라가고 임시저장만 된다.
      let btnText = ''
      if (submitEl) { try { btnText = (await submitEl.innerText({ timeout: 2500 })).trim().replace(/\s+/g, ' ') } catch {} }
      const btnWrong = !!submitEl && btnText !== '등록'
      /* 게시판이 선택돼 있는지 — 이게 안 되면 등록 버튼이 비활성이라 눌러도 안 올라간다.
         ⚠️ 자가검사는 "글을 절대 등록하지 않는다"가 약속이므로 읽기 전용으로만 본다(클릭 금지). */
      const board = await ensureBoardSelected(page, menuId, c.board_name || '', true)
      // 캡처는 모든 확인이 끝난 뒤에 — 보고된 상태와 이미지가 일치하도록.
      const shot = join(LOGS, `check-${String(label).replace(/[^\w가-힣]/g, '_')}.png`)
      try { await page.screenshot({ path: shot, fullPage: true }) } catch {}
      const parts = [
        `제목 ${titleEl ? 'OK' : '실패'}`,
        `본문 ${bodyEl ? 'OK' : '실패'}`,
        `등록버튼 ${submitEl ? (btnWrong ? `⚠ "${btnText || '글자 못읽음'}" 가 잡힘` : 'OK') : '실패'}`,
        `게시판 ${board.ok ? 'OK' : `⚠ ${board.detail}`}`,
      ]
      // 게시판은 발행 시 에이전트가 직접 고르므로, 여기서 미선택이어도 치명적 실패로 보지 않고 경고만 한다.
      mark(`[${label}] 글쓰기 화면`, !!titleEl && !!bodyEl && !!submitEl && !btnWrong, `${parts.join(' · ')} → ${shot}`)
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
    try { await observeCafes() } catch (e) { log('관찰 오류:', String((e && e.message) || e).slice(0, 200)) }
    await sleep(POLL)
  }
}
