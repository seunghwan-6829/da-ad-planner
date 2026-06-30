// Pulseboard 데이터 무손실 마이그레이션: 옛 Supabase(public.*) → da-ad-planner(pb_*)
// 실행: node scripts/pb-migrate.mjs
//  - 소스 자격증명: .env.pulseboard (SUPABASE_URL, SUPABASE_SERVICE_KEY)  ← 사용자가 생성(gitignore됨)
//  - 대상 자격증명: meta-ad-monitor/.env (da-ad-planner Supabase, 기존)
// 재실행 안전(PK upsert). 끝에 소스/대상 행수 대조로 무손실 검증.
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

function readEnvFile(path) {
  const out = {}
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch (e) {
    console.error(`자격증명 파일을 못 읽음: ${path}\n  → ${e.message}`)
    process.exit(1)
  }
  return out
}

const src = readEnvFile('.env.pulseboard')
const dst = readEnvFile('meta-ad-monitor/.env')
if (!src.SUPABASE_URL || !src.SUPABASE_SERVICE_KEY) { console.error('.env.pulseboard 에 SUPABASE_URL / SUPABASE_SERVICE_KEY 필요'); process.exit(1) }
if (!dst.SUPABASE_URL || !dst.SUPABASE_SERVICE_KEY) { console.error('meta-ad-monitor/.env 에 da-ad-planner Supabase 자격증명 필요'); process.exit(1) }

const source = createClient(src.SUPABASE_URL, src.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const target = createClient(dst.SUPABASE_URL, dst.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// 부모(sites) 먼저 → 자식들. 각 [소스테이블, 대상테이블, PK]
const TABLES = [
  ['sites', 'pb_sites', 'id'],
  ['analytics_events', 'pb_analytics_events', 'id'],
  ['managed_pages', 'pb_managed_pages', 'id'],
  ['secret_pages', 'pb_secret_pages', 'id'],
]
const PAGE = 1000

async function countRows(client, table) {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  if (error) throw new Error(`${table} count 실패: ${error.message}`)
  return count ?? 0
}

async function migrate(srcTable, dstTable, pk) {
  let from = 0
  let moved = 0
  for (;;) {
    const { data, error } = await source.from(srcTable).select('*').order(pk, { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw new Error(`${srcTable} 읽기 실패: ${error.message}`)
    const rows = data ?? []
    if (!rows.length) break
    const { error: upErr } = await target.from(dstTable).upsert(rows, { onConflict: pk })
    if (upErr) throw new Error(`${dstTable} upsert 실패: ${upErr.message}`)
    moved += rows.length
    process.stdout.write(`\r  ${srcTable} → ${dstTable}: ${moved}건...`)
    if (rows.length < PAGE) break
    from += PAGE
  }
  process.stdout.write('\n')
  return moved
}

;(async () => {
  console.log('=== Pulseboard 데이터 마이그레이션 시작 ===')
  console.log(`소스: ${src.SUPABASE_URL}\n대상(da-ad-planner): ${dst.SUPABASE_URL}\n`)
  const report = []
  for (const [s, d, pk] of TABLES) {
    const srcCount = await countRows(source, s)
    console.log(`• ${s}: 소스 ${srcCount}건`)
    await migrate(s, d, pk)
    const dstCount = await countRows(target, d)
    const ok = dstCount >= srcCount
    report.push({ table: `${s}→${d}`, src: srcCount, dst: dstCount, ok })
    console.log(`  ↳ 대상 ${dstCount}건  ${ok ? '✓ 무손실' : '✗ 불일치!'}`)
  }
  console.log('\n=== 검증 요약 ===')
  let allOk = true
  for (const r of report) { console.log(`  ${r.ok ? '✓' : '✗'} ${r.table}: 소스 ${r.src} / 대상 ${r.dst}`); if (!r.ok) allOk = false }
  console.log(allOk ? '\n✅ 전부 무손실 이전 완료.' : '\n⚠️ 일부 테이블 불일치 — 재실행 또는 점검 필요.')
  process.exit(allOk ? 0 : 1)
})().catch((e) => { console.error('\n마이그레이션 오류:', e.message); process.exit(1) })
