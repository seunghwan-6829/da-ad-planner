// 인스타 릴스 원본 mp4 URL 추출 — 임베드 페이지(공개)에서 videoUrl 을 파싱한다.
// 임베드(iframe) 플레이어는 타임라인 바가 없어 탐색이 불가 → 이 URL 로 네이티브 <video> 재생(타임라인 O),
// Whisper 대본 추출에도 사용. ⚠️ CDN 서명 URL 이라 며칠 뒤 만료 — 저장하지 말고 매번 추출(수백 ms).
// ⚠️ 서버 전용(fetch to instagram.com) — 클라이언트에서 import 금지.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export async function extractIgVideoUrl(shortCode: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(shortCode)) return null
  for (const path of [`reel/${shortCode}/embed/`, `p/${shortCode}/embed/captioned/`]) {
    try {
      const r = await fetch(`https://www.instagram.com/${path}`, {
        headers: { 'user-agent': UA, 'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8' },
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
      })
      if (!r.ok) continue
      const html = await r.text()
      const m = html.match(/"videoUrl":"([^"]+)"/) || html.match(/property="og:video"\s+content="([^"]+)"/)
      if (!m) continue
      const url = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&')
      if (/^https:\/\//.test(url)) return url
    } catch {
      // 다음 경로 시도
    }
  }
  return null
}

// om_posts.post_id('ig_<shortCode>') 또는 게시물 URL 에서 shortCode 추출
export function igShortCodeOf(postId?: string | null, postUrl?: string | null): string | null {
  if (postId && postId.startsWith('ig_')) return postId.slice(3)
  const m = (postUrl || '').match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/)
  return m ? m[1] : null
}
