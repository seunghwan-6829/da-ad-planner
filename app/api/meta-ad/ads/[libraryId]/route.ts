import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 광고 메모 저장. PATCH { memo }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ libraryId: string }> }
) {
  const { libraryId } = await params
  const body = await req.json().catch(() => ({}))
  const memo = typeof body.memo === 'string' ? body.memo : ''

  const { data, error } = await supabaseAdmin
    .from('am_ads')
    .update({ memo })
    .eq('library_id', libraryId)
    .select('library_id, memo')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
