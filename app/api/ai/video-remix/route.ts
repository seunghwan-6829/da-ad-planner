import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL =
  process.env.ANTHROPIC_VIDEO_MODEL ||
  process.env.ANTHROPIC_MODEL ||
  'claude-opus-4-20250514'

interface VideoFrame {
  dataUrl: string
  timestampLabel: string
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

  const prompt = `당신은 퍼포먼스 광고 영상 분석가이자 리믹스 디렉터입니다.

업로드된 영상의 대표 프레임과 메타데이터를 바탕으로 다음을 한국어로 정리해 주세요.
- 영상의 핵심 메시지와 퍼널 단계
- 화면 전개, 후킹 포인트, 전환 흐름
- 리믹스하면 좋아질 지점
- 바로 제작 가능한 리믹스 콘셉트와 편집 가이드

[영상 메타데이터]
${videoFacts || '없음'}

[샘플링 프레임 시점]
${frameFacts || '없음'}

[브랜드/제품 맥락]
${body.brandContext?.trim() || '사용자 입력 없음'}

[제작 목표]
${body.creativeGoal?.trim() || '리믹스 가능한 광고 제작안까지 제안'}

반드시 아래 태그 형식을 지켜서 답변하세요.

<overview>
영상의 전체 한줄 진단, 타깃 추정, 메시지 요약
</overview>

<scene_breakdown>
장면 흐름을 4-8개 bullet로 정리
</scene_breakdown>

<creative_opportunities>
리믹스 시 강화할 포인트를 5개 bullet로 정리
</creative_opportunities>

<remix_concept>
추천 리믹스 방향 3개를 bullet로 제안
</remix_concept>

<remix_script>
15~30초 분량의 리믹스 영상 구성안을 shot-by-shot 형식으로 작성
</remix_script>

<production_plan>
편집, 자막, 후킹 문구, 사운드, CTA 제작 팁을 bullet로 정리
</production_plan>

<risk_notes>
추정에 기반한 부분, 확인이 필요한 리스크, 추가로 받으면 좋은 자료를 bullet로 정리
</risk_notes>`

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
        max_tokens: 2600,
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
      return NextResponse.json({ error: err.error?.message ?? '영상 분석 요청에 실패했습니다.' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''

    return NextResponse.json({
      model: MODEL,
      raw: text,
      sections: {
        overview: extractSection(text, 'overview'),
        sceneBreakdown: extractSection(text, 'scene_breakdown'),
        creativeOpportunities: extractSection(text, 'creative_opportunities'),
        remixConcept: extractSection(text, 'remix_concept'),
        remixScript: extractSection(text, 'remix_script'),
        productionPlan: extractSection(text, 'production_plan'),
        riskNotes: extractSection(text, 'risk_notes'),
      },
    })
  } catch (error) {
    console.error('Video remix error:', error)
    return NextResponse.json({ error: '영상 분석 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
