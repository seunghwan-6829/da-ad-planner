import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { notify, recordEvent } from '@/lib/naver/notify'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

/* 발행 전 미리보기 — 첫 발행 안전장치.
   에이전트가 글쓰기 화면을 제목·본문까지 다 채운 뒤, [등록]을 누르기 전에 화면을 캡처해 올린다.
   사람이 웹에서 '이대로 등록'을 눌러야 실제 등록으로 넘어간다.

   POST : 캡처 업로드 → 글 상태를 'preview' 로 바꾼다(에이전트는 브라우저를 열어둔 채 대기)
   GET ?id= : 사람이 무엇을 눌렀는지 알려준다 → 'approve' | 'cancel' | null(아직) */

function authOk(req: Request): boolean {
  const need = process.env.NC_AGENT_TOKEN || ''
  if (!need) return true
  return req.headers.get('x-agent-token') === need
}

const BUCKET = 'naver-cafe'

export async function POST(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const id = (b.id || '').toString()
  const imageB64 = (b.image || '').toString() // data URL 없이 순수 base64
  if (!id || !imageB64) return NextResponse.json({ error: 'id, image 필요' }, { status: 400 })

  const { data: post } = await supabaseAdmin
    .from('nc_posts')
    .select('id, title, status, cafe_id, nc_cafes(name)')
    .eq('id', id)
    .maybeSingle()
  if (!post) return NextResponse.json({ error: '글을 찾을 수 없습니다.' }, { status: 404 })
  // publishing 상태에서만 미리보기로 넘어갈 수 있다(중복 처리 방지).
  if (post.status !== 'publishing') return NextResponse.json({ error: `현재 상태(${post.status})에서는 미리보기를 올릴 수 없습니다.` }, { status: 409 })

  let publicUrl: string | null = null
  try {
    const buf = Buffer.from(imageB64, 'base64')
    const path = `previews/${id}-${Date.now()}.png`
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: 'image/png', upsert: true })
    if (up.error) throw new Error(up.error.message)
    publicUrl = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
  } catch (e) {
    return NextResponse.json({ error: `캡처 저장 실패: ${String((e as Error).message || e)}` }, { status: 500 })
  }

  // 에디터에 실제로 들어간 글자도 함께 저장한다(캡처가 잘려도 전체 내용을 확인할 수 있게).
  const patch: Record<string, unknown> = {
    status: 'preview',
    preview_url: publicUrl,
    preview_at: new Date().toISOString(),
    preview_decision: null,
    updated_at: new Date().toISOString(),
    typed_title: (b.typed_title ?? '').toString().slice(0, 500),
    typed_body: (b.typed_body ?? '').toString().slice(0, 20000),
  }
  let upd = await supabaseAdmin.from('nc_posts').update(patch).eq('id', id).eq('status', 'publishing')
  if (upd.error && /typed_title|typed_body/.test(upd.error.message)) {
    // 컬럼 미존재(마이그레이션 전) — 캡처만이라도 저장해 확인은 되게 한다.
    delete patch.typed_title; delete patch.typed_body
    upd = await supabaseAdmin.from('nc_posts').update(patch).eq('id', id).eq('status', 'publishing')
  }
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 })

  const cafeName = (post as { nc_cafes?: { name?: string } }).nc_cafes?.name || ''
  await recordEvent(`미리보기 대기 · ${cafeName} · ${post.title}`)
  await notify(`👀 네이버 카페 — 등록 직전 확인이 필요합니다\n· ${cafeName}\n· ${post.title}\n\n대시보드에서 확인하고 [이대로 등록] 또는 [취소]를 눌러주세요.`)
  return NextResponse.json({ ok: true, preview_url: publicUrl })
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'agent unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 })

  const { data } = await supabaseAdmin.from('nc_posts').select('status, preview_decision').eq('id', id).maybeSingle()
  if (!data) return NextResponse.json({ error: '글을 찾을 수 없습니다.' }, { status: 404 })
  // 사람이 결정하면 웹이 preview_decision 을 채운다. 아직이면 null → 에이전트는 계속 대기.
  return NextResponse.json({ status: data.status, decision: data.preview_decision ?? null })
}
