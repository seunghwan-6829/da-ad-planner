// 유튜브 영상의 "직접 스트림 URL"을 서버(Vercel)에서 뽑는다. yt-dlp·로컬 PC·Apify 전부 불필요.
//
// 원리: 유튜브 앱들이 쓰는 InnerTube player API 를 그대로 호출한다. 모바일 앱 클라이언트로 부르면
//   ① 서명 복호화(cipher) 없이 재생 가능한 URL 이 그대로 오고,
//   ② "임베드 차단(playableInEmbed:false)"은 iframe 임베드에만 걸리는 제약이라 이 경로는 영향을 받지 않는다.
//      → 광고주가 임베드를 막아둔 소재도 여기서는 정상적으로 주소가 나온다.
//
// 실측(2026-07): ANDROID 클라이언트만 progressive mp4(360p, 영상+소리 한 파일)를 준다. ~160ms.
//   720p/1080p 는 영상·소리가 분리돼 있어 브라우저가 단독 재생을 못 한다(합치려면 ffmpeg 필요).
//   따라서 즉시재생은 360p, 고화질 영구본은 기존 일일 다운로더(yt-dlp 720p)가 담당하는 2단 구성.

const INNERTUBE_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' // 유튜브 웹앱에 공개된 상수(비밀 아님)

type ClientSpec = { name: string; num: number; ua: string; ctx: Record<string, unknown> }

// 순서 = 시도 순서. 앞이 실패하면 뒤로 넘어간다(유튜브가 특정 클라이언트를 막을 때 대비).
const CLIENTS: ClientSpec[] = [
  {
    name: 'ANDROID',
    num: 3,
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    ctx: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'ko', gl: 'KR' },
  },
  {
    name: 'ANDROID_ALT',
    num: 3,
    ua: 'com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip',
    ctx: { clientName: 'ANDROID', clientVersion: '19.44.38', androidSdkVersion: 30, osName: 'Android', osVersion: '11', hl: 'en', gl: 'US' },
  },
  {
    name: 'IOS',
    num: 5,
    ua: 'com.google.ios.youtube/20.11.6 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; en_US)',
    ctx: { clientName: 'IOS', clientVersion: '20.11.6', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'en', gl: 'US' },
  },
]

type Fmt = { itag?: number; url?: string; mimeType?: string; height?: number; qualityLabel?: string; contentLength?: string; audioQuality?: string }
type PlayerResp = {
  playabilityStatus?: { status?: string; reason?: string }
  streamingData?: { formats?: Fmt[]; adaptiveFormats?: Fmt[] }
  videoDetails?: { title?: string; lengthSeconds?: string }
}

export type Resolved = { url: string; itag: number; quality: string; client: string; expiresAt: number }
/** 다시 시도해도 소용없는 실패(삭제·비공개·지역차단 등)인지. 호출부가 'dead' 표시에 쓴다. */
export const isPermanentReason = (r: string) =>
  /removed|private|unavailable in your country|not available in your country|terminated|deleted|violat/i.test(r || '')

// googlevideo URL 의 만료시각(expire=유닉스초). 캐시 수명 계산에 쓴다.
function expiryOf(u: string): number {
  const m = u.match(/[?&]expire=(\d+)/)
  return m ? Number(m[1]) * 1000 : Date.now() + 60 * 60 * 1000
}

async function callPlayer(c: ClientSpec, videoId: string, signal: AbortSignal): Promise<PlayerResp | null> {
  try {
    const res = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}&prettyPrint=false`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': c.ua,
        'X-YouTube-Client-Name': String(c.num),
        'X-YouTube-Client-Version': String(c.ctx.clientVersion),
        Origin: 'https://www.youtube.com',
      },
      body: JSON.stringify({
        videoId,
        context: { client: c.ctx, user: { lockedSafetyMode: false }, request: { useSsl: true } },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    })
    if (!res.ok) return null
    return (await res.json()) as PlayerResp
  } catch {
    return null
  }
}

// 브라우저가 <video src> 로 단독 재생 가능한 포맷 = progressive(영상+소리 한 파일) mp4.
function pickPlayable(p: PlayerResp): Fmt | null {
  const prog = (p.streamingData?.formats || []).filter((f) => f.url && /video\/mp4/.test(f.mimeType || ''))
  if (prog.length) return prog.sort((a, b) => (b.height || 0) - (a.height || 0))[0]
  // mp4 progressive 가 없으면 webm progressive 라도(크롬/엣지 재생 가능).
  const any = (p.streamingData?.formats || []).filter((f) => f.url)
  return any.sort((a, b) => (b.height || 0) - (a.height || 0))[0] || null
}

const cache = new Map<string, Resolved>() // 웜 람다 내 재사용(같은 영상 반복 재생 시 InnerTube 왕복 생략)

/** 유튜브 videoId → 즉시 재생 가능한 직접 스트림 URL. 실패 시 사유와 함께 throw. */
export async function resolveYoutubeStream(videoId: string, timeoutMs = 6000): Promise<Resolved> {
  const hit = cache.get(videoId)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const reasons: string[] = []
  try {
    for (const c of CLIENTS) {
      const p = await callPlayer(c, videoId, ctrl.signal)
      if (!p) { reasons.push(`${c.name}:no-response`); continue }
      const st = p.playabilityStatus?.status
      if (st && st !== 'OK') { reasons.push(`${c.name}:${st}(${p.playabilityStatus?.reason || ''})`); continue }
      const f = pickPlayable(p)
      if (!f?.url) { reasons.push(`${c.name}:no-progressive`); continue }
      const out: Resolved = {
        url: f.url,
        itag: f.itag || 0,
        quality: f.qualityLabel || `${f.height || 0}p`,
        client: c.name,
        expiresAt: expiryOf(f.url),
      }
      cache.set(videoId, out)
      if (cache.size > 500) cache.delete(cache.keys().next().value as string)
      return out
    }
  } finally {
    clearTimeout(timer)
  }
  const err = new Error(reasons.join(' | ') || 'unknown')
  ;(err as Error & { reasons: string[] }).reasons = reasons
  throw err
}

/** 광고 레코드(poster_url/media_url)에서 유튜브 videoId 추출 — 프론트 ytIdOfAd 와 동일 규칙. */
export function ytIdFrom(...parts: (string | null | undefined)[]): string | null {
  const s = parts.filter(Boolean).join(' ')
  return (
    s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] ||
    s.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    s.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    s.match(/shorts\/([\w-]{6,})/)?.[1] ||
    null
  )
}
