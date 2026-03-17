import { NextRequest, NextResponse } from 'next/server'
import {
  buildFrameFacts,
  buildVideoFacts,
  createSseStream,
  sseHeaders,
  type VideoRequestPayload,
} from '@/lib/video-ai'

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = (await request.json()) as VideoRequestPayload
  if (!body.frames?.length) {
    return NextResponse.json({ error: '리믹스할 대표 프레임이 없습니다.' }, { status: 400 })
  }

  const prompt = `당신은 퍼포먼스 광고 영상 카피라이터이자 숏폼 리믹스 디렉터입니다.

대표 프레임과 메타데이터를 바탕으로 리믹스 대본 2안을 작성해 주세요.
1안과 달리 다른 후킹 각도와 다른 전개를 사용해야 합니다.

[영상 정보]
${buildVideoFacts(body) || '없음'}

[프레임 시점]
${buildFrameFacts(body) || '없음'}

[대본 목표]
- 1안보다 더 다른 후킹 방식
- 문제 제기형 또는 비교형 구조
- 제품 소구점이 설득 논리로 자연스럽게 이어지게 구성

[필수 반영]
- 브랜드명: ${body.brandName?.trim() || '미입력'}
- 제품 정보: ${body.productInfo?.trim() || '미입력'}
- 제품 소구점: ${body.productAppeal?.trim() || '미입력'}
- 제작 목표: ${body.creativeGoal?.trim() || '미입력'}

[출력 형식]
[리믹스 대본 2안]
- 콘셉트:
- Hook:
- Shot 1:
  화면:
  자막:
  내레이션:
  편집포인트:
- Shot 2:
  화면:
  자막:
  내레이션:
  편집포인트:
- Shot 3:
  화면:
  자막:
  내레이션:
  편집포인트:
- Shot 4:
  화면:
  자막:
  내레이션:
  편집포인트:
- 엔딩 CTA:
- 썸네일 카피:

반드시 15~30초 분량의 실제 제작 가능한 수준으로 구체적으로 작성하세요.`

  const stream = createSseStream({
    apiKey,
    body,
    prompt,
    maxTokens: 2200,
  })

  return new Response(stream, { headers: sseHeaders() })
}
