// 크론(GitHub Actions) 전용 엔드포인트 보호. CRON_SECRET 미설정 시 개방(기존 동작 유지).
// 설정 시 헤더 x-cron-secret 또는 쿼리 ?key= 로 검증.
export function cronAuthOk(req: Request): boolean {
  const need = process.env.CRON_SECRET || ''
  if (!need) return true
  try {
    const k = new URL(req.url).searchParams.get('key')
    return req.headers.get('x-cron-secret') === need || k === need
  } catch {
    return req.headers.get('x-cron-secret') === need
  }
}
