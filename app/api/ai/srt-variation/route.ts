import { NextRequest } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API 키 없음' }), { status: 500 })
  }

  const body = await request.json()
  const { originalScript, productName, appeals, batchIndex } = body as {
    originalScript: string
    productName?: string
    appeals?: string[]
    batchIndex?: number // 0, 1, 2 (각 2개씩)
  }

  if (!originalScript?.trim()) {
    return new Response(JSON.stringify({ error: '원본 대본이 필요합니다' }), { status: 400 })
  }

  // 제품 정보 구성
  let productInfo = ''
  if (productName?.trim()) {
    productInfo += `제품명: ${productName.trim()}\n`
  }
  if (appeals && appeals.length > 0) {
    const validAppeals = appeals.filter(a => a.trim())
    if (validAppeals.length > 0) {
      productInfo += `소구점:\n${validAppeals.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n`
    }
  }

  // 배치 번호에 따라 베리에이션 번호 결정 (0->1,2 / 1->3,4 / 2->5,6)
  const batch = batchIndex ?? 0
  const startNum = batch * 2 + 1
  const variationStyles = [
    ['톤앤매너를 더 친근하고 유머러스하게', '더 진지하고 신뢰감 있게'],
    ['질문형 문장을 더 많이 사용하여', '감탄형/명령형으로 강렬하게'],
    ['소구점을 더 직접적으로 강조하여', '스토리텔링 방식으로 부드럽게']
  ]
  const styles = variationStyles[batch] || variationStyles[0]

  const prompt = `당신은 영상 광고 대본 전문 작가입니다.
아래 원본 대본을 참고하여 베리에이션 대본 2개를 만들어주세요.

=== 원본 대본 ===
${originalScript}

${productInfo ? `=== 제품 정보 (반드시 반영) ===\n${productInfo}` : ''}

=== 베리에이션 규칙 ===
1. 원본 대본의 전체적인 톤앤매너, 분위기, 구조를 최대한 유지
2. 문장 스타일과 길이를 비슷하게 유지
3. 원본의 핵심 메시지 흐름을 따라가되 표현만 다르게
4. 제품명이 있다면 자연스럽게 포함
5. 소구점이 있다면 반드시 녹여내기
6. 광고 심의에 걸리지 않는 표현 사용
7. 원본과 비슷한 줄 수와 길이 유지

=== 이번 베리에이션 방향 ===
- 베리에이션 ${startNum}: ${styles[0]}
- 베리에이션 ${startNum + 1}: ${styles[1]}

=== 출력 형식 ===
---
[베리에이션 ${startNum}]
(대본 내용 - 여러 줄)

[변경 포인트] ${styles[0]} - 구체적으로 어떻게 바꿨는지

---
[베리에이션 ${startNum + 1}]
(대본 내용 - 여러 줄)

[변경 포인트] ${styles[1]} - 구체적으로 어떻게 바꿨는지

---

딱 2개만 만들어주세요. 대본은 원본과 비슷한 길이로 작성하세요.`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const res = await fetch(ANTHROPIC_BASE, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: MODEL,
            max_tokens: 3000,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!res.ok) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'API 오류' })}\n\n`))
          controller.close()
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const jsonStr = line.slice(6)
              if (jsonStr === '[DONE]') continue
              try {
                const parsed = JSON.parse(jsonStr)
                if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text, batch })}\n\n`))
                }
              } catch { /* ignore */ }
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, batch })}\n\n`))
        controller.close()
      } catch (error) {
        console.error('Stream error:', error)
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
