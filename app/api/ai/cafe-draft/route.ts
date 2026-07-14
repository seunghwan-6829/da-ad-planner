import { NextResponse } from 'next/server'
import { getNaverSettings } from '@/lib/naver/settings'
import { draftPost, draftComment, type DraftCafe } from '@/lib/naver/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 수동 초안/댓글 생성. 회사 공용 키(서버 env) 우선 → 없으면 사용자 키(x-user-api-key).
//   POST { cafe:{name,persona|tone,topics,notes,emphasis,selling_point,rules}, topic, kind?, source_title?, source_excerpt? }
//   kind='comment' → { body }, 그 외 → { title, body }
export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-user-api-key')
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Vercel 환경변수 ANTHROPIC_API_KEY 를 등록하거나, 마이페이지에서 Anthropic 키를 입력해 주세요.' },
      { status: 401 }
    )
  }

  const b = await req.json().catch(() => ({}))
  const c = b.cafe || {}
  const cafe: DraftCafe = {
    name: c.name || '(이름 없음)',
    persona: c.persona || c.tone || '',
    topics: c.topics || '',
    notes: c.notes || '',
    emphasis: Array.isArray(c.emphasis) ? c.emphasis : (typeof c.emphasis === 'string' ? c.emphasis.split(/[,\n]/).map((s: string) => s.trim()).filter(Boolean) : []),
    selling_point: c.selling_point || '',
    rules: c.rules || null,
  }
  const kind = b.kind === 'comment' ? 'comment' : 'post'
  const { claude } = await getNaverSettings()

  try {
    if (kind === 'comment') {
      const src = (b.source_title || '').toString().trim()
      if (!src) return NextResponse.json({ error: '댓글 대상 원글 제목이 필요해요.' }, { status: 400 })
      const body = await draftComment(apiKey, cafe, src, (b.source_excerpt || '').toString(), claude.model, 800)
      return NextResponse.json({ body })
    }
    const topic = (b.topic || '').toString().trim()
    if (!topic) return NextResponse.json({ error: '글 주제를 입력해 주세요.' }, { status: 400 })
    const { title, body } = await draftPost(apiKey, cafe, topic, claude.model, claude.max_tokens)
    return NextResponse.json({ title, body })
  } catch (e) {
    const msg = e instanceof Error ? e.message : '초안 생성 중 오류가 발생했어요.'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
