import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 광고주 추가 직후 그 광고주만 즉시 크롤하도록 google-ads-crawl.yml 트리거.
// GH_DISPATCH_TOKEN 설정 시 동작. 없으면 조용히 스킵(정기 크롤이 처리).
async function triggerCrawl(targetId: string): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN
  const repo = process.env.GH_REPO || 'seunghwan-6829/da-ad-planner'
  const ref = process.env.GH_BRANCH || 'main'
  if (!token) return false
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/google-ads-crawl.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: { target_id: targetId } }),
    })
    return res.ok
  } catch {
    return false
  }
}

// 투명성 센터 URL 에서 광고주 ID(AR...)와 지역을 추출.
//   허용: https://adstransparency.google.com/advertiser/AR.../?region=KR (광고 상세 URL 이어도 AR 만 뽑음)
function parseTransparencyUrl(raw: string): { advertiserId: string | null; region: string } {
  const s = (raw || '').trim()
  const ar = s.match(/\/advertiser\/(AR[0-9A-Za-z_-]+)/)
  const region = s.match(/[?&]region=([A-Za-z]{2,20})/)
  return { advertiserId: ar ? ar[1] : /^AR[0-9A-Za-z_-]+$/.test(s) ? s : null, region: region ? region[1].toUpperCase() : 'KR' }
}

// 광고주 목록
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('ga_targets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 광고주 추가 — 투명성 센터 광고주 URL(또는 AR ID) 필요.
export async function POST(req: Request) {
  const body = await req.json()
  const { advertiserId, region } = parseTransparencyUrl(body.url || body.advertiser_id || '')
  if (!advertiserId) {
    return NextResponse.json(
      {
        error:
          "구글 광고 투명성 센터의 '광고주' URL이 필요해요.\nadstransparency.google.com 에서 광고주를 검색해 클릭한 뒤, 주소창의 URL(…/advertiser/AR… 포함)을 복사해 붙여넣어 주세요.",
      },
      { status: 400 }
    )
  }

  const row = {
    label: (body.label || '').trim() || '(이름없음)',
    category: (body.category || '').trim() || '미분류',
    advertiser_id: advertiserId,
    country: (body.country || region || 'KR').trim(),
    enabled: true,
  }

  const { data, error } = await supabaseAdmin.from('ga_targets').insert(row).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const crawl_triggered = body.no_crawl ? false : await triggerCrawl(data.id)
  return NextResponse.json({ ...data, crawl_triggered })
}
