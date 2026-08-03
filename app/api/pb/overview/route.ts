import { NextResponse } from "next/server";
import { buildOverviewData, customOverviewRange } from "@/lib/pb/overview-data";

/* 데이터 추적 '전체 대시보드' — 브랜드별 요약, 이전 같은 길이 기간 대비.
   GET                     → 기본: 최근 7일(롤링)
   GET ?start=&end=        → 사용자 지정 기간(최대 92일). 비교는 직전 같은 길이 구간.
   /api/pb/* 는 middleware 보호 경로(로그인 필요)라 익명 노출 없음. 기간별 5분 캐시. */
export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    let range;
    if (start || end) {
      if (!start || !end || !YMD.test(start) || !YMD.test(end)) {
        return NextResponse.json({ ok: false, error: "start/end 는 YYYY-MM-DD 형식이어야 해요." }, { status: 400 });
      }
      const s = start <= end ? start : end;
      const e = start <= end ? end : start;
      const span = Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / DAY_MS) + 1;
      if (span > 92) return NextResponse.json({ ok: false, error: "기간은 최대 92일까지 볼 수 있어요." }, { status: 400 });
      range = customOverviewRange(s, e);
    }

    const data = await buildOverviewData(range);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "overview 실패" }, { status: 500 });
  }
}
