import { NextRequest, NextResponse } from 'next/server'
import { ANTHROPIC_BASE, MODELS } from '@/lib/ai/anthropic'

const MODEL = MODELS.standard
const MAX_TOKENS = 4096

const FRAMEWORK_PROMPTS: Record<string, string> = {
  'harmon-circle': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 댄 하몬의 스토리서클(Story Circle) 8단계로 재구성한다.

## 하몬서클 8단계
1. 일상 (YOU): 주인공의 평범한 현재 모습
2. 욕구 (NEED): 불편함이나 원하는 것 발생
3. 출발 (GO): 해결을 위해 움직임
4. 탐색 (SEARCH): 여러 시도를 해봄
5. 발견 (FIND): 해결책(제품/서비스)을 만남
6. 획득 (TAKE): 제품/서비스를 사용해봄
7. 귀환 (RETURN): 일상으로 돌아옴
8. 변화 (CHANGE): 달라진 더 나은 모습

## 규칙
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 각 단계를 [1. 일상] 형식으로 표시
- 각 단계는 1~3문장으로 짧고 임팩트 있게
- 광고 영상(릴스/숏폼)에 바로 쓸 수 있는 자연스러운 대본으로 작성
- 전체 분량은 원본과 비슷하게 유지
- 부가 설명 없이 대본 텍스트만 출력`,

  'story-spine': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 스토리스파인(Story Spine) 구조로 재구성한다.

## 스토리스파인 7단계
1. "옛날 옛적에..." → 배경과 주인공 소개
2. "매일매일..." → 반복되는 일상이나 문제
3. "그러던 어느 날..." → 변화의 계기 발생
4. "그래서..." → 첫 번째 반응이나 행동
5. "그래서..." → 연쇄 반응, 전개
6. "마침내..." → 클라이맥스, 해결
7. "그 이후로..." → 변화된 새로운 일상

## 규칙
- 각 단계를 위 접속어로 시작하는 자연스러운 이야기체로 작성
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 각 단계 1~3문장, 듣는 사람이 자연스럽게 빠져들게
- 광고 영상에 바로 쓸 수 있는 대본으로 작성
- 부가 설명 없이 대본 텍스트만 출력`,

  '3-act': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 고전적인 3막 구조로 재구성한다.

## 3막 구조
[1막: 설정] → 주인공과 상황 소개, 문제나 욕구를 보여줌. 시청자가 공감하게 만드는 도입부.
[2막: 대립] → 갈등 심화, 시도와 실패, 제품/서비스와의 만남. 긴장감과 전환이 핵심.
[3막: 해결] → 문제 해결, 변화된 결과, 행동 유도(CTA). 만족스러운 마무리.

## 규칙
- [1막: 설정], [2막: 대립], [3막: 해결] 형식으로 구분
- 1막은 공감과 몰입, 2막은 긴장과 전환, 3막은 만족과 행동 유도
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 각 막 2~4문장, 광고 영상에 바로 쓸 수 있게
- 부가 설명 없이 대본 텍스트만 출력`,

  'in-medias-res': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 인 미디어스 레스(In Medias Res) 구조로 재구성한다.

## 인 미디어스 레스 구조
사건의 한가운데부터 시작하여 시청자의 호기심을 자극하고, 이후 과거를 돌아보며 맥락을 채우는 구조.

1. [사건 한가운데]: 가장 극적인 순간이나 놀라운 결과부터 시작. "이게 진짜 됐다고?"
2. [되돌아보기]: "어떻게 여기까지 왔냐면..." 과거로 돌아가 배경 설명
3. [전개]: 문제 상황과 제품/서비스를 만나는 과정
4. [현재로 복귀]: 다시 처음 장면으로 돌아와 맥락 완성
5. [결말]: 최종 결과와 메시지 전달

## 규칙
- 첫 문장부터 시청자를 사로잡는 강렬한 장면으로 시작
- 자연스러운 시간 전환("사실 이건 이렇게 시작됐거든요")
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 광고 영상에 바로 쓸 수 있는 대본으로 작성
- 부가 설명 없이 대본 텍스트만 출력`,

  'save-the-cat': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 세이브 더 캣(Save the Cat) 구조로 재구성한다. 광고에 맞게 핵심 비트만 사용.

## 세이브 더 캣 - 광고용 핵심 비트
1. [오프닝]: 현재 상태를 보여주는 첫 장면
2. [공감 포인트]: 주인공에게 "아 나도 저래" 하고 공감하게 만드는 순간
3. [문제 제시]: 해결해야 할 문제, 불편함 등장
4. [고민]: 어떻게 할지 잠깐 고민하는 모습
5. [전환점]: 제품/서비스를 만나는 결정적 순간
6. [재미와 변화]: 제품 사용, 효과 체험, 재미있는 장면
7. [결과]: 문제 해결, 달라진 모습
8. [마무리]: 변화된 새로운 일상, CTA

## 규칙
- 각 비트를 [비트명] 형식으로 표시
- 시청자가 주인공에게 감정이입하게 만드는 게 핵심
- "공감 포인트"에서 주인공이 착하거나 공감 가는 행동을 보여주기
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 각 비트 1~2문장, 광고 영상에 바로 쓸 수 있게
- 부가 설명 없이 대본 텍스트만 출력`,

  'frame-narrative': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 프레임 내러티브(액자식 구성) 구조로 재구성한다.

## 프레임 내러티브 구조
이야기 속에 이야기가 있는 액자 구성. 누군가가 경험담을 들려주는 형태.

1. [바깥 이야기 - 도입]: 누군가가 이야기를 시작. "이거 진짜 대박인데요", "제가 겪은 건데요", "솔직히 처음엔 안 믿었거든요"
2. [안쪽 이야기 - 본편]: 실제 경험 이야기. 문제 상황 → 제품/서비스 발견 → 사용 → 변화. 생생하고 구체적으로.
3. [바깥 이야기 - 마무리]: 다시 현재로 돌아와 결론. "그래서 지금은...", "진짜 추천이에요", CTA

## 규칙
- 바깥 이야기는 시청자에게 직접 말하는 친근한 톤
- 안쪽 이야기는 실제 경험처럼 생생하게
- 원본 대본의 핵심 메시지와 제품/브랜드를 반드시 유지
- 광고 영상에 바로 쓸 수 있는 대본으로 작성
- 부가 설명 없이 대본 텍스트만 출력`,

  'heros-journey': `광고 대본 스토리텔링 전문가. 주어진 광고 대본을 영웅의 여정(Hero's Journey) 구조로 재구성한다. 광고에 맞게 핵심 단계만 사용.

## 영웅의 여정 - 광고용 핵심 단계
1. [일상 세계]: 주인공의 평범한 일상
2. [모험의 부름]: 문제 발생, 변화가 필요한 순간
3. [부름의 거부]: 처음엔 망설이거나, 다른 방법을 시도
4. [조력자 등장]: 제품/서비스/브랜드와의 만남 (= 멘토 역할)
5. [시련]: 제품을 써보는 과정, 첫 경험
6. [보상]: 효과를 체험, 문제 해결의 기쁨
7. [귀환]: 달라진 일상, 더 나은 모습으로 돌아옴

## 규칙
- 각 단계를 [단계명] 형식으로 표시
- 주인공이 성장하고 변화하는 여정을 강조
- 제품/서비스가 "조력자(멘토)" 역할을 함
- 원본 대본의 핵심 메시지를 반드시 유지
- 각 단계 1~3문장, 광고 영상에 바로 쓸 수 있게
- 부가 설명 없이 대본 텍스트만 출력`
}

export async function POST(request: NextRequest) {
  let body: { script: string; framework: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: '요청 본문이 올바른 JSON이 아닙니다.' },
      { status: 400 }
    )
  }

  const { script, framework } = body
  const apiKey = request.headers.get('x-user-api-key') || process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'API 키가 설정되지 않았습니다. 마이페이지에서 Anthropic API 키를 입력해주세요.' },
      { status: 401 }
    )
  }

  if (!script || !framework) {
    return NextResponse.json(
      { error: '대본(script)과 프레임워크(framework)를 보내주세요.' },
      { status: 400 }
    )
  }

  const systemPrompt = FRAMEWORK_PROMPTS[framework]
  if (!systemPrompt) {
    return NextResponse.json(
      { error: '지원하지 않는 스토리텔링 프레임워크입니다.' },
      { status: 400 }
    )
  }

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
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `다음 광고 대본을 위 스토리텔링 구조로 재구성해주세요. 부가 설명 없이 대본 텍스트만 작성해주세요.\n\n---\n${script}\n---`,
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

    const text =
      data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''

    return NextResponse.json({ result: text, framework, usage: data.usage })
  } catch (err) {
    console.error('스토리텔링 베리에이션 실패:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'API 호출 실패' },
      { status: 500 }
    )
  }
}
