import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

export const VIDEO_MODEL = MODELS.video

export interface VideoFramePayload {
  dataUrl: string
  timestampLabel: string
}

export interface VideoRequestPayload {
  videoName?: string
  mimeType?: string
  duration?: number
  width?: number
  height?: number
  sizeBytes?: number
  brandName?: string
  productInfo?: string
  productAppeal?: string
  creativeGoal?: string
  analysisContext?: string
  frames?: VideoFramePayload[]
}

function extractBase64Image(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null

  return {
    mediaType: match[1],
    data: match[2],
  }
}

export function buildVideoFacts(body: VideoRequestPayload) {
  return [
    body.videoName ? `파일명: ${body.videoName}` : null,
    body.mimeType ? `형식: ${body.mimeType}` : null,
    body.duration ? `길이: ${body.duration.toFixed(1)}초` : null,
    body.width && body.height ? `해상도: ${body.width}x${body.height}` : null,
    body.sizeBytes ? `파일 크기: ${(body.sizeBytes / 1024 / 1024).toFixed(2)}MB` : null,
    body.brandName?.trim() ? `브랜드명: ${body.brandName.trim()}` : null,
    body.productInfo?.trim() ? `제품 정보: ${body.productInfo.trim()}` : null,
    body.productAppeal?.trim() ? `제품 소구점: ${body.productAppeal.trim()}` : null,
    body.creativeGoal?.trim() ? `제작 목표: ${body.creativeGoal.trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

export function buildFrameFacts(body: VideoRequestPayload) {
  return (body.frames || [])
    .map((frame, index) => `- 프레임 ${index + 1}: ${frame.timestampLabel}`)
    .join('\n')
}

export function buildAnthropicImages(frames: VideoFramePayload[]) {
  return frames
    .map((frame) => {
      const parsed = extractBase64Image(frame.dataUrl)
      if (!parsed) return null

      return {
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: parsed.mediaType,
          data: parsed.data,
        },
      }
    })
    .filter(Boolean)
}

export function createSseStream(args: {
  apiKey: string
  body: VideoRequestPayload
  prompt: string
  maxTokens: number
}) {
  const { apiKey, body, prompt, maxTokens } = args
  const frames = buildAnthropicImages(body.frames || [])
  const encoder = new TextEncoder()

  return new ReadableStream({
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
            model: VIDEO_MODEL,
            max_tokens: maxTokens,
            stream: true,
            messages: [
              {
                role: 'user',
                content: [
                  ...frames,
                  {
                    type: 'text',
                    text: prompt,
                  },
                ],
              },
            ],
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: err.error?.message ?? 'AI 요청에 실패했습니다.' })}\n\n`)
          )
          controller.close()
          return
        }

        const reader = res.body?.getReader()
        if (!reader) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '스트림을 읽지 못했습니다.' })}\n\n`))
          controller.close()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6)
            if (jsonStr === '[DONE]') continue

            try {
              const parsed = JSON.parse(jsonStr)
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                fullText += parsed.delta.text
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ text: parsed.delta.text, raw: fullText, model: VIDEO_MODEL })}\n\n`
                  )
                )
              }
            } catch {
              // ignore non-text events
            }
          }
        }

        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, raw: fullText, model: VIDEO_MODEL })}\n\n`)
        )
        controller.close()
      } catch (error) {
        console.error('Video AI stream error:', error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '영상 처리 중 오류가 발생했습니다.' })}\n\n`))
        controller.close()
      }
    },
  })
}

export function sseHeaders() {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  }
}
