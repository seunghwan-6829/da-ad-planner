// 영상이 "정말로" 재생 불가인지 유튜브에 직접 확인한다.
//
// 왜 필요한가: yt-dlp 의 stderr 문자열만 보고 'dead'(영구실패)로 찍으면 오탐이 크다.
//   실측(2026-07): dead 로 찍힌 1,705건을 전수 재검사했더니 1,687건(98.9%)이 실제로는 멀쩡했다.
//   범인은 유튜브가 간헐적으로 뱉는 "Video unavailable. This content is not available on this app"
//   — 앱/토큰 사정의 일시 오류인데 영구실패 패턴에 걸려 있었다.
//   한 번 dead 로 찍히면 다음부터 아예 대상에서 빠지므로 영구히 안 받아지는 광고가 됐다.
//
// 그래서 dead 로 찍기 전에 InnerTube player API 로 한 번 더 물어본다(~0.2초).
//   ※ 가정용 IP 에서만 통한다. 데이터센터(Vercel/GitHub Actions) IP 는 봇 확인에 걸린다 — 실측 확인함.
//     이 파일은 사장님 PC 에서 도는 스크립트 전용이라 문제 없다.

const IKEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' // 유튜브 웹앱 공개 상수(비밀 아님)
const CTX = { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'ko', gl: 'KR' }

/** 유튜브에 물어본 재생 가능 상태. 'OK' | 'GONE' | 'UNKNOWN'(판단 보류 — dead 로 찍지 말 것) */
export async function ytPlayability(videoId, tries = 2) {
  for (let t = 0; t < tries; t++) {
    try {
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${IKEY}&prettyPrint=false`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
          'X-YouTube-Client-Name': '3',
          'X-YouTube-Client-Version': '20.10.38',
          Origin: 'https://www.youtube.com',
        },
        body: JSON.stringify({ videoId, context: { client: CTX, user: { lockedSafetyMode: false }, request: { useSsl: true } }, contentCheckOk: true, racyCheckOk: true }),
      })
      const j = await r.json()
      const st = j?.playabilityStatus?.status
      if (!st) continue
      if (st === 'OK') return 'OK'
      // 봇 확인/로그인 요구는 "우리 쪽 사정"이지 영상이 죽은 게 아니다 → 판단 보류.
      if (st === 'LOGIN_REQUIRED' || st === 'AGE_VERIFICATION_REQUIRED') return 'UNKNOWN'
      // ERROR / UNPLAYABLE = 삭제·비공개·차단. 진짜 죽음.
      return 'GONE'
    } catch {}
    await new Promise((s) => setTimeout(s, 400))
  }
  return 'UNKNOWN'
}

/** dead 로 찍어도 되는가? 유튜브가 GONE 이라고 답할 때만 true. */
export async function confirmDead(videoId) {
  return (await ytPlayability(videoId)) === 'GONE'
}

/**
 * 과거에 잘못 dead 로 찍힌 광고를 되살린다(유튜브가 OK 라고 답하는 것만).
 * 하루 한 번 다운로더가 돌 때 자동 실행 → 오탐이 쌓이지 않는다.
 */
export async function reviveWronglyDead(sb, { log = console.log, limit = 4000, concurrency = 6 } = {}) {
  const rows = []
  for (let off = 0; off < limit; off += 1000) {
    const { data, error } = await sb
      .from('ga_ads').select('library_id, poster_url, media_url')
      .eq('media_type', 'video').eq('media_path', 'dead')
      .range(off, off + 999)
    if (error || !data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  if (!rows.length) return { checked: 0, revived: 0 }

  const idOf = (r) => {
    const s = `${r.poster_url || ''} ${r.media_url || ''}`
    return s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] || s.match(/[?&]v=([\w-]{6,})/)?.[1] || null
  }
  const revive = []
  let idx = 0
  const worker = async () => {
    while (idx < rows.length) {
      const r = rows[idx++]
      const id = idOf(r)
      if (!id) continue
      if ((await ytPlayability(id)) === 'OK') revive.push(r.library_id)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))

  for (let i = 0; i < revive.length; i += 100) {
    const chunk = revive.slice(i, i + 100)
    try { await sb.from('ga_ads').update({ media_path: null }).in('library_id', chunk) } catch {}
  }
  if (revive.length) log(`잘못 재생불가로 표시됐던 광고 ${revive.length}건 복구 (재검사 ${rows.length}건)`)
  return { checked: rows.length, revived: revive.length }
}
