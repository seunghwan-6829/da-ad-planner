// 재생불가(dead)로 잘못 표시된 광고를 지금 바로 복구한다.
//   일일 다운로더(download-local.mjs)가 돌 때도 자동으로 같은 일을 하지만, 즉시 되돌리고 싶을 때 쓴다.
//   실행: node revive-dead.mjs   (또는 revive-dead.bat)
//   ⚠️ 가정용 인터넷에서 실행해야 한다(데이터센터 IP 는 유튜브가 봇으로 막는다).

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { reviveWronglyDead } from './yt-check.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
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
  console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 를 찾을 수 없습니다.')
  process.exit(1)
}
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

const log = (...a) => console.log('[revive]', ...a)
log('재생불가로 표시된 광고를 유튜브에 한 건씩 확인합니다…')
const r = await reviveWronglyDead(sb, { log })
log(`완료 — 재검사 ${r.checked} / 복구 ${r.revived} / 진짜 재생불가 ${r.gone} / 확인보류 ${r.unknown}`)
if (r.unknown) log('확인보류分은 유튜브가 잠시 요청을 제한한 것뿐입니다. 잠시 뒤 다시 실행하면 이어서 복구됩니다.')
