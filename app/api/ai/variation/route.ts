import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

interface AdvertiserInfo {
  guidelines_image?: string | null
  guidelines_video?: string | null
  products?: string[] | null
  appeals?: string[] | null
  cautions?: string | null
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { baseCopy, advertiserName, mediaType, advertiser } = body as {
    baseCopy: string
    advertiserName?: string
    mediaType: 'image' | 'video'
    advertiser?: AdvertiserInfo | null
  }

  // 지침서 선택
  const guidelines = advertiser 
    ? (mediaType === 'image' ? advertiser.guidelines_image : advertiser.guidelines_video)
    : null

  let context = ''
  if (advertiserName) context += `광고주: ${advertiserName}\n`
  if (advertiser?.products?.length) context += `제품: ${advertiser.products.join(', ')}\n`
  if (advertiser?.appeals?.length) context += `소구점: ${advertiser.appeals.join(', ')}\n`
  if (guidelines) context += `지침서: ${guidelines}\n`
  if (advertiser?.cautions) context += `주의사항: ${advertiser.cautions}\n`

  const prompt = `당신은 광고 카피 전문 카피라이터입니다.
아래 ${mediaType === 'image' ? '이미지' : '영상'} 광고 카피의 베리에이션을 6개 만들어주세요.

원본 카피: "${baseCopy}"

${context ? `[광고주 정보]\n${context}` : ''}

베리에이션 규칙:
1. 원본 카피의 핵심 메시지와 톤은 유지
2. 다양한 표현 방식으로 변형 (질문형, 명령형, 감탄형 등)
3. 각각 다른 느낌을 주되 일관성 유지
4. 지침서가 있다면 반드시 따르기
5. 소구점 반영하기

출력 형식 (정확히 따를 것):
1. 메인카피: 서브카피
2. 메인카피: 서브카피
3. 메인카피: 서브카피
4. 메인카피: 서브카피
5. 메인카피: 서브카피
6. 메인카피: 서브카피

다른 설명 없이 6개만 출력하세요.`

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
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    
    // 파싱
    const lines = text.split('\n').filter((l: string) => l.trim())
    const variations: { title: string; description: string }[] = []
    
    for (const line of lines) {
      const match = line.match(/^\d+\.\s*(.+?):\s*(.+)$/)
      if (match) {
        variations.push({ title: match[1].trim(), description: match[2].trim() })
      }
    }
    
    return NextResponse.json({ variations })
  } catch (error) {
    console.error('Variation error:', error)
    return NextResponse.json({ error: '베리에이션 실패' }, { status: 500 })
  }
}
