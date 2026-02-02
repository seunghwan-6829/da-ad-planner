import { NextRequest } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-3-opus-latest'
const MAX_TOKENS = 2048

function buildPrompt(mediaType: 'image' | 'video', advertiserName?: string): string {
  const typeLabel = mediaType === 'image' ? '이미지' : '영상'
  const advertiserPart = advertiserName?.trim()
    ? `\n- 업체(광고주): ${advertiserName.trim()}`
    : ''
  return `DA(디스플레이 광고) 기획서 아이디어를 정확히 6개만 작성해줘.

조건:
- 소재 유형: ${typeLabel}${advertiserPart}
- 각 기획은 반드시 한 줄로 "제목: 한 줄 설명" 형식으로 작성.
- 번호는 1~6으로 붙여줘.
- 다른 설명이나 서두 없이 6개만 출력.

예시 형식:
1. 제목: 한 줄 설명
2. 제목: 한 줄 설명
...
6. 제목: 한 줄 설명`
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: { mediaType?: string; advertiserName?: string }
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ error: '요청 본문이 올바른 JSON이 아닙니다.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const mediaType = (body.mediaType === 'video' ? 'video' : 'image') as 'image' | 'video'
  const advertiserName = typeof body.advertiserName === 'string' ? body.advertiserName : undefined
  const prompt = buildPrompt(mediaType, advertiserName)

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
            max_tokens: MAX_TOKENS,
            stream: true,
            messages: [{ role: 'user', content: prompt }],
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.error?.message ?? 'API 오류' })}\n\n`))
          controller.close()
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '스트림을 읽을 수 없습니다.' })}\n\n`))
          controller.close()
          return
        }

        let buffer = ''
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\n\n+/)
          buffer = events.pop() ?? ''
          for (const eventBlock of events) {
            const dataLine = eventBlock.split('\n').find((l) => l.startsWith('data: '))
            if (!dataLine) continue
            try {
              const data = JSON.parse(dataLine.slice(6))
              if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: data.delta.text })}\n\n`))
              }
              if (data.type === 'message_stop') {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
              }
            } catch {
              // ignore
            }
          }
        }
        const dataLine = buffer.split('\n').find((l) => l.startsWith('data: '))
        if (dataLine) {
          try {
            const data = JSON.parse(dataLine.slice(6))
            if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta' && data.delta.text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: data.delta.text })}\n\n`))
            }
          } catch {
            // ignore
          }
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
      } catch (err) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : '스트리밍 오류' })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
