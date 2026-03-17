import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL =
  process.env.ANTHROPIC_VIDEO_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-opus-4-6'

interface VideoFrame {
  dataUrl: string
  timestampLabel: string
}

interface ParsedSections {
  overview: string
  sceneBreakdown: string
  creativeOpportunities: string
  remixConcept: string
  remixScript: string
  alternateScript: string
  productionPlan: string
  riskNotes: string
}

function extractBase64Image(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) return null

  return {
    mediaType: match[1],
    data: match[2],
  }
}

function extractSection(text: string, tag: string) {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  return match?.[1]?.trim() || ''
}

function parseSections(text: string): ParsedSections {
  return {
    overview: extractSection(text, 'overview'),
    sceneBreakdown: extractSection(text, 'scene_breakdown'),
    creativeOpportunities: extractSection(text, 'creative_opportunities'),
    remixConcept: extractSection(text, 'remix_concept'),
    remixScript: extractSection(text, 'remix_script'),
    alternateScript: extractSection(text, 'alternate_script'),
    productionPlan: extractSection(text, 'production_plan'),
    riskNotes: extractSection(text, 'risk_notes'),
  }
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = (await request.json()) as {
    videoName?: string
    mimeType?: string
    duration?: number
    width?: number
    height?: number
    sizeBytes?: number
    brandContext?: string
    creativeGoal?: string
    frames?: VideoFrame[]
  }

  const frames = (body.frames || [])
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

  if (frames.length === 0) {
    return NextResponse.json({ error: '분석할 대표 프레임이 없습니다.' }, { status: 400 })
  }

  const videoFacts = [
    body.videoName ? `파일명: ${body.videoName}` : null,
    body.mimeType ? `형식: ${body.mimeType}` : null,
    body.duration ? `길이: ${body.duration.toFixed(1)}초` : null,
    body.width && body.height ? `해상도: ${body.width}x${body.height}` : null,
    body.sizeBytes ? `파일 크기: ${(body.sizeBytes / 1024 / 1024).toFixed(2)}MB` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const frameFacts = (body.frames || [])
    .map((frame, index) => `- 프레임 ${index + 1}: ${frame.timestampLabel}`)
    .join('\n')

  const prompt = `당신은 퍼포먼스 광고 영상 분석가이자 리믹스 카피라이터입니다.

업로드된 영상의 대표 프레임과 메타데이터를 바탕으로 "분석"에서 끝내지 말고,
바로 편집 가능한 리믹스 광고 대본까지 완성해 주세요.

[영상 메타데이터]
${videoFacts || '없음'}

[샘플링 프레임 시점]
${frameFacts || '없음'}

[브랜드/제품 맥락]
${body.brandContext?.trim() || '사용자 입력 없음'}

[제작 목표]
${body.creativeGoal?.trim() || '리믹스 가능한 광고 제작안까지 제안'}

[중요 지시]
- 응답은 반드시 한국어로 작성
- 분석보다 "리믹스 결과물" 비중을 더 크게 둘 것
- 리믹스 대본은 실제 편집자가 바로 써먹을 수 있게 구체적으로 작성
- 장면별로 화면, 자막, 내레이션/보이스오버, 효과, CTA를 분리해서 작성
- 원본을 단순 요약하지 말고 성과 개선 관점의 리믹스를 제안
- 대본은 15~30초 분량으로 작성
- 반드시 1안, 2안 두 개의 대본을 제공

반드시 아래 태그 형식을 지켜서 답변하세요.

<overview>
원본 영상의 한줄 진단, 타깃 추정, 메시지 요약
</overview>

<scene_breakdown>
원본 장면 흐름을 4-8개 bullet로 정리
</scene_breakdown>

<creative_opportunities>
리믹스 시 강화할 포인트를 5개 bullet로 정리
</creative_opportunities>

<remix_concept>
추천 리믹스 방향 3개를 bullet로 제안
</remix_concept>

<remix_script>
[리믹스 대본 1안]
- Hook:
- Shot 1:
  화면:
  자막:
  내레이션:
  편집포인트:
- Shot 2:
...
- 엔딩 CTA:
</remix_script>

<alternate_script>
[리믹스 대본 2안]
- Hook:
- Shot 1:
  화면:
  자막:
  내레이션:
  편집포인트:
- Shot 2:
...
- 엔딩 CTA:
</alternate_script>

<production_plan>
편집, 자막 톤, 사운드, 전환, 썸네일 카피, A/B 테스트 포인트를 bullet로 정리
</production_plan>

<risk_notes>
추정에 기반한 부분, 추가 확인이 필요한 리스크, 더 받으면 좋은 자료를 bullet로 정리
</risk_notes>`

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
            max_tokens: 3200,
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
            encoder.encode(
              `data: ${JSON.stringify({ error: err.error?.message ?? '영상 분석 요청에 실패했습니다.' })}\n\n`
            )
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
                  encoder.encode(`data: ${JSON.stringify({ text: parsed.delta.text, raw: fullText })}\n\n`)
                )
              }
            } catch {
              // ignore parse failures from non-content events
            }
          }
        }

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              done: true,
              raw: fullText,
              model: MODEL,
              sections: parseSections(fullText),
            })}\n\n`
          )
        )
        controller.close()
      } catch (error) {
        console.error('Video remix stream error:', error)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '영상 분석 중 오류가 발생했습니다.' })}\n\n`))
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
