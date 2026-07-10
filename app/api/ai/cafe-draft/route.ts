import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { cafe:{name,tone,topics,notes}, topic, extra } → 카페 성질(말투/주제)에 맞춘 글 초안 {title, body}.
// ⚠️ 사용자 본인 Anthropic 키(x-user-api-key)로만 동작(다른 AI 기능과 동일).
export async function POST(req: Request) {
  // 카페 자동화는 회사 공용 키(서버 env) 우선 — 없으면 사용자 키(x-user-api-key)로.
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Vercel 환경변수 ANTHROPIC_API_KEY 를 등록하거나, 마이페이지에서 Anthropic 키를 입력해 주세요.' },
      { status: 401 }
    )
  }

  const b = await req.json().catch(() => ({}))
  const cafe = b.cafe || {}
  const topic = (b.topic || '').toString().trim()
  const extra = (b.extra || '').toString().trim()
  if (!topic) return NextResponse.json({ error: '글 주제를 입력해 주세요.' }, { status: 400 })

  const prompt = `네이버 카페에 올릴 글의 초안을 작성해줘.

[카페 정보]
- 카페: ${cafe.name || '(이름 없음)'}
- 이 카페의 성질/분위기/말투: ${cafe.tone || '(설정 없음 — 자연스러운 커뮤니티 말투)'}
- 이 카페에서 주로 다루는 주제: ${cafe.topics || '(설정 없음)'}
- 주의사항: ${cafe.notes || '(없음)'}

[글 주제]
${topic}
${extra ? `\n[추가 요청]\n${extra}` : ''}

[작성 규칙]
- 이 카페 회원이 자연스럽게 쓴 글처럼. 광고티(과장, 반복 CTA, 각 잡힌 마케팅 문구) 금지.
- 카페의 말투/분위기를 그대로 따라갈 것(반말/존댓말, 이모지 사용 정도 포함).
- 제목은 클릭을 부르되 낚시 금지. 본문은 문단을 나눠 읽기 쉽게, 300~700자 내외.
- 마크다운/특수서식 없이 일반 텍스트로만(카페 에디터에 그대로 붙는 형태).

JSON 으로만 응답: {"title":"...","body":"..."}`

  try {
    const r = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      const msg = j?.error?.message || `Anthropic 오류(${r.status})`
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    const text: string = j?.content?.[0]?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ error: 'AI 응답 형식 오류 — 다시 시도해 주세요.' }, { status: 502 })
    const parsed = JSON.parse(m[0])
    return NextResponse.json({
      title: (parsed.title || '').toString().slice(0, 100),
      body: (parsed.body || '').toString().slice(0, 4000),
    })
  } catch {
    return NextResponse.json({ error: '초안 생성 중 오류가 발생했어요.' }, { status: 500 })
  }
}
