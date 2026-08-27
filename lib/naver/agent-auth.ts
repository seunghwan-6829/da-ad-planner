/* 로컬 워커(에이전트) 전용 인증 — /api/naver-cafe/agent/* 가 공유한다.

   왜 모았나: 같은 함수가 7개 라우트에 복제돼 있었다(next·result·observe·preview·targets·track·agent).
   지금은 전부 동작이 같지만, 나중에 정책을 조이려 할 때(예: 토큰 필수화, 레이트 리밋)
   한 곳만 고치고 나머지를 놓치면 그 라우트만 조용히 열려 있게 된다.

   ⚠️ NC_AGENT_TOKEN 이 비어 있으면 개방된다 — 로컬 개발 편의를 위한 의도된 폴백이지만,
      운영(Vercel)에서는 반드시 설정해야 한다. 미설정 시 에이전트 엔드포인트가 인터넷에 열린다. */
export function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true // 토큰 미설정(로컬) → 개방
  return req.headers.get('x-agent-token') === need
}

/** 운영에서 토큰이 비어 있는지 — 화면·점검에서 경고를 띄우는 용도. */
export function agentTokenConfigured(): boolean {
  return !!(process.env.NC_AGENT_TOKEN || '').trim()
}
