import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// 각도별 지시 — "새로 쓰기"가 아니라 원문을 거의 그대로 두는 미세 변형(단어/표현 몇 개만).
const ANGLES: Record<string, { kind: string; how: string }> = {
  hook: {
    kind: '후킹 강화',
    how: '원문 줄 구성을 그대로 두고, 첫 줄(후킹)의 "단어 몇 개만" 더 세게 바꿔라. 문장 개수·순서·나머지 줄은 원문과 동일하게.',
  },
  tone: {
    kind: '톤 변형',
    how: '문장 구조·줄 구성은 그대로. 어미/말투 뉘앙스만 아주 살짝 바꿔라(예: "~템" ↔ "~아이템", 딱딱함 ↔ 부드러움). 내용은 100% 동일.',
  },
  structure: {
    kind: '표현 변형',
    how: '뜻은 완전히 같게, 단어 몇 개를 유의어/비슷한 표현으로만 교체(예: "묵은" ↔ "오래된", "싹" ↔ "확"). 줄 수·순서 그대로.',
  },
}

// 기획 메모의 미세 변형 1개(각도 지정). ⚠️ 사용자 본인 Anthropic 키(x-user-api-key).
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

  const prompt = `아래 광고 문구를 "아주 살짝만" 손본 버전 하나를 만들어라. 새로 창작하는 게 절대 아니다.

[이번 버전 방향]
${angle.how}

[철칙 — 어기면 실패]
- 원문을 거의 그대로 유지한다. 줄 수·줄 순서·문장 구성을 원문과 똑같이 맞춰라.
- 바꾸는 건 단어 몇 개(2~4개) 뿐. 나머지 단어·어순·조사·어미는 원문 그대로 둔다.
- 문장을 새로 만들거나, 빼거나, 늘리지 마라. 원문에 없던 내용·설명 추가 금지.
- 전체 글자 수는 원문의 ±15% 이내.
- 설명·머리말·따옴표·마크다운 없이 "결과 문구만" 출력.

[원문]
${content.slice(0, 3000)}`

  try {
    const r = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      // temperature 낮춰 원문에서 멀어지지 않게(미세 변형).
      body: JSON.stringify({ model: MODEL, max_tokens: 500, temperature: 0.4, messages: [{ role: 'user', content: prompt }] }),
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
