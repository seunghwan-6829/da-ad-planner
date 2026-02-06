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
    imageAnalysis, 
    messages, 
    userMessage,
    generateFinal 
  } = body as { 
    imageAnalysis: string
    messages: Message[]
    userMessage: string
    generateFinal?: boolean
  }

  // 시스템 프롬프트
  const systemPrompt = `당신은 광고 소재 베리에이션 전문가입니다. 
사용자가 업로드한 광고 이미지를 분석한 결과를 바탕으로, 사용자와 대화하며 베리에이션 방향을 정합니다.

[이미지 분석 결과]
${imageAnalysis}

---

당신의 역할:
1. 사용자가 원하는 베리에이션 방향을 파악하기 위해 단계별로 질문합니다
2. 한 번에 1개의 주제에 대해서만 질문하세요
3. **반드시 클릭 가능한 선택지를 제공하세요** - 아래 형식을 꼭 지켜주세요:

[선택지 형식 규칙]
- 선택지는 반드시 "A. 선택지내용" 또는 "1. 선택지내용" 형식으로 작성
- 각 선택지는 새 줄에 하나씩
- 2-5개 사이의 선택지 제공
- 다중 선택이 필요하면 "(여러 개 선택 가능)" 문구 추가

예시:
"다음 중 어떤 톤이 좋으신가요?

A. 유머러스하고 재미있는 톤
B. 진지하고 신뢰감 있는 톤
C. 감성적이고 따뜻한 톤
D. 직접적이고 강렬한 톤"

질문 순서:
1. 먼저 제품/서비스 정보 파악 (첫 대화에서 처리됨)
2. 타겟 고객층 변경 여부
3. 톤앤매너 방향
4. 강조하고 싶은 소구점
5. 3-4번의 대화 후 베리에이션 생성 준비 완료 알림

응답은 친절하게 해주세요. 이모지를 적절히 사용해도 좋습니다.
선택지 형식을 반드시 지켜주세요 (클릭 버튼으로 변환됩니다).`

  // 최종 생성 요청인 경우
  if (generateFinal) {
    const finalPrompt = `지금까지의 대화를 바탕으로, 광고 카피 베리에이션을 6개 생성해주세요.

[대화 히스토리]
${messages.map(m => `${m.role === 'user' ? '사용자' : 'AI'}: ${m.content}`).join('\n')}

[생성 규칙]
1. 원본 광고의 핵심 메시지는 유지
2. 대화에서 파악한 방향성 반영
3. 각 베리에이션은 독특하고 차별화되어야 함
4. 광고 심의에 걸리지 않는 표현 사용

[출력 형식]
각 베리에이션은 다음 형식으로:
---
[베리에이션 N]
메인 카피: (15자 이내 강렬한 헤드라인)
서브 카피: (메인을 보완하는 설명)
변경 포인트: (원본 대비 무엇을 변경했는지 간단 설명)
---

총 6개를 생성해주세요.`

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
          max_tokens: 4096,
          system: systemPrompt,
          messages: [
            ...messages.map(m => ({
              role: m.role,
              content: m.content
            })),
            { role: 'user', content: finalPrompt }
          ],
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
      }

      const data = await res.json()
      const reply = data.content?.[0]?.text || ''
      
      return NextResponse.json({ 
        reply, 
        isComplete: true 
      })
    } catch (error) {
      console.error('Chat error:', error)
      return NextResponse.json({ error: '생성 실패' }, { status: 500 })
    }
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
          ...messages.map(m => ({
            role: m.role,
            content: m.content
          })),
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
    
    // 응답에서 "준비되었" 또는 "생성할 수 있" 같은 표현이 있으면 완료 가능 상태
    const readyToGenerate = 
      reply.includes('준비') || 
      reply.includes('생성할 수 있') ||
      reply.includes('진행할까요') ||
      reply.includes('시작할까요') ||
      messages.length >= 6 // 3번 이상의 왕복 대화
    
    return NextResponse.json({ 
      reply, 
      readyToGenerate 
    })
  } catch (error) {
    console.error('Chat error:', error)
    return NextResponse.json({ error: '대화 실패' }, { status: 500 })
  }
}
