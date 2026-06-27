import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 긴 기획안 스트리밍 여유(Pro 플랜 기준, Hobby 는 60으로 자동 제한)

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
  const section: string = (body.section || '').toString()
  const refNarration: string = (body.reference_narration || '').toString().slice(0, 2500)

  // 섹션별 지시(각 섹션을 별도 요청으로 병렬 생성 → 동시 타이핑·시간 절감, 장황 X)
  const SECTIONS: Record<string, string> = {
    concept: '이 소재를 우리 브랜드용으로 만들 때의 "한 줄 컨셉"을 임팩트 있는 한 문장으로.',
    target: '"타겟 세그먼트". 마인드맵의 세그먼트(1·2)와 브리프를 반영해 누구에게/왜 효과적인지 2~3줄로 간결히.',
    selling: '"핵심 소구점"을 불릿 2~4개로(각 한 줄, 군더더기 없이).',
    hook: '"후킹(0~3초)" 아이디어를 구체적인 장면/자막/카피로 2~3줄.',
    flow: '"전개" 흐름을 구간별 불릿 3~5개로(각 한 줄).',
    cta: '"CTA"(행동 유도 문구·장치) 2~3줄.',
    script: '"대본(나레이션 초안)". [후킹]/[전개]/[혜택]/[CTA] 라벨을 달아 구간별로, 실제 읽을 대사 형태로.',
  }

  // 마인드맵 노드를 텍스트로 평탄화
  const nodeLines: string[] = []
  for (const n of mindmap.nodes || []) {
    const label = n.label || n.title || ''
    const items = Array.isArray(n.items) ? n.items : n.text ? [n.text] : []
    if (label || items.length) nodeLines.push(`- ${label}: ${items.join(' / ')}`)
  }

  const briefBlock = [
    `- 브랜드명: ${brandName}`,
    brief.selling_points ? `- 소구점: ${brief.selling_points}` : '',
    brief.segment ? `- 세그먼트(타겟): ${brief.segment}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const refBlock = refNarration.trim()
    ? `

[★★★ 레퍼런스 원문 — 가장 중요. 이 "화법"을 그대로 베껴 써라(거의 복제 수준)]
"""${refNarration}"""

반드시 지킬 것(원문 화법 복제):
- 똑같은 말투: 친구한테 말하듯 100% 반말 구어체. ("~거든?", "~잖아", "~더라", "~봐" 같은 종결어미)
- 똑같은 호명/후킹: "~형들?", "~언니들?" 처럼 타겟을 직접 부르며 질문으로 시작.
- 똑같은 슬랭/유행어 톤: "직빵", "개빡세", "또르르", "리즈 시절", "땀 부자" 같은 날것의 표현·과장.
- 똑같은 리듬: 짧고 펀치 있는 문장, 충격적 후킹 → 원인 폭로 → 비포애프터 → 구체 숫자 → 한정 CTA.
- 광고 같은 정돈된 문어체·존댓말·미사여구 금지. 매끈하게 다듬지 말 것(원문처럼 거칠고 생생하게).
- 단, "제품·소구점·수치·주장"은 우리 브랜드(${brandName})에 맞게 바꿀 것. 문장 구조·말투·전개는 원문을 그대로 모사.`
    : ''

  const ctx = `[경쟁 소재 마인드맵]
${mindmap.summary ? `총평: ${mindmap.summary}` : ''}
${nodeLines.join('\n')}

[우리 브랜드(${brandName}) 브리프]
${briefBlock || '(브리프 미입력 — 일반적인 베스트 프랙티스 가정)'}${refBlock}`

  const isScript = section === 'script'
  const lenRule = isScript
    ? '대본은 요약·압축하지 말고 레퍼런스 원문과 비슷한 분량·밀도로 길게, 원문 화법 그대로.'
    : '짧고 간결하게(군더더기 없이). 단 말투는 위 레퍼런스 화법(반말 구어체)을 따를 것.'

  const prompt = section && SECTIONS[section]
    ? `너는 숏폼 광고 카피라이터다. 아래 컨텍스트로 우리 브랜드(${brandName})용 기획안 중 "한 섹션만" 써라. 제목/머리말/다른 섹션 없이 그 내용만.

[작성할 섹션] ${SECTIONS[section]}
${lenRule}

${ctx}

규칙: 한국어. 마크다운 제목(##) 금지, 내용만. 코드펜스 금지. 경쟁 소재의 "주장/소구점"은 베끼지 말고 우리 걸로 바꾸되, "화법·말투·문장구조·전개 리듬"은 레퍼런스 원문을 그대로 모사할 것.`
    : `너는 숏폼 광고 카피라이터다. 아래를 토대로 우리 브랜드(${brandName})용 숏폼 기획안을 써라(컨셉/타겟/소구점/후킹/전개/CTA/대본). 화법은 위 레퍼런스 원문을 그대로 모사.

${ctx}

한국어, 마크다운만, 코드펜스 금지.`

  // 스트리밍: 토큰을 받는 즉시 클라이언트로 흘려보낸다(긴 출력에도 타임아웃/실패 없이 실시간 타이핑).
  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, stream: true, messages: [{ role: 'user', content: prompt }] }),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : '요청 실패' }, { status: 500 })
  }

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.json().catch(() => ({}))
    return NextResponse.json({ error: err.error?.message ?? 'Anthropic API 오류' }, { status: upstream.status })
  }

  // Anthropic SSE → 텍스트 델타만 평문으로 재스트림
  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let buf = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith('data:')) continue
            const payload = t.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            try {
              const ev = JSON.parse(payload)
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
                controller.enqueue(encoder.encode(ev.delta.text))
              }
            } catch {
              /* 부분 라인 무시 */
            }
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
  })
}
