import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseCreatorUrl } from '@/lib/owned-media-url'

export const dynamic = 'force-dynamic'

// 크리에이터 추가 직후 그 크리에이터만 즉시 크롤하도록 owned-media-crawl.yml 트리거.
// GH_DISPATCH_TOKEN(repo+workflow 권한 PAT) 설정 시 동작. 없으면 조용히 스킵(정기 크롤이 처리).
async function triggerCrawl(creatorId: string): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN
  const repo = process.env.GH_REPO || 'seunghwan-6829/da-ad-planner'
  const ref = process.env.GH_BRANCH || 'main'
  if (!token) return false
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/owned-media-crawl.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: { creator_id: creatorId } }),
    })
    return res.ok
  } catch {
    return false
  }
}

// 크리에이터 목록
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('om_creators')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 크리에이터 추가
export async function POST(req: Request) {
  const body = await req.json()

  // 입력(URL/핸들) 검증·정규화. 게시물/영상 링크나 못 알아보는 주소는 친절한 에러로 막는다.
  const parsed = parseCreatorUrl(body.url || '')
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const row = {
    label: (body.label || '').trim() || parsed.handle || '(이름없음)',
    platform: parsed.platform,
    url: parsed.url, // 정규화된 채널/프로필 URL(크롤러가 그대로 사용 → 안정적)
    handle: parsed.handle,
    category: (body.category || '').trim() || '미분류',
    enabled: true,
  }

  const { data, error } = await supabaseAdmin.from('om_creators').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const crawl_triggered = body.no_crawl ? false : await triggerCrawl(data.id)
  return NextResponse.json({ ...data, crawl_triggered })
}
