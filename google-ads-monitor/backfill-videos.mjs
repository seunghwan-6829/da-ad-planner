// 구글 광고 영상 백필 — 임베드 차단 유튜브 광고 영상을 yt-dlp 로 받아 Supabase 스토리지에 올리고
//   ga_ads.media_url 을 그 영구 URL 로 교체(→ 페이지에서 <video> 로 직접 재생).
//   구글 광고 영상은 대부분 "임베드 금지"라 iframe 재생이 안 됨 → 다운로드가 유일한 방법.
// 특징: 고유 영상 id 기준 중복 제거(같은 영상 쓰는 광고들 한 번에 갱신), 이어받기(이미 받은 건 스킵), 병렬.
// ⚠️ 유튜브 영상 다운로드는 YouTube ToS 회색지대(경쟁광고 분석용). 데이터센터 IP 차단 시 일부 실패할 수 있음(best-effort).
//
// 필수 env: SUPABASE_URL, SUPABASE_SERVICE_KEY
// 선택 env: MAX_VIDEOS(이번 실행 최대 영상 수, 0=전체), CONCURRENCY(동시 다운로드, 기본 4), YT_MAX_FILESIZE(기본 200M)

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
const execFileP = promisify(execFile)

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const MAX_VIDEOS = Number(process.env.MAX_VIDEOS) || 0
const CONCURRENCY = Number(process.env.CONCURRENCY) || 4
const YT_MAX_FILESIZE = process.env.YT_MAX_FILESIZE || '200M'
const BUCKET = 'google-ad-media'

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY 필요'); process.exit(1) }
const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
const log = (...a) => console.log('[ga-video]', ...a)

const vidId = (url) => {
  const s = String(url || '')
  return (s.match(/[?&]v=([\w-]{6,})/) || [])[1] || (s.match(/youtu\.be\/([\w-]{6,})/) || [])[1] || (s.match(/shorts\/([\w-]{6,})/) || [])[1] || null
}

// 아직 유튜브 URL(임베드) 상태인 영상 광고 행 전부 로드.
async function loadPending() {
  const out = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads')
      .select('library_id, media_url')
      .eq('media_type', 'video')
      .eq('downloaded', false)
      .ilike('media_url', '%youtu%')
      .range(off, off + 999)
    if (error) { log('로드 오류', error.message); break }
    if (!data || !data.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
async function downloadOne(id) {
  const tmp = `/tmp/gv_${id}.mp4`
  try {
    const args = [
      '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
      '--merge-output-format', 'mp4', '--max-filesize', YT_MAX_FILESIZE,
      '--no-playlist', '--no-warnings',
      // 데이터센터 IP의 "봇 확인" 차단 우회 시도: 여러 player_client 폴백(쿠키 불필요).
      '--extractor-args', 'youtube:player_client=tv,mweb,ios,android,web',
      '--user-agent', UA,
      '-o', tmp, `https://www.youtube.com/watch?v=${id}`,
    ]
    // 쿠키 시크릿(YT_COOKIES)이 있으면 파일로 저장해 사용(가장 확실한 우회).
    if (process.env.YT_COOKIES_FILE) { args.push('--cookies', process.env.YT_COOKIES_FILE) }
    await execFileP('yt-dlp', args, { timeout: 150000, maxBuffer: 1024 * 1024 * 64 })
  } catch (e) {
    // 실제 원인 파악을 위해 stderr 끝부분(진짜 에러 메시지)을 로그.
    const err = String((e && (e.stderr || e.message)) || e).replace(/\s+/g, ' ').slice(-260)
    log('yt-dlp 실패', id, err)
    return null
  }
  try {
    const buf = await readFile(tmp).catch(() => null)
    await unlink(tmp).catch(() => {})
    if (!buf || !buf.length) return null
    const path = `youtube/${id}.mp4`
    const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'video/mp4', upsert: true })
    if (error) { log('업로드 실패', error.message); return null }
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    log('저장 실패', String(e.message || e).slice(0, 100))
    return null
  }
}

async function main() {
  const pending = await loadPending()
  const byVid = new Map()
  for (const r of pending) {
    const id = vidId(r.media_url)
    if (!id) continue
    if (!byVid.has(id)) byVid.set(id, [])
    byVid.get(id).push(r.library_id)
  }
  let ids = [...byVid.keys()]
  if (MAX_VIDEOS > 0) ids = ids.slice(0, MAX_VIDEOS)
  log(`미다운로드 영상행 ${pending.length} → 고유 영상 ${byVid.size}개, 이번 처리 ${ids.length}개 (동시 ${CONCURRENCY})`)
  if (!ids.length) { log('받을 영상이 없습니다.'); return }

  let i = 0, done = 0, fail = 0
  async function worker() {
    while (i < ids.length) {
      const id = ids[i++]
      const url = await downloadOne(id)
      if (url) {
        try { await sb.from('ga_ads').update({ media_url: url, downloaded: true, media_path: `youtube/${id}.mp4` }).in('library_id', byVid.get(id)) } catch {}
        done++
      } else {
        fail++
      }
      if ((done + fail) % 10 === 0) log(`진행 ${done + fail}/${ids.length} (성공 ${done}, 실패 ${fail})`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  log(`완료: 성공 ${done} / 실패 ${fail} / 대상 ${ids.length} (실패분은 다시 실행 시 이어받음)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
