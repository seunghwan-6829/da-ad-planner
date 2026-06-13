import { NextRequest, NextResponse } from 'next/server'

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 4096

export async function POST(request: NextRequest) {
  let body: { clientName: string; cuts: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '요청 본문이 올바른 JSON이 아닙니다.' }, { status: 400 })
  }

  const { clientName, cuts = [] } = body
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Anthropic API 키가 없습니다. 마이페이지에서 입력해주세요.' },
      { status: 401 }
    )
  }
  if (!cuts.length) {
    return NextResponse.json({ error: '컷 설명(cuts)을 1개 이상 보내주세요.' }, { status: 400 })
  }

  const cutList = cuts.map((c, i) => `${i + 1}. ${c}`).join('\n')

  const systemPrompt = `너는 "${clientName}" 브랜드의 Meta DA(숏폼 세로 광고) 촬영을 설계하는 시니어 영상 디렉터다.
사용자가 "찍을 컷"을 ${cuts.length}개 적어줬다. 각 컷을 모델/촬영자가 현장에서 바로 이해할 수 있는 촬영 가이드로 변환하라.

## 핵심 규칙
1. 반드시 입력된 컷 개수(${cuts.length}개)와 동일한 수의 shot을 만든다. 순서도 동일하게 유지한다. (입력 컷 1개 = shot 1개)
2. 대사/자막/스크립트는 절대 만들지 않는다. 오직 "화면에 무엇이 어떻게 보이는지(화면 설명)"만 작성한다.
3. 모든 텍스트는 한국어. 편집/촬영 전문용어 대신 쉬운 말로.
4. 각 shot의 imagePrompt만 영어로 작성한다 (이미지 생성용).

## 각 shot 필드
- name: 짧은 컷 이름 (예: "후킹 컷", "제품 클로즈업", "사용 시연")
- description: 화면 설명. 모델의 동작·표정·구성이 무엇인지 한두 문장. (대사 없음)
- framing: 구도 (예: "얼굴 타이트 클로즈업", "미디엄(가슴 위)", "손+제품 클로즈업")
- angle: 카메라 앵글 (예: "정면", "사선 위", "측면 살짝")
- duration: 권장 길이 (예: "2~3초")
- direction: 현장 촬영 디렉션 한 줄 (예: "표정 과하지 않게, 시선은 카메라로")
- imagePrompt: English. A vertical 9:16 photographic reference shot describing exactly this cut (subject, action, framing, angle). Realistic, clean lighting, natural.
  반드시 SFW(안전): 인물은 단정하게 옷을 갖춰 입은 상태로, 노출·속옷·수영복·선정적 포즈·신체 부각 표현을 절대 쓰지 마라. 얼굴/손 외 피부 노출 묘사 금지. 신체 부위(가슴, 허리, 다리, 엉덩이 등)나 몸매를 강조하는 단어를 쓰지 마라. 제품·표정·동작 중심으로 단정하고 광고용으로 묘사하라.
  End with: "Professional, modest, fully-clothed, safe-for-work commercial photo. No text, no logo, no watermark."

## 전체 필드
- title: 이 촬영 가이드의 짧은 제목 (브랜드/내용 반영, 예: "${clientName} 신제품 UGC 촬영 가이드")
- ratio: "9:16" 고정
- tips: 모든 컷에 공통으로 적용되는 촬영 팁 한 줄 (예: "각 컷 앞뒤 1초 여유 · 컷당 2~3 테이크 · 자연광 활용")

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "title": "...",
  "ratio": "9:16",
  "tips": "...",
  "shots": [
    { "name": "...", "description": "...", "framing": "...", "angle": "...", "duration": "...", "direction": "...", "imagePrompt": "..." }
  ]
}`

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
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음 ${cuts.length}개의 컷을 촬영 가이드로 만들어줘.\n\n${cutList}`,
          },
        ],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json(
        { error: data.error?.message ?? 'Anthropic API 오류', details: data },
        { status: res.status }
      )
    }

    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      return NextResponse.json({ error: 'AI 응답에서 JSON을 파싱할 수 없습니다.', raw: text }, { status: 500 })
    }

    const parsed = JSON.parse(jsonMatch[0])
    // 컷 개수 안전장치: 입력 개수에 맞춤
    const shots = Array.isArray(parsed.shots) ? parsed.shots.slice(0, cuts.length) : []

    return NextResponse.json({
      title: parsed.title || `${clientName} 촬영 가이드`,
      ratio: parsed.ratio || '9:16',
      tips: parsed.tips || '',
      shots,
      usage: data.usage,
    })
  } catch (err) {
    console.error('촬영 가이드 기획 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 호출 실패' },
      { status: 500 }
    )
  }
}
