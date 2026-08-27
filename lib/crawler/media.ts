/* 크롤러·제작 화면이 공유하는 미디어 URL 유틸.

   왜 모았나(2026-08-12 전수 점검): 같은 이름의 함수가 페이지마다 따로 있었고 동작이 서로 달랐다.
     · youtubeEmbed  — 3종. 그중 production-list 버전은 유튜브 도메인 검사가 없어
                        "/shorts/" 나 "/embed/" 가 들어간 남의 URL 도 유튜브 영상으로 잘못 임베드했다.
     · instagramEmbed — 2종(도메인 검사 유무가 달랐다).
   → 가장 엄격한 구현(도메인 확인 + playsinline)으로 통일한다. */

/** 유튜브 URL → 임베드 URL. 유튜브가 아니면 null(우리 스토리지 mp4 등은 그대로 <video> 로 재생). */
export function youtubeEmbed(url: string | null | undefined): string | null {
  const s = String(url || '')
  // ⚠️ 도메인 확인이 먼저다 — 이게 없으면 "/shorts/" 가 들어간 아무 URL 이나 유튜브로 잡힌다.
  if (!/(?:^|\/\/|\.)(?:youtube\.com|youtu\.be)/i.test(s)) return null
  const id =
    s.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    s.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    s.match(/shorts\/([\w-]{6,})/)?.[1] ||
    s.match(/embed\/([\w-]{6,})/)?.[1] ||
    null
  return id ? `https://www.youtube.com/embed/${id}?playsinline=1` : null
}

/** 인스타 릴스/게시물 URL → 임베드 URL. 인스타가 아니면 null. */
export function instagramEmbed(url: string | null | undefined): string | null {
  const s = String(url || '')
  if (!/instagram\.com/i.test(s)) return null
  const code = s.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/)?.[1]
  return code ? `https://www.instagram.com/reel/${code}/embed/` : null
}

/** 목록 썸네일로 쓸 이미지 — 포스터 → 캐러셀 첫 장 → 미디어 순. */
export function posterThumb(ad: { poster_url?: string | null; media_urls?: unknown; media_url?: string | null }): string | null {
  const carousel = Array.isArray(ad.media_urls) ? (ad.media_urls as unknown[])[0] : null
  return ad.poster_url || (typeof carousel === 'string' ? carousel : null) || ad.media_url || null
}

/** ISO 날짜 → YYYY-MM-DD (파싱 실패하면 원문 그대로). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toISOString().slice(0, 10)
}
