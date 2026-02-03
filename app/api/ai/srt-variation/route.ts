import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { originalScript, productName, appeals } = body as {
    originalScript: string
    productName?: string
    appeals?: string[]
  }

  if (!originalScript?.trim()) {
    return NextResponse.json({ error: '원본 대본이 필요합니다' }, { status: 400 })
  }

  // 제품 정보 구성
  let productInfo = ''
  if (productName?.trim()) {
    productInfo += `제품명: ${productName.trim()}\n`
  }
  if (appeals && appeals.length > 0) {
    const validAppeals = appeals.filter(a => a.trim())
    if (validAppeals.length > 0) {
      productInfo += `소구점:\n${validAppeals.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n`
    }
  }

  const prompt = `당신은 영상 광고 대본 전문 작가입니다.
아래 원본 대본을 참고하여 비슷한 스타일과 구조로 베리에이션 대본을 만들어주세요.

=== 원본 대본 ===
${originalScript}

${productInfo ? `=== 제품 정보 (반드시 반영) ===\n${productInfo}` : ''}

=== 베리에이션 규칙 ===
1. 원본 대본의 전체적인 톤앤매너, 분위기, 구조를 최대한 유지
2. 문장 스타일(질문형, 감탄형 등)과 길이를 비슷하게 유지
3. 원본의 핵심 메시지 흐름을 따라가되 표현만 다르게
4. 제품명이 있다면 자연스럽게 포함
5. 소구점이 있다면 반드시 녹여내기
6. 광고 심의에 걸리지 않는 표현 사용
7. 원본과 비슷한 줄 수와 길이 유지

=== 출력 형식 ===
베리에이션 대본만 출력하세요. 다른 설명이나 주석 없이 대본 내용만 작성해주세요.`

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
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const variation = data.content?.[0]?.text || ''
    
    return NextResponse.json({ variation })
  } catch (error) {
    console.error('SRT Variation error:', error)
    return NextResponse.json({ error: '베리에이션 생성 실패' }, { status: 500 })
  }
}
