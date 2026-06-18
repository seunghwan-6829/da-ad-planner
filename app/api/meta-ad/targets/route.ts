import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드 추가 직후 그 브랜드만 즉시 크롤하도록 GitHub Actions 워크플로(crawl.yml)를 트리거.
// GH_DISPATCH_TOKEN(repo+workflow 권한 PAT) 이 설정돼 있어야 동작. 없으면 조용히 스킵.
async function triggerCrawl(targetId: string): Promise<boolean> {
  const token = process.env.GH_DISPATCH_TOKEN
  const repo = process.env.GH_REPO || 'seunghwan-6829/da-ad-planner'
  const ref = process.env.GH_BRANCH || 'main'
  if (!token) return false
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/crawl.yml/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref, inputs: { target_id: targetId } }),
    })
    return res.ok // 성공 시 204
  } catch {
    return false
  }
}

// 타겟 목록
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('am_targets')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// 타겟 추가
export async function POST(req: Request) {
  const body = await req.json()
  const type = body.type === 'keyword' ? 'keyword' : 'page'

  const row = {
    label: (body.label || '').trim() || '(이름없음)',
    category: (body.category || '').trim() || '미분류',
    type,
    page_id: type === 'page' ? (body.page_id || '').trim() : null,
    query: type === 'keyword' ? (body.query || '').trim() : null,
    country: (body.country || 'KR').trim(),
    enabled: true,
  }

  if (type === 'page' && !row.page_id) {
    return NextResponse.json({ error: 'page_id 가 필요합니다.' }, { status: 400 })
  }
  if (type === 'keyword' && !row.query) {
    return NextResponse.json({ error: '검색어가 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('am_targets')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 추가 즉시 그 브랜드만 크롤 트리거(5일 주기 안 기다리고 바로 수집)
  const crawl_triggered = await triggerCrawl(data.id)
  return NextResponse.json({ ...data, crawl_triggered })
}
