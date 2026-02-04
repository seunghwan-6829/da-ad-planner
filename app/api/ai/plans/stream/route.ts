import { NextRequest } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'
const MAX_TOKENS = 4096  // 영상 대본용 증가

interface AdvertiserInfo {
  category?: string | null
  guidelines_image?: string | null
  guidelines_video?: string | null
  products?: string[] | null
  appeals?: string[] | null
  cautions?: string | null
}

interface BPReference {
  name: string
  extracted_text: string
}

function buildPrompt(
  mediaType: 'image' | 'video',
  advertiserName?: string,
  advertiser?: AdvertiserInfo | null,
  extraPrompt?: string,
  bpReferences?: BPReference[]
): string {
  const typeLabel = mediaType === 'image' ? '이미지' : '영상'
  
  // 지침서 선택
  const guidelines = advertiser 
    ? (mediaType === 'image' ? advertiser.guidelines_image : advertiser.guidelines_video)
    : null

  // 광고주 정보 구성
  let advertiserSection = ''
  if (advertiserName || advertiser) {
    advertiserSection = '\n\n=== 광고주 정보 (반드시 숙지) ===\n'
    if (advertiserName?.trim()) {
      advertiserSection += `광고주명: ${advertiserName.trim()}\n`
    }
    if (advertiser?.products && advertiser.products.length > 0) {
      advertiserSection += `제품: ${advertiser.products.join(', ')}\n`
    }
    if (advertiser?.appeals && advertiser.appeals.length > 0) {
      advertiserSection += `\n★ 소구점 (모든 대본에 반드시 1개 이상 반영할 것):\n`
      advertiser.appeals.forEach((appeal, i) => {
        advertiserSection += `  ${i + 1}. ${appeal}\n`
      })
    }
  }

  // 지침서 섹션 (강조)
  let guidelinesSection = ''
  if (guidelines?.trim()) {
    guidelinesSection = `\n\n=== ${typeLabel} 광고 지침서 (가장 중요! 반드시 따를 것) ===\n${guidelines.trim()}\n`
  }

  // 주의사항 섹션
  let cautionsSection = ''
  if (advertiser?.cautions?.trim()) {
    cautionsSection = `\n\n=== ⚠️ 주의사항 (절대 위반 금지) ===\n${advertiser.cautions.trim()}\n`
  }

  // 추가 요청사항
  const extraSection = extraPrompt?.trim()
    ? `\n\n=== 추가 요청 ===\n${extraPrompt.trim()}\n`
    : ''

  // BP 참고 자료 섹션
  let bpSection = ''
  if (bpReferences && bpReferences.length > 0) {
    bpSection = '\n\n=== 📚 BP(Best Practice) 학습 자료 [중요!] ===\n'
    bpSection += `총 ${bpReferences.length}개의 성과 좋은 광고 카피 데이터가 제공됩니다.\n`
    bpSection += '★★★ 반드시 아래 BP 자료들의 패턴, 구조, 톤앤매너, 문장 스타일을 분석하고 학습하세요! ★★★\n'
    bpSection += '- 어떤 단어와 표현이 자주 사용되는지 파악\n'
    bpSection += '- 문장 길이와 리듬감 분석\n'
    bpSection += '- 후킹 포인트와 CTA 스타일 학습\n'
    bpSection += '- 이 스타일을 바탕으로 새로운 카피를 창작 (복사 금지)\n\n'
    bpReferences.forEach((bp, i) => {
      bpSection += `[BP ${i + 1}] ${bp.name}\n${bp.extracted_text}\n\n`
    })
  }

  // 이미지 vs 영상에 따라 다른 프롬프트
  if (mediaType === 'image') {
    return `당신은 10년 경력의 DA(디스플레이 광고) 전문 카피라이터입니다.
이미지 광고 소재용 카피를 정확히 6개 작성해주세요.

중요: 아래 정보를 모두 꼼꼼히 읽고, 지침서와 소구점을 반드시 반영해서 작성하세요.
${advertiserSection}${guidelinesSection}${cautionsSection}${bpSection}${extraSection}

=== 카피 작성 규칙 ===
1. 각 카피는 "메인 카피(헤드라인)"와 "서브 카피(부제/설명)"로 구성
2. 메인 카피: 15자 이내, 강렬하고 기억에 남는 문구
3. 서브 카피: 메인 카피를 보완하는 구체적인 설명
4. 소구점이 있다면 각 카피에 최소 1개 이상 자연스럽게 녹여내기
5. 지침서가 있다면 지침서의 톤앤매너, 스타일, 방향성을 반드시 따르기
6. 주의사항이 있다면 절대 위반하지 않기
7. 광고 심의에 걸리지 않는 표현 사용
8. 클리셰나 식상한 표현 피하기

=== 출력 형식 (이 형식 정확히 따를 것) ===
1. 메인카피: 서브카피 설명
2. 메인카피: 서브카피 설명
3. 메인카피: 서브카피 설명
4. 메인카피: 서브카피 설명
5. 메인카피: 서브카피 설명
6. 메인카피: 서브카피 설명

다른 설명이나 서두 없이 위 형식으로 6개만 출력하세요.`
  } else {
    // 영상 광고 대본 형식
    return `당신은 10년 경력의 영상 광고 대본 전문 작가입니다.
영상 광고 소재용 대본을 정확히 6개 작성해주세요.

중요: 아래 정보를 모두 꼼꼼히 읽고, 지침서와 소구점을 반드시 반영해서 작성하세요.
${advertiserSection}${guidelinesSection}${cautionsSection}${bpSection}${extraSection}

=== 대본 작성 규칙 ===
1. 각 대본은 약 30초 분량
2. 씬(Scene) 단위로 구성 (씬 개수와 구성은 지침서 참고, 없으면 자유롭게)
3. 각 씬에는 화면 설명, 나레이션, 자막 등 포함
4. 소구점이 있다면 각 대본에 자연스럽게 녹여내기
5. 지침서가 있다면 지침서의 톤앤매너, 스타일, 씬 구성을 반드시 따르기
6. 주의사항이 있다면 절대 위반하지 않기
7. 광고 심의에 걸리지 않는 표현 사용

=== 출력 형식 ===
각 대본은 "---"로 구분하고, [대본 N] 형식으로 시작.
씬 구성은 지침서를 따르되, 없으면 자유롭게 작성.

다른 설명이나 서두 없이 6개만 출력하세요.`
  }
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
    extraPrompt?: string
    bpReferences?: BPReference[]
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
  const extraPrompt = typeof body.extraPrompt === 'string' ? body.extraPrompt : undefined
  const bpReferences = body.bpReferences ?? []
  const prompt = buildPrompt(mediaType, advertiserName, advertiser, extraPrompt, bpReferences)

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
