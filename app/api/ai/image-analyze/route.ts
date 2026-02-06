import { NextRequest } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'API 키 없음' }), { status: 500 })
  }

  const body = await request.json()
  const { image } = body as { image: string }

  if (!image) {
    return new Response(JSON.stringify({ error: '이미지가 필요합니다' }), { status: 400 })
  }

  let base64Data = image
  let mediaType = 'image/jpeg'
  
  if (image.startsWith('data:')) {
    const match = image.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      mediaType = match[1]
      base64Data = match[2]
    }
  }

  const prompt = `이 광고 이미지를 분석해주세요:

## 텍스트 분석
- 메인 카피, 서브 카피, CTA 문구

## 디자인 분석
- 컬러 톤, 레이아웃, 타이포그래피

## 이미지 분석
- 제품/인물/배경, 전달 메시지, 타겟층

## 광고 특성
- 카테고리, 소구점, 강점/개선점

간결하게 정리해주세요.`

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
            max_tokens: 2048,
            stream: true,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
                { type: 'text', text: prompt },
              ],
            }],
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
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text })}\n\n`))
                }
              } catch { /* ignore */ }
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`))
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
