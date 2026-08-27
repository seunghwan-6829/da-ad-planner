import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
for (const line of fs.readFileSync('C:/Users/user/Desktop/da-ad-planner-main/meta-ad-monitor/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
}
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

// 프론트의 ytId 추출과 동일 로직(poster+media 만 사용)
const ytIdFront = (a) => {
  const s = `${a.poster_url || ''} ${a.media_url || ''}`
  return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] || s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1] || s.match(/shorts\/([\w-]{6,})/)?.[1] || null
}
// 다른 필드까지 뒤지면 복구되는지
const ytIdFull = (a) => {
  const s = `${a.poster_url || ''} ${a.media_url || ''} ${a.video_src_url || ''} ${a.source_url || ''} ${(a.media_urls || []).join(' ')}`
  return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] || s.match(/[?&]v=([\w-]{6,})/)?.[1] || s.match(/youtu\.be\/([\w-]{6,})/)?.[1] || s.match(/shorts\/([\w-]{6,})/)?.[1] || s.match(/embed\/([\w-]{6,})/)?.[1] || s.match(/googlevideo\.com/)?.[0] || null
}

let all = []
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from('ga_ads').select('library_id,page_name,media_type,media_url,poster_url,media_urls,video_src_url,source_url,format,downloaded,media_path').eq('media_type', 'video').range(off, off + 999)
  if (!data?.length) break
  all = all.concat(data); if (data.length < 1000) break
}
const stored = all.filter(a => /\/storage\/v1\/object\//.test(a.media_url || ''))
const pending = all.filter(a => !/\/storage\/v1\/object\//.test(a.media_url || ''))
const noFrontId = pending.filter(a => !ytIdFront(a))
const rescuable = noFrontId.filter(a => ytIdFull(a))
console.log(`영상 광고 ${all.length} · 저장완료 ${stored.length} · 미저장 ${pending.length}`)
console.log(`재생불가("영상정보 없음") = 프론트 ID추출 실패: ${noFrontId.length}개`)
console.log(`  └ 그중 다른 필드로 복구가능: ${rescuable.length}개`)
console.log(`\n재생불가 예시 8개 (어떤 필드에 뭐가 있나):`)
for (const a of noFrontId.slice(0, 8)) {
  console.log(`- ${a.page_name} | fmt=${a.format} | poster=${(a.poster_url||'').slice(0,45)} | media=${(a.media_url||'').slice(0,45)} | src=${(a.video_src_url||'').slice(0,55)} | urls=${(a.media_urls||[]).length}`)
}
// format 분포
const fmt = {}; for (const a of noFrontId) fmt[a.format||'(null)'] = (fmt[a.format||'(null)']||0)+1
console.log('\n재생불가 광고 format 분포:', JSON.stringify(fmt))
