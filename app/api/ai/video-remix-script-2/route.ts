import { NextRequest, NextResponse } from 'next/server'
import {
  buildFrameFacts,
  buildVideoFacts,
  createSseStream,
  sseHeaders,
  type VideoRequestPayload,
} from '@/lib/video-ai'

export async function POST(request: NextRequest) {
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  const body = (await request.json()) as VideoRequestPayload
  if (!body.frames?.length) {
    return NextResponse.json({ error: '리믹스할 대표 프레임이 없습니다.' }, { status: 400 })
  }

  if (!body.analysisContext?.trim()) {
    return NextResponse.json({ error: '분석 결과가 먼저 필요합니다.' }, { status: 400 })
  }

  const prompt = `당신은 한국 퍼포먼스 마케팅 업계에서 상위권 실력을 가진 숏폼 광고 카피라이터이자 리믹스 디렉터입니다.

이번에는 1안과 완전히 다른 각도의 리믹스 대본 2안을 작성해야 합니다.
대본 2안은 후킹 방식, 설득 구조, 감정 톤이 1안과 겹치지 않아야 합니다.
목표는 "조금 다른 대본"이 아니라 "다른 논리로 성과를 노리는 대본"입니다.

[영상 정보]
${buildVideoFacts(body) || '없음'}

[프레임 시점]
${buildFrameFacts(body) || '없음'}

[분석 결과]
${body.analysisContext.trim()}

[필수 반영]
- 브랜드명: ${body.brandName?.trim() || '미입력'}
- 제품 정보: ${body.productInfo?.trim() || '미입력'}
- 제품 소구점: ${body.productAppeal?.trim() || '미입력'}
- 제작 목표: ${body.creativeGoal?.trim() || '미입력'}

[대본 전략]
- 1안이 직진형이면 2안은 비교형/반전형/문제제기형처럼 다른 구조 사용
- 첫 1~3초에 강한 대조나 궁금증 유발
- 시청자가 자기 얘기처럼 느낄 지점을 넣기
- 제품 소구점이 억지스럽지 않게 논리로 연결되게 작성
- 문장은 짧고 세게
- abstract한 수식어보다 concrete한 장면과 문장 사용

[금지]
- 1안과 유사한 Hook
- 정리문 같은 톤
- 느슨한 설명형 카피
- 뻔한 자기계발/브랜딩 문장

[출력 형식]
[리믹스 대본 2안]
- 콘셉트: 1안과 어떻게 다른지 한 줄
- Hook: 첫 1초에 꽂히는 한 줄

- Shot 1 (0:00~0:03):
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
- 왜 이 대본이 먹히는지:

[중요]
- 모든 항목은 짧지만 임팩트 있게
- 자막/내레이션은 바로 써먹을 수 있는 수준으로 완성
- 1안보다 더 대조적이고 기억에 남게`

  const stream = createSseStream({
    apiKey,
    body,
    prompt,
    maxTokens: 2200,
  })

  return new Response(stream, { headers: sseHeaders() })
}
