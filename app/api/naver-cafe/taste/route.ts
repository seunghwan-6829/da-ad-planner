import { NextResponse } from 'next/server'
import { buildTasteProfile } from '@/lib/naver/taste'

/* 취향 학습 상태(웹 UI 배지용, 보호 라우트).
   GET → { active, approvedCount, rejectedCount, guidance } */
export const dynamic = 'force-dynamic'

export async function GET() {
  const t = await buildTasteProfile()
  return NextResponse.json({
    ok: true,
    active: t.active,
    approvedCount: t.approvedCount,
    rejectedCount: t.rejectedCount,
    guidance: t.guidance,
  })
}
