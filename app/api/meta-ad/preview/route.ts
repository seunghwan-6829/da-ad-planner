import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

export const META_AD_CATEGORIES = [
  '뷰티 & 에어케어',
  '패션 & 의류',
  '음식 & 음료',
  '리빙 & 인테리어',
  '육아 & 동물',
  '의료 & 건강',
  '교육 & 강의',
  'IT & 전자기기',
  '기타',
]

// POST { name, url } → { category, focus }  (브랜드 분석 미리보기)
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 설정되지 않았습니다.' }, { status: 500 })
  }

  const body = await req.json().catch(() => ({}))
  const name: string = (body.name || '').toString().trim()
  const url: string = (body.url || '').toString().trim()

  if (!name && !url) {
    return NextResponse.json({ error: '브랜드 이름 또는 URL을 보내주세요.' }, { status: 400 })
  }

  const prompt = `브랜드 이름: ${name || '(미입력)'}
광고 라이브러리 URL/ID: ${url || '(미입력)'}

이 브랜드가 어떤 제품/서비스를 중점적으로 광고하는지 한국어로 1~2문장으로 간단히 추정해줘.
그리고 아래 대분류 후보 중에서 가장 알맞은 하나를 골라줘. 확실하지 않으면 이름에서 합리적으로 추정하고, 그래도 애매하면 "기타".

대분류 후보: ${META_AD_CATEGORIES.join(', ')}

반드시 아래 JSON 형식으로만 답해. 다른 텍스트 없이.
{"category": "후보 중 하나", "focus": "이 브랜드가 중점적으로 광고하는 내용 1~2문장"}`

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
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message ?? 'Anthropic API 오류' }, { status: res.status })
    }

    const text = data.content?.find((b: { type: string }) => b.type === 'text')?.text ?? ''
    const m = text.match(/\{[\s\S]*\}/)
    let category = '기타'
    let focus = ''
    if (m) {
      try {
        const parsed = JSON.parse(m[0])
        focus = (parsed.focus || '').toString().trim()
        const c = (parsed.category || '').toString().trim()
        category = META_AD_CATEGORIES.includes(c) ? c : '기타'
      } catch {
        focus = text.trim().slice(0, 200)
      }
    } else {
      focus = text.trim().slice(0, 200)
    }

    return NextResponse.json({ category, focus })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
