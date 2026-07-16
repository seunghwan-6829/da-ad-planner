// 네이버 카페 초안/댓글 생성(리뉴얼 generator.py 포팅). 순수 Anthropic HTTP.
// draftPost: 발행처(페르소나/주제/강조어) + 토픽 → (제목, 본문) 단일 후보.
// draftComment: 원글 제목/발췌 → 권위형 댓글 1건.

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'

const SYSTEM = `당신은 네이버 카페에서 오래 활동한 자연스러운 회원입니다.
광고·홍보 티가 전혀 나지 않게, 실제 경험과 정보를 나누듯 진솔하게 존댓말로 씁니다.
과장·낚시·반복 CTA·마케팅 문구를 쓰지 않고, 정직한 후킹(구체적 숫자·결과·교훈)만 사용합니다.`

export interface DraftCafe {
  name: string
  persona?: string
  topics?: string
  notes?: string
  emphasis?: string[]
  selling_point?: string
  rules?: { promo_banned?: boolean; notes?: string } | null
}

async function callClaude(apiKey: string, model: string, maxTokens: number, prompt: string): Promise<string> {
  const r = await fetch(ANTHROPIC_BASE, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error?.message || `Anthropic ${r.status}`)
  return (j?.content?.[0]?.text || '').toString()
}

// 첫 비어있지 않은 줄 = 제목, 나머지 = 본문(generator._split_title_body 포팅).
function splitTitleBody(text: string): { title: string; body: string } {
  const lines = text.replace(/\r/g, '').split('\n')
  let ti = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { ti = i; break }
  }
  if (ti < 0) return { title: '', body: text.trim() }
  let title = lines[ti].trim()
  // 제목에서 흔한 접두 제거
  title = title.replace(/^(제목\s*[:：]\s*)/, '').replace(/^#+\s*/, '').replace(/^["'“”]|["'“”]$/g, '').trim()
  const body = lines.slice(ti + 1).join('\n').trim()
  return { title: title.slice(0, 120), body: (body || title).slice(0, 4000) }
}

export async function draftPost(
  apiKey: string,
  cafe: DraftCafe,
  topic: string,
  model = 'claude-sonnet-4-6',
  maxTokens = 2000,
): Promise<{ title: string; body: string }> {
  const emphasis = (cafe.emphasis || []).filter(Boolean)
  const promoBanned = cafe.rules?.promo_banned
  const prompt = `아래 카페에 올릴 글 초안을 작성해 주세요. 목표는 "스크롤을 멈추게 하는 자연스러운 글"입니다.

[카페] ${cafe.name}
[내 활동 페르소나(이 인물이 쓴 것처럼)] ${cafe.persona || '자연스러운 일반 회원'}
[이 카페에서 주로 다루는 주제] ${cafe.topics || '(자유 — 카페 성격에 맞게)'}
[이번 글 토픽] ${topic || '(토픽 자유 선택)'}
${cafe.selling_point ? `[궁극적으로 쌓아야 할 것(은근히)] ${cafe.selling_point}` : ''}
${emphasis.length ? `[본문에서 자연스럽게 강조(**볼드**)할 키워드] ${emphasis.join(', ')}` : ''}
[주의사항] ${cafe.notes || '(없음)'}${promoBanned ? ' / 이 카페는 홍보 금지 — 절대 상업적 표현 금지' : ''}

[작성 형식 — 반드시 지킬 것]
- 1번째 줄: 제목만. 18~35자. 구체적 숫자·결과·손해/이득 중 하나를 넣어 호기심 갭 만들기. 뻔한 "~하는 방법 정리" 금지, 낚시(내용 불일치) 금지.
- 2번째 줄부터: 본문. 400~550자. 한 문장을 한 줄로. 의미 단위로 빈 줄(\n\n)로 문단 구분. 3~5곳을 **볼드**로 강조.
- 첫 1~2줄은 결론/충격 포인트부터. 인사말·자기소개로 시작 금지.
- 실제로 써먹을 수 있는 구체 팁(숫자·예시·순서) 포함. 두루뭉술 금지.
- 커뮤니티 회원이 쓴 자연스러운 글. 광고티·과장·반복 CTA 금지. 존댓말.
- 마크다운은 **볼드**만 허용(제목/목록기호 # * - 금지). 일반 텍스트로.`
  const text = await callClaude(apiKey, model, maxTokens, prompt)
  return splitTitleBody(text)
}

export async function draftComment(
  apiKey: string,
  cafe: DraftCafe,
  postTitle: string,
  postExcerpt: string,
  model = 'claude-sonnet-4-6',
  maxTokens = 800,
): Promise<string> {
  const prompt = `아래 원글에 달 댓글을 작성해 주세요. 권위·신뢰를 쌓는 자연스러운 댓글입니다.

[카페] ${cafe.name}
[내 활동 페르소나] ${cafe.persona || '자연스러운 일반 회원'}
[원글 제목] ${postTitle}
[원글 발췌] ${(postExcerpt || '').slice(0, 400)}

[규칙]
- 2~4문장. 원글 내용을 한 번 짚고(공감/보완), 실제로 도움 되는 팁 하나를 더해 주세요.
- 광고티·홍보·링크 금지. 존댓말. 자연스러운 커뮤니티 댓글 톤.
- 댓글 본문만 출력(따옴표·머리말 없이).`
  const text = await callClaude(apiKey, model, maxTokens, prompt)
  return text.trim().replace(/^["'“”]|["'“”]$/g, '').slice(0, 1000)
}
