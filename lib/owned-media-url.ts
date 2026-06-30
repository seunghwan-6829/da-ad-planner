// 크리에이터 입력(URL/핸들)을 관대하게 파싱 + 정규화 + 검증.
//   - 받아주는 것: 전체 URL, https 없는 주소, m.youtube/모바일, 뒤따르는 ?파라미터, 맨앞 @핸들
//   - 막는 것(에러 반환): 게시물/릴스/영상 링크, 못 알아보는 주소 → 사용자에게 친절한 안내
// 순수 함수(서버/클라 어디서나). 크롤러는 정규화된 url/handle 을 그대로 쓰면 안정적.

export type ParsedCreator =
  | { ok: true; platform: 'youtube' | 'instagram'; handle: string; url: string }
  | { ok: false; error: string }

export function parseCreatorUrl(raw: string): ParsedCreator {
  const s = (raw || '').trim()
  if (!s) return { ok: false, error: 'URL(또는 핸들)을 입력해주세요.' }

  // 도메인 없이 '@핸들'만 → 유튜브로 간주(@ 는 유튜브 핸들 관례)
  if (/^@[\w.\-가-힣]+$/.test(s)) {
    const h = s.slice(1)
    return { ok: true, platform: 'youtube', handle: h, url: `https://www.youtube.com/@${h}` }
  }

  let host = ''
  let path = ''
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
    path = u.pathname
  } catch {
    return { ok: false, error: '주소 형식을 인식하지 못했어요. 채널/프로필 URL을 확인해주세요. (예: youtube.com/@핸들)' }
  }

  // ── 인스타그램 ──
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const seg = path.split('/').filter(Boolean)
    if (!seg.length) {
      return { ok: false, error: '인스타 프로필 주소를 넣어주세요. (예: instagram.com/핸들)' }
    }
    const first = seg[0].replace(/^@/, '').toLowerCase()
    const reserved = ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 's']
    if (reserved.includes(first)) {
      return { ok: false, error: '이건 게시물/릴스 링크예요. 크리에이터 "프로필" 주소를 넣어주세요. (예: instagram.com/핸들)' }
    }
    return { ok: true, platform: 'instagram', handle: first, url: `https://www.instagram.com/${first}` }
  }

  // ── 유튜브 ──
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtu.be') {
    // 영상/공유 링크는 채널이 아님
    if (host === 'youtu.be' || /\/watch|\/shorts\/[\w-]+/.test(path) || /[?&]v=/.test(s)) {
      return { ok: false, error: '이건 영상 링크예요. 채널 주소를 넣어주세요. (예: youtube.com/@핸들)' }
    }
    const at = path.match(/\/@([^/?#]+)/)
    if (at) return { ok: true, platform: 'youtube', handle: decodeURIComponent(at[1]), url: `https://www.youtube.com/@${at[1]}` }
    const ch = path.match(/\/(channel|c|user)\/([^/?#]+)/)
    if (ch) return { ok: true, platform: 'youtube', handle: decodeURIComponent(ch[2]), url: `https://www.youtube.com/${ch[1]}/${ch[2]}` }
    return { ok: false, error: '유튜브 채널 주소를 인식하지 못했어요. (예: youtube.com/@핸들)' }
  }

  return { ok: false, error: '유튜브 또는 인스타그램 주소만 지원해요. (예: youtube.com/@핸들, instagram.com/핸들)' }
}
