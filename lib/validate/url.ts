/* URL 검증 — 데이터 추적(pb)의 사이트·페이지 주소 입력에 쓴다.

   왜 모았나: 같은 함수가 6개 라우트에 복제돼 있었고, 전부 `new URL(v)` 성공 여부만 봤다.
   그 검사는 스킴을 보지 않아 `javascript:alert(1)`, `data:text/html,...`, `file:///...` 이 전부 통과한다.
   이 값들은 화면에서 링크(href)로 렌더되므로, 통과시키면 클릭 시 스크립트가 도는 통로가 된다.
   → http/https 만 허용하도록 좁혔다(정상 사이트 주소는 전부 이 둘이다). */
export function isValidUrl(value: string): boolean {
  const raw = String(value ?? '').trim()
  if (!raw) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  // 호스트가 없는 http:/// 같은 형태 차단
  return !!u.hostname
}
