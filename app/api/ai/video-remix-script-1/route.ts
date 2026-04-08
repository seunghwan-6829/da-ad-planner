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

  if (!body.analysisContext?.trim()) {
    return NextResponse.json({ error: '분석 결과가 먼저 필요합니다.' }, { status: 400 })
  }

  const prompt = `당신은 한국 퍼포먼스 마케팅 업계에서 상위권 실력을 가진 숏폼 광고 카피라이터이자 리믹스 디렉터입니다.

목표는 "예쁘게 정리된 대본"이 아니라 "CTR과 시청 유지율이 오를 법한 대본"을 만드는 것입니다.
절대 뻔한 표현, 뜬구름 잡는 카피, generic한 톤으로 쓰지 마세요.

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
- 첫 1~3초에 패턴 인터럽트가 있어야 함
- 시청자가 "어? 왜?" 하고 멈추게 만드는 한 줄을 Hook으로 제시
- 제품 소구점은 초반에 강하게 노출
- 문장은 짧고 세게
- 추상어보다 구체어 사용
- 원본보다 더 성과형 구조로 재설계
- 한국 광고 문맥에 맞는 자연스러운 말투 사용

[금지]
- "당신의 삶을 바꿀", "새로운 경험", "혁신적인", "완벽한 솔루션" 같은 뻔한 표현
- 근거 없는 과장
- 길고 설명적인 문장
- 브랜드/제품/소구점을 대충 뭉개는 표현

[출력 형식]
[리믹스 대본 1안]
- 콘셉트: 어떤 전략의 대본인지 한 줄
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
- 결과물 톤은 "덜 착하고, 더 날카롭게"`

  const stream = createSseStream({
    apiKey,
    body,
    prompt,
    maxTokens: 2200,
  })

  return new Response(stream, { headers: sseHeaders() })
}
