import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

// 브랜드별 누적 광고 수. { counts: { [target_id]: number }, total }
// 브랜드 수만큼 count 쿼리를 돌리던 N+1 방식 → target_id 한 컬럼만 한 번에 읽어 집계(빠름).
export async function GET() {
  const { data, error } = await supabaseAdmin.from('am_ads').select('target_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const counts: Record<string, number> = {}
  let total = 0
  for (const r of data ?? []) {
    if (!r.target_id) continue
    counts[r.target_id] = (counts[r.target_id] || 0) + 1
    total += 1
  }
  return NextResponse.json({ counts, total })
}
