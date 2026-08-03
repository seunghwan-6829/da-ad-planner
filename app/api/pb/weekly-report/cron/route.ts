import { NextResponse } from "next/server";
import { generateWeeklyReport, reportExists } from "@/lib/pb/weekly-report";
import { lastCompletedWeekRange } from "@/lib/pb/overview-data";

/* 주간 리포트 크론 — 매주 월요일 아침(GitHub Actions)이 호출.
   '지난 완결 주(월~일)' 데이터를 모아 리포트를 자동 작성한다. 사람이 버튼 누를 일 없음.

   익명 공개 엔드포인트(middleware 예외)라서 비용 가드가 핵심:
   - 그 주 리포트가 이미 있으면 즉시 skip(멱등) → 아무리 눌러도 주 1회만 생성됨.
   - 리포트 테이블이 없으면(마이그레이션 전) 생성 자체를 거부 — 중복 방지가 불가능한 상태에서 토큰이 새는 걸 차단.
   - 서버 공용 키(ANTHROPIC_API_KEY)만 사용. */

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY || "";
  if (!apiKey) return NextResponse.json({ ok: false, error: "서버 ANTHROPIC_API_KEY 미설정" }, { status: 401 });

  const range = lastCompletedWeekRange();
  const { exists, tableMissing, structured } = await reportExists(range.end);
  if (tableMissing) {
    return NextResponse.json(
      { ok: false, error: "pb_weekly_reports 테이블이 없어요 — Supabase 에서 db/pb-replays.sql 을 먼저 실행하세요." },
      { status: 503 },
    );
  }
  /* force=1: 옛 포맷(마크다운) 리포트를 새 포맷(구조화 JSON)으로 1회 재생성하는 마이그레이션 스위치.
     이미 새 포맷이면 force 여도 skip → 익명으로 반복 호출돼도 재생성은 포맷 전환 때 한 번뿐(토큰 안전). */
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (exists && (!force || structured)) return NextResponse.json({ ok: true, already: true, week_key: range.end, structured });

  try {
    const report = await generateWeeklyReport(apiKey, range, `지난주(월~일: ${range.start}~${range.end}) 마감`);
    return NextResponse.json({ ok: true, week_key: report.week_key, saved: report.saved, chars: report.content.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "리포트 생성 실패" }, { status: 500 });
  }
}
