import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 외부 공개용 마인드맵 단건 조회(로그인 불필요 — 공유 뷰어가 사용).
// plan_mindmaps 는 RLS(authenticated)라 service_role(supabaseAdmin)로 우회. 뷰에 필요한 필드만 반환.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!id || !supabaseAdmin) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data, error } = await supabaseAdmin
    .from('plan_mindmaps')
    .select('id, title, source_brand, source_thumb, library_id, data')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(data)
}
