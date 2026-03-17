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
    return NextResponse.json({ error: '분석할 대표 프레임이 없습니다.' }, { status: 400 })
  }

  const prompt = `당신은 퍼포먼스 광고 영상 분석가입니다.

업로드된 영상의 대표 프레임과 메타데이터를 바탕으로 아래 내용을 자세히 분석해 주세요.

[영상 정보]
${buildVideoFacts(body) || '없음'}

[프레임 시점]
${buildFrameFacts(body) || '없음'}

[응답 지시]
- 반드시 한국어로 작성
- 성과 개선 관점에서 분석
- 원본의 후킹, 타깃, 장면 흐름, CTA를 구체적으로 진단
- 마지막에 리믹스 방향 힌트도 포함

[출력 형식]
1. 한줄 진단
2. 핵심 타깃 추정
3. 장면 흐름 분석
4. 잘되는 포인트
5. 약한 포인트
6. 리믹스 기회
7. 다음 단계에서 써야 할 대본 방향`

  const stream = createSseStream({
    apiKey,
    body,
    prompt,
    maxTokens: 1800,
  })

  return new Response(stream, { headers: sseHeaders() })
}
