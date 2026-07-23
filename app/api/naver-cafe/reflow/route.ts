import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { reflowBody } from '@/lib/naver/generate'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// 기존(미발행) 초안들의 본문 '줄바꿈'만 보기 좋게 정리한다. 내용·제목은 그대로.
//   POST → { reflowed, total }
//
// 미들웨어 API_EXCEPTIONS 에 등록돼 로그인 없이도 호출된다.
//   근거: 파괴적이지 않다 — 삭제·데이터노출·콘텐츠생성 없이, 이미 있는 본문의 줄바꿈만 재정렬한다.
//        이미 정리된 글은 바뀔 게 없어 건너뛴다(멱등).
const PENDING = ['draft', 'approved', 'queued', 'preview', 'rejected', 'failed', 'saved']

export async function POST() {
  if (!supabaseAdmin) return NextResponse.json({ error: '서버 DB 연결이 설정되지 않았어요.' }, { status: 500 })
  const { data: rows, error } = await supabaseAdmin
    .from('nc_posts').select('id, body, kind').in('status', PENDING).limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let reflowed = 0, unchanged = 0, failed = 0
  const nlSample: { before: number; after: number }[] = []
  let firstError = ''
  for (const r of (rows || []) as { id: string; body: string; kind?: string }[]) {
    if (r.kind === 'comment') continue // 댓글은 한 덩어리로 두므로 대상 아님
    const before = String(r.body || '')
    const nb = reflowBody(before)
    if (nlSample.length < 6) nlSample.push({ before: (before.match(/\n/g) || []).length, after: (nb.match(/\n/g) || []).length })
    if (!nb || nb === before) { unchanged++; continue }
    const up = await supabaseAdmin.from('nc_posts').update({ body: nb, updated_at: new Date().toISOString() }).eq('id', r.id)
    if (up.error) { failed++; if (!firstError) firstError = up.error.message } else reflowed++
  }
  return NextResponse.json({ ok: true, total: (rows || []).length, reflowed, unchanged, failed, nlSample, firstError: firstError || undefined })
}
