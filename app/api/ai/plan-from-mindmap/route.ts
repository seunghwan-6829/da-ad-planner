import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

// POST { mindmap, brief, brand_name } → 마인드맵 분석 + 우리 브랜드 브리프로 "우리 브랜드용 기획안" 작성.
// ⚠️ 사용자 본인 Anthropic 키(x-user-api-key)로만 동작.
export async function POST(req: Request) {
  const apiKey = req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: '마이페이지에서 Anthropic API 키를 입력해야 기획안을 생성할 수 있어요.' },
      { status: 401 }
    )
  }

  const body = await req.json().catch(() => ({}))
  const mindmap = body.mindmap || {}
  const brief = body.brief || {}
  const brandName: string = (body.brand_name || '우리 브랜드').toString()

  // 마인드맵 노드를 텍스트로 평탄화
  const nodeLines: string[] = []
  for (const n of mindmap.nodes || []) {
    const label = n.label || n.title || ''
    const items = Array.isArray(n.items) ? n.items : n.text ? [n.text] : []
    if (label || items.length) nodeLines.push(`- ${label}: ${items.join(' / ')}`)
  }

  const briefBlock = [
    brief.brand_brief ? `- 브랜드 소개: ${brief.brand_brief}` : '',
    brief.strengths ? `- 강점: ${brief.strengths}` : '',
    brief.selling_points ? `- 소구점: ${brief.selling_points}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = `너는 숏폼/퍼포먼스 광고 기획 디렉터다. 아래 "경쟁 소재 분석 마인드맵"과 "우리 브랜드 브리프"를 토대로, 우리 브랜드(${brandName})가 바로 촬영에 들어갈 수 있는 숏폼 기획안을 작성해줘.

[경쟁 소재 마인드맵 요약]
${mindmap.summary ? `총평: ${mindmap.summary}` : ''}
${nodeLines.join('\n')}

[우리 브랜드 브리프]
${briefBlock || '(브리프 미입력 — 일반적인 베스트 프랙티스로 작성하되, 브랜드 브리프가 있으면 더 정확해진다는 점을 가정)'}

요구사항:
- 경쟁 소재의 잘된 점은 살리고 약점은 보완하되, 그대로 베끼지 말고 우리 브랜드 강점·소구점에 맞게 변주.
- 다음 구조의 마크다운으로 작성: ## 한 줄 컨셉 / ## 타겟 / ## 핵심 소구점 / ## 후킹(0~3초) / ## 전개 / ## CTA / ## 대본(나레이션 초안, 구간별) / ## 촬영 메모.
- 한국어. 실제 제작에 쓸 수 있게 구체적으로. 마크다운만 출력(코드펜스 금지).`

  try {
    const res = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    })
    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    }
    const plan = data.content?.find((b: { type: string }) => b.type === 'text')?.text?.trim() ?? ''
    return NextResponse.json({ plan })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
