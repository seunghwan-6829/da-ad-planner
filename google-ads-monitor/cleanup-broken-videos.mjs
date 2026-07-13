// 재생 불가 영상 광고 정리 — 구글이 원본을 막아 재생수단이 전혀 없는 VIDEO(poster·영상주소·유튜브ID 모두 없음)를 ga_ads 에서 삭제.
//   기본은 드라이런(대상만 집계·표시). 실제 삭제는  node cleanup-broken-videos.mjs --apply
//   실행: google-ads-monitor 폴더에서. 자격증명은 .env → ../meta-ad-monitor/.env 순서로 읽음.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
function loadEnv(p) { try { const o = {}; for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) { const s = l.trim(); if (!s || s.startsWith('#')) continue; const i = s.indexOf('='); if (i < 0) continue; o[s.slice(0, i).trim()] = s.slice(i + 1).trim().replace(/^["']|["']$/g, '') } return o } catch { return {} } }
let URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY
for (const p of [join(HERE, '.env'), join(HERE, '..', 'meta-ad-monitor', '.env')]) { if (URL_ && KEY) break; if (existsSync(p)) { const e = loadEnv(p); URL_ ||= e.SUPABASE_URL; KEY ||= e.SUPABASE_SERVICE_KEY } }
if (!URL_ || !KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 없음'); process.exit(1) }
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

const APPLY = process.argv.includes('--apply')
const ytId = (a) => { const s = `${a.poster_url || ''} ${a.media_url || ''}`; return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] || s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1] || s.match(/shorts\/([\w-]{6,})/)?.[1] || null }
const isStored = (u) => /\/storage\/v1\/object\//.test(u || '')

// 전수 로드 후 "재생수단 0" 판정
let all = []
for (let o = 0; ; o += 1000) {
  const { data, error } = await sb.from('ga_ads').select('library_id,page_name,media_type,media_url,poster_url,video_src_url,media_urls').eq('media_type', 'video').range(o, o + 999)
  if (error) { console.error(error.message); process.exit(1) }
  if (!data?.length) break
  all = all.concat(data); if (data.length < 1000) break
}
const broken = all.filter((a) => !isStored(a.media_url) && !ytId(a) && !a.video_src_url && !(a.media_urls && a.media_urls.length) && !a.poster_url)

const byBrand = {}
for (const a of broken) byBrand[a.page_name] = (byBrand[a.page_name] || 0) + 1
console.log(`영상 광고 ${all.length}개 중 재생수단 0(삭제 대상): ${broken.length}개`)
console.log('브랜드별:', Object.entries(byBrand).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${v}`).join(' · '))

if (!broken.length) { console.log('삭제할 대상이 없습니다.'); process.exit(0) }
if (!APPLY) { console.log('\n[드라이런] 실제 삭제하려면:  node cleanup-broken-videos.mjs --apply'); process.exit(0) }

// 실삭제(1000개씩)
let deleted = 0
for (let i = 0; i < broken.length; i += 500) {
  const ids = broken.slice(i, i + 500).map((a) => a.library_id)
  const { error } = await sb.from('ga_ads').delete().in('library_id', ids)
  if (error) { console.error('삭제 오류:', error.message); break }
  deleted += ids.length
  console.log(`  삭제 ${deleted}/${broken.length}…`)
}
console.log(`완료: ${deleted}개 삭제`)
