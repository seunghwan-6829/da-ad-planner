import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-opus-4-5-20251101'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API 키 없음' }, { status: 500 })
  }

  const body = await request.json()
  const { 
    script, 
    mediaType, 
    advertiserName, 
    existingGuidelines,
    existingAppeals,
    existingCautions
  } = body

  const isVideo = mediaType === 'video'
  const typeLabel = isVideo ? '영상 광고 대본' : '이미지 광고 카피'

  const prompt = `당신은 광고 기획 전문가입니다.
아래 ${typeLabel}을 분석하여 광고 제작 지침서를 만들어주세요.

광고주: ${advertiserName || '미지정'}

=== 입력된 ${isVideo ? '대본' : '카피'} ===
${script}

=== 기존 정보 (참고용) ===
기존 지침서: ${existingGuidelines || '없음'}
기존 소구점: ${existingAppeals?.join(', ') || '없음'}
기존 주의사항: ${existingCautions || '없음'}

=== 분석 요청 ===
위 ${isVideo ? '대본' : '카피'}을 분석하여 다음을 추출해주세요:

1. guidelines: 이 ${isVideo ? '대본' : '카피'}의 스타일, 톤앤매너, 구조적 특징을 정리한 지침서
   - ${isVideo ? '씬 구성 방식, 나레이션 스타일, 전환 방식' : '헤드라인 스타일, 서브카피 패턴'} 등 포함
   - 다음에 비슷한 광고를 만들 때 참고할 수 있도록 구체적으로 작성
   - 기존 지침서가 있다면 통합하여 업데이트

2. appeals: 이 ${isVideo ? '대본' : '카피'}에서 사용된 핵심 소구점 (배열, 최대 5개)
   - 예: "2주 만에 효과", "전문가 추천", "한정 특가" 등

3. cautions: ${isVideo ? '대본' : '카피'}에서 발견된 주의해야 할 표현이나 패턴 (있으면)
   - 광고 심의에 걸릴 수 있는 표현 등

반드시 아래 JSON 형식으로만 응답하세요:
{"guidelines":"지침서 내용","appeals":["소구점1","소구점2"],"cautions":"주의사항 (없으면 빈 문자열)"}`

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
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return NextResponse.json({ error: err.error?.message ?? 'API 오류' }, { status: 500 })
    }

    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    
    // JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0])
      return NextResponse.json({
        guidelines: parsed.guidelines || '',
        appeals: parsed.appeals || [],
        cautions: parsed.cautions || ''
      })
    }
    
    return NextResponse.json({ 
      guidelines: '',
      appeals: [],
      cautions: ''
    })
  } catch (error) {
    console.error('Learn error:', error)
    return NextResponse.json({ error: '분석 실패' }, { status: 500 })
  }
}
