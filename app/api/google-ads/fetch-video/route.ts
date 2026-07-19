import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 영상 재생 상태 조회 — ⚠️ Apify 호출 없음(과금 0).
//   페이지의 재생 경로는 ① 저장본 → ② 유튜브 임베드 순이고, 이 라우트는 둘 다 안 될 때의 마지막 확인용이다.
//   ※ 서버(Vercel)에서 유튜브 주소를 직접 뽑는 방법은 실측 결과 불가능하다.
//     데이터센터 IP 는 유튜브가 봇으로 판정해 막는다(LOGIN_REQUIRED). 그래서 재생은 임베드가 주 경로다.
//     임베드는 보는 사람의 인터넷으로 유튜브가 직접 재생하므로 어느 PC 에서든 되고 비용도 0이다.
const isStored = (u: string | null) => !!u && /\/storage\/v1\/object\//.test(u)

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}))
  const libraryId = (body.library_id || '').toString().trim()
  if (!libraryId) return NextResponse.json({ error: 'library_id 필요' }, { status: 400 })

  const { data: ad, error } = await supabaseAdmin
    .from('ga_ads')
    .select('library_id, media_url, media_path')
    .eq('library_id', libraryId)
    .single()
  if (error || !ad) return NextResponse.json({ error: '광고를 찾을 수 없습니다.' }, { status: 404 })

  // 이미 받아둔 영상 → 바로 재생.
  if (isStored(ad.media_url)) return NextResponse.json({ done: true, url: ad.media_url })

  // 원본이 유튜브에서 내려간 영상(삭제/차단) → 영영 재생 불가. 정직하게 안내.
  if (ad.media_path === 'dead') {
    return NextResponse.json({ dead: true, error: '원본 영상이 유튜브에서 삭제/차단돼 재생할 수 없어요.' })
  }

  // 저장본 없음 → 클라이언트가 상황(임베드 차단 / 영상주소 없음)에 맞는 안내를 고르도록 사유만 알려준다.
  return NextResponse.json({ notReady: true })
}
