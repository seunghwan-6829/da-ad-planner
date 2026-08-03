import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { generateWeeklyReport } from "@/lib/pb/weekly-report";

/* AI 주간 진단 리포트 — 조회/수동 생성 API (보호 라우트).
   ⚠️ 정기 생성은 사람이 아니라 크론이 한다(/api/pb/weekly-report/cron, 매주 월요일 아침 GitHub Actions).
   화면에는 생성 버튼이 없다 — 이 POST 는 점검·재생성용 API 로만 남겨둔다.
   GET → 최근 리포트 1건 / POST → 즉시 생성(서버 공용 키 우선, 없으면 x-user-api-key) */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  // stats(생성 당시 집계 스냅샷)도 함께 — 화면이 브랜드별 수치를 붙여 인포그래픽으로 그린다.
  const { data, error } = await supabaseAdmin
    .from("pb_weekly_reports")
    .select("id, week_key, content, stats, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ ok: true, report: null, tableMissing: true });
  return NextResponse.json({ ok: true, report: data ?? null });
}

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get("x-user-api-key") || "";
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "서버 ANTHROPIC_API_KEY 또는 사용자 키가 필요해요." }, { status: 401 });
  }
  try {
    const report = await generateWeeklyReport(apiKey);
    return NextResponse.json({ ok: true, report, saved: report.saved });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 생성 실패" }, { status: 500 });
  }
}
