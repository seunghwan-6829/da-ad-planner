import { getWorkspaceData } from "@/lib/pb/home-data";

/* 데이터 추적 '전체 대시보드' 집계 — 최근 7일 vs 이전 7일을 브랜드(사이트)별로 압축.
   getWorkspaceData(기존 집계 엔진)를 두 구간으로 두 번 돌려 비교값을 만든다.
   AI 주간 리포트도 같은 데이터를 프롬프트 입력으로 쓴다(원시 이벤트가 아니라 요약만 → 토큰 안전).

   ⚡ 속도: 7일 데이터는 '오늘 들어온 방문자' 말고는 바뀌지 않는다. 그래서 기본(롤링 7일) 결과를
   서버 메모리에 5분 캐시 — 전체 대시보드를 오갈 때마다 무거운 재집계가 돌지 않는다.
   (5분 지나 처음 여는 사람 1명만 재계산을 기다리고, 나머지는 즉시) */

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
  spark: number[]; // 일별 방문자(7일)
  sparkLabels: string[]; // 일별 라벨(MM-DD) — 호버 상세용
  prev: { visitors: number; pageViews: number; avgStaySeconds: number; bounceRate: number };
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

export type OverviewRange = { start: string; end: string; prevStart: string; prevEnd: string };

const DAY_MS = 24 * 60 * 60 * 1000;

function kstDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
}

// 기본 화면용: 오늘 포함 최근 7일 vs 그 이전 7일(롤링)
export function rollingWeekRange(now = new Date()): OverviewRange {
  return {
    start: kstDateKey(new Date(now.getTime() - 6 * DAY_MS)),
    end: kstDateKey(now),
    prevStart: kstDateKey(new Date(now.getTime() - 13 * DAY_MS)),
    prevEnd: kstDateKey(new Date(now.getTime() - 7 * DAY_MS)),
  };
}

/* 주간 리포트용: '지난 완결 주(월~일)' vs 그 전 주.
   월요일 아침 크론이 부르면 방금 끝난 월~일 한 주가 잡힌다. */
export function lastCompletedWeekRange(now = new Date()): OverviewRange {
  // KST 기준 오늘 요일(0=일)
  const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const dow = kstNow.getUTCDay(); // 0(일)~6(토)
  // 지난 일요일(완결 주의 끝) = 오늘이 월(1)이면 어제, 일(0)이면 7일 전(아직 이번 주가 안 끝났으므로)
  const daysSinceSunday = dow === 0 ? 7 : dow;
  const lastSunday = new Date(now.getTime() - daysSinceSunday * DAY_MS);
  const lastMonday = new Date(lastSunday.getTime() - 6 * DAY_MS);
  return {
    start: kstDateKey(lastMonday),
    end: kstDateKey(lastSunday),
    prevStart: kstDateKey(new Date(lastMonday.getTime() - 7 * DAY_MS)),
    prevEnd: kstDateKey(new Date(lastSunday.getTime() - 7 * DAY_MS)),
  };
}

async function computeOverview(range: OverviewRange): Promise<OverviewData> {
  const [cur, prev] = await Promise.all([
    getWorkspaceData(true, range.start, range.end, "CUSTOM"),
    getWorkspaceData(true, range.prevStart, range.prevEnd, "CUSTOM"),
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
      sparkLabels: p.stats.dailyVisitorsTrend.map((t) => t.label),
      prev: {
        visitors: pv?.stats.uniqueVisitors ?? 0,
        pageViews: pv?.stats.pageViews ?? 0,
        avgStaySeconds: pv?.stats.averageStaySeconds ?? 0,
        bounceRate: pv?.stats.behaviorCards.find((b) => b.label === "이탈")?.value ?? 0,
      },
    };
  });

  sites.sort((a, b) => b.visitors - a.visitors);

  const sum = (arr: number[]) => arr.reduce((s, v) => s + v, 0);
  const avgOf = (arr: number[]) => (arr.length ? Math.round(sum(arr) / arr.length) : 0);
  const withStay = sites.filter((s) => s.avgStaySeconds > 0);
  const prevStays = [...prevById.values()].map((p) => p.stats.averageStaySeconds).filter((v) => v > 0);

  return {
    range,
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

// 기본(롤링 7일) 결과 5분 캐시 — 재계산 중 다른 요청이 겹치면 같은 promise 를 공유(중복 집계 방지).
const OVERVIEW_TTL_MS = 5 * 60 * 1000;
let overviewCache: { at: number; key: string; data: OverviewData } | null = null;
let overviewInflight: Promise<OverviewData> | null = null;

export async function buildOverviewData(range?: OverviewRange): Promise<OverviewData> {
  if (range) return computeOverview(range); // 커스텀 구간(주간 리포트)은 캐시 없이 정확 계산

  const def = rollingWeekRange();
  const key = `${def.start}~${def.end}`;
  if (overviewCache && overviewCache.key === key && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) {
    return overviewCache.data;
  }
  if (overviewInflight) return overviewInflight;
  overviewInflight = computeOverview(def)
    .then((data) => {
      overviewCache = { at: Date.now(), key, data };
      return data;
    })
    .finally(() => { overviewInflight = null; });
  return overviewInflight;
}
