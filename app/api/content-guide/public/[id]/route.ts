import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 외부 공개용(로그인 불필요) 컨텐츠 가이드 단건 조회. 스토리보드만 노출(기능 버튼은 프론트에서 숨김).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { data, error } = await supabaseAdmin
    .from('content_guides')
    .select('id, title, source_brand, library_id, data')
    .eq('id', id)
    .single()
  if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(data)
}
