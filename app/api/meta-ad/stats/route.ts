import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드별 누적 광고 수. { counts: { [target_id]: number }, total }
export async function GET() {
  const { data: targets, error } = await supabaseAdmin.from('am_targets').select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  let total = 0
  for (const t of targets ?? []) {
    const { count } = await supabaseAdmin
      .from('am_ads')
      .select('*', { count: 'exact', head: true })
      .eq('target_id', t.id)
    counts[t.id] = count ?? 0
    total += count ?? 0
  }
  return NextResponse.json({ counts, total })
}
