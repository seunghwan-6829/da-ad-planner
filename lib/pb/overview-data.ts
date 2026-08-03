import { getWorkspaceData } from "@/lib/pb/home-data";

/* 데이터 추적 '전체 대시보드' 집계 — 최근 7일 vs 이전 7일을 브랜드(사이트)별로 압축.
   getWorkspaceData(기존 집계 엔진)를 두 구간으로 두 번 돌려 비교값을 만든다(30초 캐시라 부담 없음).
   AI 주간 리포트도 같은 데이터를 프롬프트 입력으로 쓴다(원시 이벤트가 아니라 요약만 → 토큰 안전). */

export type OverviewSite = {
  id: string;
  name: string;
  domain: string;
  logoUrl: string;
  visitors: number;
  pageViews: number;
  avgStaySeconds: number;
  avgPagesPerVisitor: number;
  bounceRate: number;
  topPages: { title: string; url: string; views: number }[];
  topReferrer: string;
  deviceTop: string;
  spark: number[]; // 일별 방문자(최근 7일)
  prev: { visitors: number; pageViews: number; avgStaySeconds: number };
};

export type OverviewData = {
  range: { start: string; end: string; prevStart: string; prevEnd: string };
  totals: {
    visitors: number;
    pageViews: number;
    avgStaySeconds: number;
    prevVisitors: number;
    prevPageViews: number;
    prevAvgStaySeconds: number;
  };
  sites: OverviewSite[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function kstDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

export async function buildOverviewData(): Promise<OverviewData> {
  const now = new Date();
  const end = kstDateKey(now);
  const start = kstDateKey(new Date(now.getTime() - 6 * DAY_MS));
  const prevEnd = kstDateKey(new Date(now.getTime() - 7 * DAY_MS));
  const prevStart = kstDateKey(new Date(now.getTime() - 13 * DAY_MS));

  const [cur, prev] = await Promise.all([
    getWorkspaceData(true, start, end, "CUSTOM"),
    getWorkspaceData(true, prevStart, prevEnd, "CUSTOM"),
  ]);

  const prevById = new Map(prev.projects.map((p) => [p.id, p]));

  const sites: OverviewSite[] = cur.projects.map((p) => {
    const pv = prevById.get(p.id);
    return {
      id: p.id,
      name: p.name,
      domain: p.domain,
      logoUrl: p.logoUrl,
      visitors: p.stats.uniqueVisitors,
      pageViews: p.stats.pageViews,
      avgStaySeconds: p.stats.averageStaySeconds,
      avgPagesPerVisitor: p.stats.averagePagesPerVisitor,
      bounceRate: p.stats.behaviorCards.find((b) => b.label === "이탈")?.value ?? 0,
      topPages: p.stats.topPages.slice(0, 3),
      topReferrer: p.stats.topReferrerLabel,
      deviceTop: [...p.stats.deviceSummary].sort((a, b) => b.count - a.count)[0]?.label ?? "",
      spark: p.stats.dailyVisitorsTrend.map((t) => t.visitors),
      prev: {
        visitors: pv?.stats.uniqueVisitors ?? 0,
        pageViews: pv?.stats.pageViews ?? 0,
        avgStaySeconds: pv?.stats.averageStaySeconds ?? 0,
      },
    };
  });

  sites.sort((a, b) => b.visitors - a.visitors);

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const avgOf = (arr: number[]) => (arr.length ? Math.round(sum(arr) / arr.length) : 0);
  const withStay = sites.filter((s) => s.avgStaySeconds > 0);
  const prevStays = [...prevById.values()].map((p) => p.stats.averageStaySeconds).filter((v) => v > 0);

  return {
    range: { start, end, prevStart, prevEnd },
    totals: {
      visitors: sum(sites.map((s) => s.visitors)),
      pageViews: sum(sites.map((s) => s.pageViews)),
      avgStaySeconds: avgOf(withStay.map((s) => s.avgStaySeconds)),
      prevVisitors: sum(sites.map((s) => s.prev.visitors)),
      prevPageViews: sum(sites.map((s) => s.prev.pageViews)),
      prevAvgStaySeconds: avgOf(prevStays),
    },
    sites,
  };
}
