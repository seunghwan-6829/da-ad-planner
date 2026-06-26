import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 클라이언트 브랜드 브리프 저장(어떤 브랜드/강점/소구점).
// 보안: '관리자'만 가능 — 프론트에서 가려도 직접 호출로 우회될 수 있으므로 서버에서 강제 검증.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // 1) 호출자 인증 (Authorization: Bearer <access_token>)
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return NextResponse.json({ error: '인증 토큰이 없습니다.' }, { status: 401 })

  const { data: userData, error: uErr } = await supabaseAdmin.auth.getUser(token)
  const caller = userData?.user
  if (uErr || !caller) return NextResponse.json({ error: '유효하지 않은 세션입니다.' }, { status: 401 })

  // 2) 관리자 검증
  const { data: callerProfile } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('id', caller.id)
    .single()
  if (callerProfile?.role !== 'admin') {
    return NextResponse.json({ error: '관리자만 브랜드 브리프를 수정할 수 있습니다.' }, { status: 403 })
  }

  // 3) 보낸 필드만 갱신
  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (typeof body.brand_brief === 'string') patch.brand_brief = body.brand_brief
  if (typeof body.strengths === 'string') patch.strengths = body.strengths
  if (typeof body.selling_points === 'string') patch.selling_points = body.selling_points
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: '갱신할 필드가 없습니다.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('clients')
    .update(patch)
    .eq('id', id)
    .select('id, brand_brief, strengths, selling_points')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
