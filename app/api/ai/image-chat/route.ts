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
1. 사용자가 원하는 베리에이션 방향을 파악하기 위해 질문합니다
2. 한 번에 1-2개의 질문만 하세요 (너무 많은 질문 금지)
3. 질문은 선택지를 제공하면 좋습니다 (예: "다음 중 어떤 방향이 좋으신가요?")
4. 3-4번의 질문으로 충분한 정보를 얻으면, 베리에이션 생성 준비가 됐다고 알려주세요

질문 예시 카테고리:
- 타겟 변경 (연령대, 성별, 관심사)
- 톤앤매너 변경 (유머, 진지, 감성, 직접적)
- 소구점 강조 (가격, 품질, 효과, 후기)
- 스타일 변경 (질문형, 명령형, 스토리텔링)
- 특정 키워드나 메시지 강조

응답은 친절하고 전문적으로 해주세요. 이모지를 적절히 사용해도 좋습니다.`

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
