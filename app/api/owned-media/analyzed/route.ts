import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// AI 분석이 저장된 콘텐츠의 post_id 목록(가벼움). has_analysis 배지용(백그라운드 병합).
export async function GET() {
  const { data, error } = await supabaseAdmin.from('om_posts').select('post_id').not('ai_analysis', 'is', null)
  if (error) return NextResponse.json({ ids: [] })
  return NextResponse.json({ ids: (data ?? []).map((r: { post_id: string }) => r.post_id) })
}
