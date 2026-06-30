import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

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

// URL 로 플랫폼/핸들 추정.
function detectPlatform(url: string): { platform: string; handle: string | null } {
  const u = (url || '').trim()
  if (/instagram\.com/i.test(u)) {
    const m = u.match(/instagram\.com\/([^/?#]+)/i)
    return { platform: 'instagram', handle: m ? m[1].replace(/^@/, '') : null }
  }
  // 유튜브: @handle, /channel/UC..., /c/name, /user/name
  if (/youtube\.com|youtu\.be/i.test(u)) {
    const at = u.match(/youtube\.com\/@([^/?#]+)/i)
    if (at) return { platform: 'youtube', handle: at[1] }
    const ch = u.match(/youtube\.com\/(?:channel|c|user)\/([^/?#]+)/i)
    return { platform: 'youtube', handle: ch ? ch[1] : null }
  }
  return { platform: 'youtube', handle: null }
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
  const url = (body.url || '').trim()
  if (!url) return NextResponse.json({ error: '크리에이터 URL 이 필요합니다.' }, { status: 400 })

  const det = detectPlatform(url)
  // 사용자가 명시한 플랫폼이 있으면 우선, 아니면 URL 추정.
  const platform = body.platform === 'youtube' || body.platform === 'instagram' ? body.platform : det.platform

  const row = {
    label: (body.label || '').trim() || det.handle || '(이름없음)',
    platform,
    url,
    handle: det.handle,
    category: (body.category || '').trim() || '미분류',
    enabled: true,
  }

  const { data, error } = await supabaseAdmin.from('om_creators').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const crawl_triggered = body.no_crawl ? false : await triggerCrawl(data.id)
  return NextResponse.json({ ...data, crawl_triggered })
}
