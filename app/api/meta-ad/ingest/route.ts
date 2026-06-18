import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 실제 브라우저(일반 IP)로 스크롤해 수집한 전 광고를 받아 누적 저장한다.
// GitHub Actions(데이터센터 IP)는 ~30개만 받지만, 일반 브라우저는 전부 받으므로
// 그 결과를 여기로 POST 해 upsert. 미디어 파일 다운로드는 backfill 워크플로가 따로 수행.
//
// 브라우저(facebook.com)에서 직접 호출하므로 CORS 허용(읽기전용성 데이터, 유효 target_id 필요).
const CORS = {
  'Access-Control-Allow-Origin': 'https://www.facebook.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: Request) {
  if (!supabaseAdmin) return NextResponse.json({ error: 'no admin' }, { status: 500, headers: CORS })

  const body = await req.json().catch(() => ({}))
  const targetId: string | undefined = body.target_id
  const ads: any[] = Array.isArray(body.ads) ? body.ads : []
  if (!targetId || ads.length === 0) {
    return NextResponse.json({ error: 'target_id 와 ads 가 필요합니다.' }, { status: 400, headers: CORS })
  }

  // 유효한 타겟인지 확인(아무나 임의 데이터 못 넣게 최소 가드)
  const { data: tgt } = await supabaseAdmin.from('am_targets').select('id').eq('id', targetId).single()
  if (!tgt) return NextResponse.json({ error: '존재하지 않는 target_id' }, { status: 400, headers: CORS })

  const ids = ads.map((a) => String(a.library_id)).filter(Boolean)
  const { data: existRows } = await supabaseAdmin.from('am_ads').select('library_id, downloaded').in('library_id', ids)
  const downloadedSet = new Set((existRows || []).filter((r) => r.downloaded).map((r) => r.library_id))
  const existingSet = new Set((existRows || []).map((r) => r.library_id))

  const now = new Date().toISOString()
  const base = (a: any) => ({
    library_id: String(a.library_id),
    target_id: targetId,
    page_name: a.page_name ?? null,
    started_on: a.started_on ?? null,
    ad_text: typeof a.ad_text === 'string' ? a.ad_text.slice(0, 1000) : null,
    media_type: a.media_type ?? null,
    landing_url: a.landing_url ?? null,
    status: 'active',
    ended_at: null,
    last_seen_at: now,
  })

  // 이미 우리 스토리지에 보관된 미디어가 있는 광고 → 미디어 필드는 건드리지 않음(보존)
  const keepMedia = ads.filter((a) => downloadedSet.has(String(a.library_id))).map(base)
  // 신규/미보관 → fbcdn URL 저장 + downloaded=false (backfill 이 다운로드)
  const withMedia = ads
    .filter((a) => !downloadedSet.has(String(a.library_id)))
    .map((a) => ({
      ...base(a),
      media_url: a.media_url ?? null,
      media_urls: Array.isArray(a.media_urls) && a.media_urls.length ? a.media_urls : null,
      downloaded: false,
    }))

  let err: { message: string } | null = null
  if (keepMedia.length) {
    const { error } = await supabaseAdmin.from('am_ads').upsert(keepMedia, { onConflict: 'library_id' })
    if (error) err = error
  }
  if (withMedia.length) {
    const { error } = await supabaseAdmin.from('am_ads').upsert(withMedia, { onConflict: 'library_id' })
    if (error) err = error
  }
  if (err) return NextResponse.json({ error: err.message }, { status: 500, headers: CORS })

  const newCount = ids.filter((id) => !existingSet.has(id)).length
  return NextResponse.json(
    { received: ads.length, new: newCount, updated: ads.length - newCount },
    { headers: CORS }
  )
}
