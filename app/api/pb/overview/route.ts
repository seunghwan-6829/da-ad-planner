import { NextResponse } from "next/server";
import { buildOverviewData } from "@/lib/pb/overview-data";

// 데이터 추적 '전체 대시보드' — 최근 7일 vs 이전 7일, 브랜드별 요약.
// /api/pb/* 는 middleware 보호 경로(로그인 필요)라 익명 노출 없음.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await buildOverviewData();
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "overview 실패" }, { status: 500 });
  }
}
