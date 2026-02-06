import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { 
    originalScript,
    productName,
    appeals,
    messages, 
    userMessage,
    generateFinal,
    batchIndex
  } = body as { 
    originalScript: string
    productName?: string
    appeals?: string[]
    messages: Message[]
    userMessage: string
    generateFinal?: boolean
    batchIndex?: number
  }

  // 제품 정보 구성
  let productInfo = ''
  if (productName?.trim()) {
    productInfo += `제품명: ${productName.trim()}\n`
  }
  if (appeals && appeals.length > 0) {
    const validAppeals = appeals.filter(a => a.trim())
    if (validAppeals.length > 0) {
      productInfo += `소구점: ${validAppeals.join(', ')}\n`
    }
  }

  // 시스템 프롬프트
  const systemPrompt = `당신은 영상 광고 대본 베리에이션 전문가입니다.
사용자가 입력한 원본 대본을 분석하고, 대화를 통해 베리에이션 방향을 정합니다.

[원본 대본]
${originalScript}

${productInfo ? `[제품 정보]\n${productInfo}` : ''}

---

당신의 역할:
1. 사용자가 원하는 베리에이션 방향을 파악하기 위해 단계별로 질문합니다
2. 한 번에 1개의 주제에 대해서만 질문하세요
3. **반드시 클릭 가능한 선택지를 제공하세요** - 아래 형식을 꼭 지켜주세요:

[선택지 형식 규칙]
- 선택지는 반드시 "A. 선택지내용" 형식으로 작성
- 각 선택지는 새 줄에 하나씩
- 2-5개 사이의 선택지 제공
- 다중 선택이 필요하면 "(여러 개 선택 가능)" 문구 추가

예시:
"대본의 톤을 어떻게 변경할까요?

A. 더 친근하고 유머러스하게
B. 진지하고 신뢰감 있게
C. 감성적이고 따뜻하게
D. 직접적이고 강렬하게"

질문 순서:
1. 톤앤매너 변경 방향
2. 타겟 고객층 (유지 또는 변경)
3. 강조하고 싶은 부분
4. 3-4번의 대화 후 베리에이션 생성 준비 완료 알림

응답은 친절하게 해주세요. 이모지를 적절히 사용해도 좋습니다.
선택지 형식을 반드시 지켜주세요 (클릭 버튼으로 변환됩니다).`

  // 최종 생성 요청인 경우 (스트리밍)
  if (generateFinal) {
    const batch = batchIndex ?? 0
    const startNum = batch * 2 + 1
    const variationStyles = [
      ['톤앤매너를 더 친근하고 유머러스하게', '더 진지하고 신뢰감 있게'],
      ['질문형 문장을 더 많이 사용하여', '감탄형/명령형으로 강렬하게'],
      ['소구점을 더 직접적으로 강조하여', '스토리텔링 방식으로 부드럽게']
    ]
    const styles = variationStyles[batch] || variationStyles[0]

    const finalPrompt = `지금까지의 대화를 바탕으로, 원본 대본의 베리에이션을 2개 생성해주세요.

[대화에서 정한 방향]
${messages.filter(m => m.role === 'user').map(m => `- ${m.content}`).join('\n')}

[이번 베리에이션 스타일]
- 베리에이션 ${startNum}: ${styles[0]}
- 베리에이션 ${startNum + 1}: ${styles[1]}

[생성 규칙]
1. 원본 대본의 구조와 길이를 최대한 유지
2. 대화에서 정한 방향성 반영
3. 각 베리에이션은 독특하고 차별화되어야 함
4. 광고 심의에 걸리지 않는 표현 사용

[출력 형식]
---
[베리에이션 ${startNum}]
(대본 내용 - 원본과 비슷한 길이)

[변경 포인트] ${styles[0]} - 구체적으로 어떻게 바꿨는지

---
[베리에이션 ${startNum + 1}]
(대본 내용 - 원본과 비슷한 길이)

[변경 포인트] ${styles[1]} - 구체적으로 어떻게 바꿨는지

---

딱 2개만 만들어주세요.`

    // 스트리밍 응답
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
              system: systemPrompt,
              messages: [
                ...messages.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: finalPrompt }
              ],
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

  // 일반 대화
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
        max_tokens: 1024,
        system: systemPrompt,
        messages: [
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: userMessage }
        ],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const reply = data.content?.[0]?.text || ''
    
    // 응답에서 준비 완료 여부 확인
    const readyToGenerate = 
      reply.includes('준비') || 
      reply.includes('생성할 수 있') ||
      reply.includes('진행할까요') ||
      reply.includes('시작할까요') ||
      messages.length >= 6
    
    return NextResponse.json({ reply, readyToGenerate })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: '대화 실패' }, { status: 500 })
  }
}
