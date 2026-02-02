import { NextRequest } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-20250514'
const MAX_TOKENS = 2048

interface AdvertiserInfo {
  guidelines?: string | null
  products?: string[] | null
  appeals?: string[] | null
  cautions?: string | null
}

function buildPrompt(
  mediaType: 'image' | 'video',
  advertiserName?: string,
  advertiser?: AdvertiserInfo | null
): string {
  const typeLabel = mediaType === 'image' ? '이미지' : '영상'
  
  let contextParts: string[] = []
  
  if (advertiserName?.trim()) {
    contextParts.push(`- 광고주: ${advertiserName.trim()}`)
  }
  
  if (advertiser) {
    if (advertiser.products && advertiser.products.length > 0) {
      contextParts.push(`- 제품: ${advertiser.products.join(', ')}`)
    }
    if (advertiser.appeals && advertiser.appeals.length > 0) {
      contextParts.push(`- 소구점 (반드시 카피에 반영): ${advertiser.appeals.join(', ')}`)
    }
    if (advertiser.guidelines) {
      contextParts.push(`- 지침서:\n${advertiser.guidelines}`)
    }
    if (advertiser.cautions) {
      contextParts.push(`- ⚠️ 주의사항 (절대 위반 금지):\n${advertiser.cautions}`)
    }
  }

  const contextSection = contextParts.length > 0 
    ? `\n\n[광고주 정보]\n${contextParts.join('\n')}\n`
    : ''

  return `당신은 DA(디스플레이 광고) 카피라이터입니다.
${typeLabel} 광고 소재용 카피를 정확히 6개 작성해주세요.
${contextSection}
[작성 규칙]
- 각 카피는 메인 카피(헤드라인)와 서브 카피로 구성
- 짧고 임팩트 있게 작성 (메인 카피 15자 이내 권장)
- 소구점이 있다면 반드시 카피에 자연스럽게 녹여내기
- 주의사항이 있다면 절대 위반하지 않기
- 광고 심의에 걸리지 않는 표현 사용

[출력 형식]
1. 메인카피: 서브카피 설명
2. 메인카피: 서브카피 설명
...
6. 메인카피: 서브카피 설명

다른 설명 없이 6개만 출력하세요.`
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  let body: { 
    mediaType?: string
    advertiserName?: string
    advertiser?: AdvertiserInfo | null
  }
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
  const advertiser = body.advertiser ?? null
  const prompt = buildPrompt(mediaType, advertiserName, advertiser)

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
