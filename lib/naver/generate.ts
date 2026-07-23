// 네이버 카페 초안/댓글 생성 — "진짜 카페 회원이 쓴 글"이 목표.
// draftPost: 발행처(페르소나/주제/강조어) + 토픽 → (제목, 본문) 단일 후보.
// draftComment: 원글 제목/발췌 → 사람 냄새 나는 댓글 1건.
//
// 설계 철학(중요): 여긴 "브랜드가 정보성 콘텐츠를 발행"하는 곳이 아니다.
//   평범한 회원이 폰으로 질문/고민/경험을 툭 던지는 글이라야 댓글·소통이 붙는다.
//   그래서 통계·"~하는 이유/방법"·볼드·완벽한 구조 같은 'AI·마케팅 티'를 전부 금지한다.
//   후킹은 "낚시"가 아니라 "어 나도 궁금했는데 / 나도 답해주고 싶다"는 공감에서 나온다.

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'

const SYSTEM = `너는 네이버 카페에 글 쓰는 평범한 회원이야. 블로거도, 마케터도, 전문가도 아니야.
지금 폰으로 카페에 글 하나 올리는 상황이고, 뭘 "정리해서 알려주려는" 게 아니라
내 상황·고민·궁금한 걸 그냥 툭 털어놓는 거야. 읽는 사람이 "어 나도" 하면서 댓글 달고 싶게.

절대 하지 마(AI·마케팅 냄새):
- 숫자·통계로 후킹하는 제목 (예: "매출 23% 떨어진 이유", "전환율 2배 된 후기")
- "~하는 방법", "~하는 이유", "총정리", "핵심 정리" 같은 정보성/블로그 제목
- 볼드(**), 번호 목록, 머리기호(-, ·), "결론부터 말하면", "핵심은", "도움이 되셨길"
- 지나치게 매끄럽고 완벽한 문장, 과한 정중함, 이모지 도배, 광고 냄새

꼭 해(사람 냄새):
- 구어체. "~더라구요", "~같아요", "근데", "아 그리고", "혹시" 같은 말맛.
- ㅠㅠ ㅜㅜ ㅋㅋ ... ? 를 자연스럽게(과하지 않게 한두 개).
- 짧아도 돼. 완벽하게 안 써도 돼. 진짜 사람이 급하게 쓴 느낌이 제일 중요.
- 끝은 열린 질문으로 — 그래야 댓글이 붙는다.`

// 글 유형(아키타입). 정보성 '앵글' 대신, 실제로 댓글이 붙는 커뮤니티 글의 형태.
export interface Archetype { key: string; desc: string }
export const POST_ARCHETYPES: Archetype[] = [
  {
    key: '추천요청',
    desc: '"OO 어디서 하세요? 추천 좀 부탁드려요ㅠ" — 뭔가 필요한데 어디가 좋은지 몰라 물어보는 글. ' +
      '본문에 특정 브랜드/업체/서비스 이름 직접 언급 절대 금지(순수하게 물어보기만). 사람들이 추천 댓글을 달게 만든다.',
  },
  {
    key: '고민상담',
    desc: '"이거 저만 이런가요…? 요즘 너무 고민이에요ㅠ" — 겪고 있는 고민·막막함을 솔직하게 털어놓고 공감과 조언을 구하는 글.',
  },
  {
    key: '가벼운경험',
    desc: '"저 이거 해봤는데 솔직후기…" — 대단한 성공담 말고 평범한 개인 경험을 툭. 자랑·광고 톤 절대 금지, 애매했던 부분도 솔직하게. 끝에 "다들 어떠셨어요?"로 연다.',
  },
  {
    key: '질문',
    desc: '"다들 이거 어떻게 하세요?" — 남들은 어떻게 하는지 궁금해서 묻는 글. 내 방식도 살짝 곁들이고 "이게 맞나 싶어서요"로 연다.',
  },
  {
    key: '가벼운의견',
    desc: '"이거 저만 별로예요?ㅋㅋ" — 가볍게 의견/불만을 던지고 다들 어떻게 생각하는지 묻는 글. 진지한 논평 톤 금지, 수다 떨듯이.',
  },
]

function pickArchetype(key?: string): Archetype {
  if (key) { const f = POST_ARCHETYPES.find((a) => a.key === key); if (f) return f }
  return POST_ARCHETYPES[Math.floor(Math.random() * POST_ARCHETYPES.length)]
}

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

// 남아있을 수 있는 마크다운/머리기호를 걷어낸다(네이버 에디터는 마크다운을 파싱하지 않아 그대로 별표가 찍힌다).
function stripMarkup(s: string): string {
  // 네이버 에디터는 마크다운을 파싱하지 않으니 별표/머리기호가 그대로 찍힌다. 생성 자체를 막지만
  // 혹시 남아도 걷어낸다. 단, 본문 내용을 훼손하지 않도록 보수적으로만(예: "2024. 3월" 같은 건 건드리지 않음).
  return s
    .replace(/\*\*(.*?)\*\*/g, '$1')            // **볼드** → 볼드
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|$|[.,!?])/g, '$1$2') // *이탤릭*/_강조_
    .replace(/^#{1,6}\s+/gm, '')                 // # 헤딩
    .replace(/^\s*[-*·▪●]\s+/gm, '')              // 줄머리 목록 기호만
    .trim()
}

// 첫 비어있지 않은 줄 = 제목, 나머지 = 본문.
function splitTitleBody(text: string): { title: string; body: string } {
  const lines = text.replace(/\r/g, '').split('\n')
  let ti = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) { ti = i; break }
  }
  if (ti < 0) return { title: '', body: stripMarkup(text) }
  let title = lines[ti].trim()
  // 제목에서 흔한 접두/따옴표 제거
  title = title.replace(/^(제목\s*[:：]\s*)/, '').replace(/^#+\s*/, '').replace(/^["'“”]|["'“”]$/g, '').trim()
  const body = stripMarkup(lines.slice(ti + 1).join('\n'))
  return { title: title.slice(0, 120), body: (body || title).slice(0, 4000) }
}

export interface DraftOpts {
  avoidTitles?: string[]   // 최근 제목들 — 주제·톤 겹침 방지
  archetypeKey?: string    // 유형 고정(없으면 랜덤). 병렬 생성 시 유형을 분산시키려고 쓴다.
}

export async function draftPost(
  apiKey: string,
  cafe: DraftCafe,
  topic: string,
  model = 'claude-sonnet-4-6',
  maxTokens = 1600,
  opts: DraftOpts = {},
): Promise<{ title: string; body: string }> {
  const emphasis = (cafe.emphasis || []).filter(Boolean)
  const promoBanned = cafe.rules?.promo_banned
  const arch = pickArchetype(opts.archetypeKey)
  const avoid = (opts.avoidTitles || []).filter(Boolean).slice(0, 15)

  const prompt = `네이버 카페 "${cafe.name}"에 올릴 글을 써줘. 진짜 회원이 쓴 것 같은, 댓글이 달리고 싶어지는 글.

[내가 어떤 사람인지] ${cafe.persona || '이 카페에 종종 들르는 평범한 회원'}
[이 카페 분위기·주제] ${cafe.topics || '(카페 성격에 맞게 자연스럽게)'}
[이번 글 소재] ${topic || '(카페 성격에 맞는 걸로 알아서 하나)'}
[이번 글 유형] ${arch.key} — ${arch.desc}
${cafe.selling_point ? `[은근히 깔아둘 맥락(대놓고 홍보 절대 금지)] ${cafe.selling_point}\n  → 이건 본문에서 절대 직접 말하지 마. 그냥 이 주제에 자연스럽게 관심 있는 사람 정도의 결로만 배어나오게.` : ''}
${emphasis.length ? `[대화에 자연스럽게 스밀 단어(볼드 금지, 억지로 넣지 말 것)] ${emphasis.join(', ')}` : ''}
[주의] ${cafe.notes || '(없음)'}${promoBanned ? ' / 이 카페는 홍보 금지 — 상업적 표현·브랜드 언급 일절 금지' : ''}
${avoid.length ? `[최근에 쓴 제목들 — 주제·톤 겹치지 않게] ${avoid.join(' / ')}` : ''}

[제목 — 여기가 제일 중요]
- 진짜 사람이 폰으로 급하게 친 것처럼. 짧게(10~28자).
- "어 나도 궁금했는데" 또는 "나도 답해주고 싶다" 싶게. 정보 제목이 아니라 사람 말투로.
- ㅠㅠ ? ... 같은 거 하나쯤 자연스럽게 써도 됨.
- 금지: 숫자·통계(23%, 2배, 80% 등), "~하는 이유/방법/후기 정리", "제목: 부제" 형태, 매끈한 정보성 제목.
  나쁜 예) 상세페이지 바꾸고 매출 23% 떨어진 이유
  좋은 예) 상세페이지 업체 추천부탁드립니다ㅠ
  좋은 예) 이거 저만 어렵나요…? 다들 어떻게 하세요
  좋은 예) 혼자 끙끙대다 결국 여쭤봐요…

[본문]
- 위 '이번 글 유형' 그대로. 100~450자. 길게 안 써도 됨, 오히려 짧고 진솔한 게 낫다.
- 인사·자기소개 없이 바로 상황부터. 구어체로, 사람이 쓴 것처럼.
- 볼드·번호목록·머리기호(-, ·, #) 금지. 그냥 문단으로.
- 마지막은 질문으로 열어서 댓글 유도(강요 말고 자연스럽게).

[출력 형식]
- 1번째 줄: 제목만 (따옴표·"제목:" 없이).
- 2번째 줄부터: 본문.`
  const text = await callClaude(apiKey, model, maxTokens, prompt)
  return splitTitleBody(text)
}

export async function draftComment(
  apiKey: string,
  cafe: DraftCafe,
  postTitle: string,
  postExcerpt: string,
  model = 'claude-sonnet-4-6',
  maxTokens = 600,
): Promise<string> {
  const prompt = `아래 카페 원글에 댓글 하나 달아줘. 지나가다 진짜 회원이 툭 다는 것 같은 댓글.

[나] ${cafe.persona || '이 카페 자주 오는 평범한 회원'}
[원글 제목] ${postTitle}
[원글 내용] ${(postExcerpt || '').slice(0, 400)}
${cafe.selling_point ? `[은근히 도움 줄 수 있는 맥락] ${cafe.selling_point}\n  → 필요하면 "저는 이렇게 해봤는데 괜찮았어요" 정도로만 아주 은근하게. 대놓고 홍보·업체명 강조·링크는 금지.` : ''}

[규칙]
- 1~3문장. 짧게. 원글에 공감 한마디 + 내 경험이나 팁 하나.
- 구어체. ㅋㅋ ㅠ "~더라구요" 자연스럽게. 존댓말이되 딱딱하지 않게.
- 광고티·링크·"도움 되셨길 바라요" 금지.
- 댓글 본문만 출력(따옴표·머리말 없이).`
  const text = await callClaude(apiKey, model, maxTokens, prompt)
  return stripMarkup(text).replace(/^["'“”]|["'“”]$/g, '').slice(0, 1000)
}
