import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// 각도별 지시 — 광고 카피 관점. 클라이언트가 3개를 병렬 호출(각 카드가 독립적으로 빨리 채워짐).
const ANGLES: Record<string, { kind: string; how: string }> = {
  hook: {
    kind: '후킹 강화',
    how: '첫 줄(후킹)을 확 세게 바꿔라. 숫자·손실회피·호기심 갭·역설·도발 중 하나로 3초 안에 스크롤을 멈추게. 뒷부분은 원문 흐름 유지.',
  },
  tone: {
    kind: '톤 변형',
    how: '메시지·소재는 그대로 두고 화자 "톤"만 확 바꿔라. 친구가 몰래 꿀팁 알려주듯 생생한 반말 구어체로, 광고티 빼고.',
  },
  structure: {
    kind: '구성 변형',
    how: 'PAS(문제 던지기 → 공감·증폭 → 해결=제품) 또는 Before→After→혜택 구조로 재배열해라. 같은 소재, 다른 짜임새.',
  },
}

// 기획 메모의 카피 베리에이션 1개(각도 지정). ⚠️ 사용자 본인 Anthropic 키(x-user-api-key).
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: '마이페이지에서 Anthropic API 키를 입력해야 베리에이션이 생성돼요.' }, { status: 401 })
  }
  const b = await req.json().catch(() => ({}))
  const content = (b.content || '').toString().trim()
  const angleKey = (b.angle || 'hook').toString()
  const angle = ANGLES[angleKey] || ANGLES.hook
  if (content.length < 5) return NextResponse.json({ variation: null })

  const prompt = `너는 한국 숏폼 퍼포먼스 광고 카피라이터다. 아래는 지금 작성 중인 광고 기획 초안(대본/이미지 문구)이야.
이걸 바탕으로 "스크롤을 멈추게 하는" 카피 한 버전만 써라.

[이번 버전의 변형 방향]
${angle.how}

[반드시 지킬 것]
- 원문의 제품/소재/핵심 메시지·의도는 유지(전혀 다른 주제로 튀지 말 것).
- 짧고 펀치 있게. 숏폼 자막 톤으로 3~6줄, 각 줄은 짧게.
- 상투적 광고 표현("지금 바로", "놓치지 마세요", "특별한", "완벽한" 남발) 금지. 뻔한 정보성 문장 금지.
- 설명·머리말·따옴표·마크다운 없이 "카피 본문만" 출력.

[원문 초안]
${content.slice(0, 3000)}`

  try {
    const r = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: j?.error?.message || `Anthropic 오류(${r.status})` }, { status: 502 })
    let text: string = (j?.content?.[0]?.text || '').trim()
    // 혹시 따옴표/코드펜스로 감싸 나오면 벗김
    text = text.replace(/^```[\w]*\n?/, '').replace(/```$/, '').replace(/^["'“”]|["'“”]$/g, '').trim()
    if (!text) return NextResponse.json({ variation: null })
    return NextResponse.json({ variation: { kind: angle.kind, text: text.slice(0, 2000) } })
  } catch {
    return NextResponse.json({ error: '베리에이션 생성 중 오류가 발생했어요.' }, { status: 500 })
  }
}
