import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// 기획 메모의 실시간 베리에이션 3개 — 지금 쓰고 있는 내용을 "비슷하지만 살짝 다른 느낌"으로 디벨롭.
// ⚠️ 사용자 본인 Anthropic 키(x-user-api-key)로만 동작(다른 AI 기능과 동일).
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: '마이페이지에서 Anthropic API 키를 입력해야 베리에이션이 생성돼요.' }, { status: 401 })
  }
  const b = await req.json().catch(() => ({}))
  const content = (b.content || '').toString().trim()
  if (content.length < 5) return NextResponse.json({ variations: [] })

  const prompt = `아래는 내가 지금 실시간으로 쓰고 있는 광고/콘텐츠 기획 초안이야(대본 기획 또는 이미지 기획).
이걸 "완전히 새로 쓰지 말고" 원문을 최대한 살리면서 **살짝만 다른 느낌**으로 디벨롭한 3가지 버전을 만들어줘.

[변형 방향]
- 버전 1: 후킹/첫 문장을 더 임팩트 있게 (나머지는 원문 유지)
- 버전 2: 톤앤매너만 살짝 다르게 (더 친근하거나 더 전문적으로 — 내용은 그대로)
- 버전 3: 구성/전개 순서를 살짝 재배열하거나 디테일 한 스푼 추가

[규칙]
- 원문의 핵심 메시지·소재·의도는 유지. 전혀 다른 주제로 튀지 말 것.
- 각 버전은 원문과 비슷한 분량. 마크다운/머리말 없이 내용만.
- 한국어.

[원문]
"""${content.slice(0, 4000)}"""

JSON 으로만 응답: {"variations":[{"kind":"후킹 강화","text":"..."},{"kind":"톤 변형","text":"..."},{"kind":"구성 변형","text":"..."}]}`

  try {
    const r = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return NextResponse.json({ error: j?.error?.message || `Anthropic 오류(${r.status})` }, { status: 502 })
    const text: string = j?.content?.[0]?.text || ''
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return NextResponse.json({ variations: [] })
    const parsed = JSON.parse(m[0])
    const variations = Array.isArray(parsed.variations)
      ? parsed.variations.slice(0, 3).map((v: { kind?: string; text?: string }) => ({
          kind: (v.kind || '변형').toString().slice(0, 20),
          text: (v.text || '').toString().slice(0, 4000),
        }))
      : []
    return NextResponse.json({ variations })
  } catch {
    return NextResponse.json({ error: '베리에이션 생성 중 오류가 발생했어요.' }, { status: 500 })
  }
}
