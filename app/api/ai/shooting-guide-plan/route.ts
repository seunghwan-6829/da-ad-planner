import { NextRequest, NextResponse } from 'next/server'
import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

const MODEL = MODELS.standard
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
2. 대사/자막/스크립트는 절대 만들지 않는다.
3. 모든 텍스트는 한국어. 편집/촬영 전문용어 대신 쉬운 말로.
4. **간단·함축**: 모델이 부담 없이 한눈에 보고 따라할 수 있게 짧게. 세세하게 지시하지 마라(모델이 지친다). 핵심만.
5. 각 shot의 imagePrompt만 영어로 작성한다 (이미지 생성용).

## 각 shot 필드
- name: 짧은 컷 이름 (예: "후킹 컷", "제품 클로즈업", "사용 시연")
- description: 이 컷을 "어떻게 찍으면 되는지"를 친근하고 간단하게 1문장으로. 핵심 동작·표정·느낌만 담고, 과한 디테일/지시는 금지. (예: "제품 가볍게 들고 정면 보며 살짝 미소", "크림 바르는 손동작 자연스럽게 보여주기")
- angle: 카메라 앵글 (예: "정면", "사선 위", "측면 살짝")
- duration: 권장 길이 (예: "2~3초")
- imagePrompt: English. A vertical 9:16 PHOTOREALISTIC reference shot describing exactly this cut (subject, action, framing, angle).
  사실성(중요): 실제 스마트폰/DSLR로 찍은 듯 자연스럽고 사실적인 사진. 자연광, 사실적인 피부 질감과 디테일, 과보정 없는 진짜 사진 느낌(authentic UGC). 스톡사진처럼 인위적/플라스틱하지 않게.
  인물(중요): 사람이 등장하는 컷에서 별도 지정이 없으면 반드시 '자연스러운 외모의 한국인 20대 여성(Korean woman in her 20s)'으로 묘사하라. 컷에 나이/성별/국적이 명시돼 있으면 그것을 따른다.
  반드시 SFW(안전): 단정하게 옷을 갖춰 입은 상태. 노출·속옷·수영복·선정적 포즈·신체 부각/몸매 강조 표현 금지. 얼굴/손 외 피부 노출 묘사 금지. 제품·표정·동작 중심으로 묘사하라.
  End with: "Photorealistic candid photo, natural lighting, realistic skin texture, authentic UGC style, not an over-polished stock photo. Professional, modest, fully-clothed, safe-for-work. No text, no logo, no watermark."

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
    { "name": "...", "description": "...", "angle": "...", "duration": "...", "imagePrompt": "..." }
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
