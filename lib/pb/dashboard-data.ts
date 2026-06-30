import { supabaseAdmin } from "@/lib/supabase-admin";

type SiteRow = {
  id: string;
  name: string;
  created_at: string;
};

type ManagedPageRow = {
  id: number;
  site_id: string;
  page_name: string;
  url: string;
  capture_url: string | null;
  matching_type: string;
  status: string;
  tracking_ready: boolean;
  login_required: boolean;
  mobile_only: boolean;
  weekly_report: boolean;
  pv: number;
  start_date: string | null;
  end_date: string | null;
  group_name: string | null;
  note: string | null;
};

type AnalyticsEventRow = {
  id: string;
  site_id: string;
  url: string | null;
  path: string | null;
  referrer: string | null;
  event_type: string;
  created_at: string;
  page_region: string | null;
  element_label: string | null;
  device_type: string | null;
  duration_ms: number | null;
  max_scroll_percent: number | null;
  scroll_percent: number | null;
  metadata: {
    firstInteractionMs?: number | null;
  } | null;
};

export type DashboardSite = {
  id: string;
  name: string;
  pageCount: number;
  totalPageViews: number;
  totalClicks: number;
};

export type DashboardRecommendation = {
  title: string;
  detail: string;
};

export type DashboardPage = {
  id: number;
  siteId: string;
  pageName: string;
  url: string;
  captureUrl: string;
  matchingType: string;
  status: string;
  trackingReady: boolean;
  loginRequired: boolean;
  mobileOnly: boolean;
  weeklyReport: boolean;
  pv: number;
  startDate: string;
  endDate: string;
  groupName: string;
  note: string;
  avgStaySeconds: number;
  avgScrollPercent: number;
  avgFirstInteractionSeconds: number;
  clickCount: number;
  ctaClickCount: number;
  clickThroughRate: number;
  healthScore: number;
  priorityScore: number;
  projectedAdditionalCtas: number;
  projectedAdditionalViews: number;
  bottleneckLabel: string;
  recommendations: DashboardRecommendation[];
  topReferrers: { label: string; count: number }[];
  deviceMix: { label: string; count: number }[];
  topClicks: { label: string; count: number }[];
  dailyTrend: { label: string; value: number }[];
};

export type DashboardData = {
  siteName: string;
  siteDomain: string;
  sites: DashboardSite[];
  trackedPages: DashboardPage[];
  priorityPages: DashboardPage[];
  recentEvents: {
    id: string;
    eventType: string;
    url: string;
    createdAt: string;
    pageRegion: string;
    elementLabel: string;
    deviceType: string;
    referrer: string;
  }[];
};

const fallbackSites: DashboardSite[] = [
  {
    id: "demo_store",
    name: "내 사이트",
    pageCount: 2,
    totalPageViews: 0,
    totalClicks: 0
  }
];

const fallbackPages: DashboardPage[] = [
  {
    id: 11,
    siteId: "demo_store",
    pageName: "리부트디자인 상품 페이지",
    url: "https://rebootdesign.co.kr/shop/?idx=3",
    captureUrl: "https://rebootdesign.co.kr/shop/?idx=3",
    matchingType: "Starts Match",
    status: "진행 중",
    trackingReady: false,
    loginRequired: false,
    mobileOnly: false,
    weeklyReport: false,
    pv: 0,
    startDate: "2026-03-20",
    endDate: "종료 없음",
    groupName: "리부트디자인",
    note: "",
    avgStaySeconds: 0,
    avgScrollPercent: 0,
    avgFirstInteractionSeconds: 0,
    clickCount: 0,
    ctaClickCount: 0,
    clickThroughRate: 0,
    healthScore: 0,
    priorityScore: 0,
    projectedAdditionalCtas: 0,
    projectedAdditionalViews: 0,
    bottleneckLabel: "데이터 수집 대기",
    recommendations: [],
    topReferrers: [],
    deviceMix: [],
    topClicks: [],
    dailyTrend: []
  },
  {
    id: 12,
    siteId: "demo_store",
    pageName: "메디컬바이블 문의 페이지",
    url: "https://medicalbible.co.kr/Contact/?idx=82",
    captureUrl: "https://medicalbible.co.kr/Contact/?idx=82",
    matchingType: "Starts Match",
    status: "진행 중",
    trackingReady: false,
    loginRequired: false,
    mobileOnly: false,
    weeklyReport: false,
    pv: 0,
    startDate: "2026-03-20",
    endDate: "종료 없음",
    groupName: "메디컬바이블",
    note: "",
    avgStaySeconds: 0,
    avgScrollPercent: 0,
    avgFirstInteractionSeconds: 0,
    clickCount: 0,
    ctaClickCount: 0,
    clickThroughRate: 0,
    healthScore: 0,
    priorityScore: 0,
    projectedAdditionalCtas: 0,
    projectedAdditionalViews: 0,
    bottleneckLabel: "데이터 수집 대기",
    recommendations: [],
    topReferrers: [],
    deviceMix: [],
    topClicks: [],
    dailyTrend: []
  }
];

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function matchesPage(eventUrl: string, pageUrl: string, matchingType: string) {
  if (matchingType === "Exact Match") {
    return eventUrl === pageUrl;
  }

  if (matchingType === "Contains") {
    return eventUrl.includes(pageUrl);
  }

  return eventUrl.startsWith(pageUrl);
}

function rankCounts(items: string[], limit = 4) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = item.trim() || "직접 유입";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildDailyTrend(events: AnalyticsEventRow[]) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    return date.toISOString().slice(5, 10);
  });

  return days.map((day) => ({
    label: day,
    value: events.filter((event) => event.created_at.slice(5, 10) === day).length
  }));
}

function getBottleneckLabel(params: {
  trackingReady: boolean;
  ctr: number;
  avgScrollPercent: number;
  avgStaySeconds: number;
  avgFirstInteractionSeconds: number;
}) {
  const { trackingReady, ctr, avgScrollPercent, avgStaySeconds, avgFirstInteractionSeconds } = params;

  if (!trackingReady) {
    return "트래킹 미확인";
  }

  if (ctr < 2) {
    return "CTA 반응 약함";
  }

  if (avgScrollPercent < 45) {
    return "초반 이탈 큼";
  }

  if (avgStaySeconds < 20) {
    return "체류 약함";
  }

  if (avgFirstInteractionSeconds > 8) {
    return "첫 반응 지연";
  }

  return "상태 양호";
}

function buildRecommendations(params: {
  trackingReady: boolean;
  ctr: number;
  avgScrollPercent: number;
  avgStaySeconds: number;
  avgFirstInteractionSeconds: number;
  pv: number;
  topClicks: { label: string; count: number }[];
}) {
  const { trackingReady, ctr, avgScrollPercent, avgStaySeconds, avgFirstInteractionSeconds, pv, topClicks } =
    params;
  const recommendations: DashboardRecommendation[] = [];

  if (!trackingReady) {
    recommendations.push({
      title: "트래킹 점검",
      detail: "코드 설치 후 설치 확인을 다시 실행해 실제 수집 여부를 먼저 확정하세요."
    });
  }

  if (ctr < 2.5) {
    recommendations.push({
      title: "CTA 재배치",
      detail: "첫 화면 또는 스크롤 30% 이내에 문의/신청 버튼을 다시 배치해 클릭 저항을 줄이세요."
    });
  }

  if (avgScrollPercent < 45) {
    recommendations.push({
      title: "상단 구조 개선",
      detail: "상단 설명 길이를 줄이고 핵심 혜택, 후기, CTA를 더 빠르게 보여주세요."
    });
  }

  if (avgStaySeconds < 20) {
    recommendations.push({
      title: "콘텐츠 밀도 조정",
      detail: "텍스트를 줄이고 신뢰 요소, 사례, 가격 정보를 더 빠르게 노출해 체류를 늘리세요."
    });
  }

  if (avgFirstInteractionSeconds > 8) {
    recommendations.push({
      title: "첫 반응 단축",
      detail: "첫 클릭까지 오래 걸립니다. 대표 CTA 문구와 시각적 대비를 먼저 강화하세요."
    });
  }

  if (pv >= 50 && topClicks[0]?.label && ctr < 4) {
    recommendations.push({
      title: "클릭 쏠림 보정",
      detail: `"${topClicks[0].label}"에 클릭이 몰립니다. 같은 구간에 전환 CTA를 붙여 흐름을 이어주세요.`
    });
  }

  return recommendations.slice(0, 3);
}

function mapPage(row: ManagedPageRow, events: AnalyticsEventRow[]): DashboardPage {
  const relatedEvents = events.filter((event) => {
    const eventUrl = event.url ?? event.path ?? "";
    return matchesPage(eventUrl, row.url, row.matching_type);
  });

  const pageViews = relatedEvents.filter((event) => event.event_type === "page_view");
  const clicks = relatedEvents.filter(
    (event) => event.event_type === "element_click" || event.event_type === "cta_click"
  );
  const ctaClicks = relatedEvents.filter((event) => event.event_type === "cta_click");
  const pageLeaves = relatedEvents.filter(
    (event) => event.event_type === "page_leave" && typeof event.duration_ms === "number"
  );
  const firstInteractionValues = relatedEvents
    .map((event) => Number(event.metadata?.firstInteractionMs ?? 0))
    .filter((value) => value > 0)
    .map((value) => Math.round(value / 1000));

  const avgStaySeconds = average(
    pageLeaves.map((event) => Math.round((event.duration_ms ?? 0) / 1000))
  );
  const avgScrollPercent = average(
    relatedEvents
      .map((event) => event.max_scroll_percent ?? event.scroll_percent ?? 0)
      .filter((value) => value > 0)
  );
  const avgFirstInteractionSeconds = average(firstInteractionValues);
  const ctr = pageViews.length > 0 ? Math.round((ctaClicks.length / pageViews.length) * 100) : 0;

  const healthScore = Math.round(
    clamp(
      (row.tracking_ready ? 10 : 0) +
        Math.min(avgScrollPercent, 100) * 0.2 +
        (Math.min(avgStaySeconds, 60) / 60) * 20 +
        (Math.min(ctr, 6) / 6) * 30 +
        (Math.min(pageViews.length, 100) / 100) * 10 +
        (avgFirstInteractionSeconds > 0
          ? ((10 - Math.min(avgFirstInteractionSeconds, 10)) / 10) * 10
          : 0),
      0,
      100
    )
  );

  const targetCtr = ctr < 2 ? 4 : ctr < 4 ? 5 : 6;
  const projectedAdditionalCtas = Math.max(
    0,
    Math.round(pageViews.length * ((targetCtr - ctr) / 100))
  );
  const projectedAdditionalViews =
    avgScrollPercent < 45 ? Math.round(pageViews.length * 0.12) : Math.round(pageViews.length * 0.05);
  const priorityScore = Math.round(
    clamp((100 - healthScore) * 0.65 + Math.min(pageViews.length, 150) * 0.25 + (ctr < 2 ? 10 : 0), 0, 100)
  );
  const topClicks = rankCounts(
    clicks.map((event) => event.element_label ?? event.page_region ?? "알 수 없는 요소"),
    5
  );

  return {
    id: row.id,
    siteId: row.site_id,
    pageName: row.page_name,
    url: row.url,
    captureUrl: row.capture_url ?? row.url,
    matchingType: row.matching_type,
    status: row.status,
    trackingReady: row.tracking_ready,
    loginRequired: row.login_required,
    mobileOnly: row.mobile_only,
    weeklyReport: row.weekly_report,
    pv: pageViews.length,
    startDate: row.start_date ?? "-",
    endDate: row.end_date ?? "종료 없음",
    groupName: row.group_name ?? "기본 그룹",
    note: row.note ?? "",
    avgStaySeconds,
    avgScrollPercent,
    avgFirstInteractionSeconds,
    clickCount: clicks.length,
    ctaClickCount: ctaClicks.length,
    clickThroughRate: ctr,
    healthScore,
    priorityScore,
    projectedAdditionalCtas,
    projectedAdditionalViews,
    bottleneckLabel: getBottleneckLabel({
      trackingReady: row.tracking_ready,
      ctr,
      avgScrollPercent,
      avgStaySeconds,
      avgFirstInteractionSeconds
    }),
    recommendations: buildRecommendations({
      trackingReady: row.tracking_ready,
      ctr,
      avgScrollPercent,
      avgStaySeconds,
      avgFirstInteractionSeconds,
      pv: pageViews.length,
      topClicks
    }),
    topReferrers: rankCounts(
      pageViews.map((event) => {
        const referrer = event.referrer ?? "";
        if (!referrer || referrer === "direct") {
          return "직접 유입";
        }

        try {
          return new URL(referrer).hostname;
        } catch {
          return referrer;
        }
      })
    ),
    deviceMix: rankCounts(pageViews.map((event) => event.device_type ?? "unknown"), 3),
    topClicks,
    dailyTrend: buildDailyTrend(pageViews)
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  const supabase = supabaseAdmin;

  if (!supabase) {
    return {
      siteName: "개인 분석 대시보드",
      siteDomain: "등록된 페이지 없음",
      sites: fallbackSites,
      trackedPages: fallbackPages,
      priorityPages: fallbackPages,
      recentEvents: []
    };
  }

  const [{ data: sites }, { data: pages, error: pagesError }, { data: events }] = await Promise.all([
    supabase.from("pb_sites").select("*").order("created_at", { ascending: true }),
    supabase.from("pb_managed_pages").select("*").order("id", { ascending: true }),
    supabase
      .from("pb_analytics_events")
      .select(
        "id,site_id,url,path,referrer,event_type,created_at,page_region,element_label,device_type,duration_ms,max_scroll_percent,scroll_percent,metadata"
      )
      .order("created_at", { ascending: false })
      .limit(2000)
  ]);

  const eventRows = (events as AnalyticsEventRow[] | null) ?? [];

  if (pagesError || !pages?.length) {
    return {
      siteName: sites?.[0]?.name ?? "개인 분석 대시보드",
      siteDomain: "등록된 페이지 없음",
      sites: fallbackSites,
      trackedPages: fallbackPages,
      priorityPages: fallbackPages,
      recentEvents: []
    };
  }

  const mappedPages = (pages as ManagedPageRow[]).map((row) => mapPage(row, eventRows));
  const mappedSites = ((sites as SiteRow[] | null) ?? []).map((site) => {
    const sitePages = mappedPages.filter((page) => page.siteId === site.id);
    return {
      id: site.id,
      name: site.name,
      pageCount: sitePages.length,
      totalPageViews: sitePages.reduce((sum, page) => sum + page.pv, 0),
      totalClicks: sitePages.reduce((sum, page) => sum + page.clickCount, 0)
    };
  });

  const priorityPages = [...mappedPages]
    .sort((a, b) => b.priorityScore - a.priorityScore || b.pv - a.pv)
    .slice(0, 5);

  return {
    siteName: mappedSites[0]?.name ?? "개인 분석 대시보드",
    siteDomain: mappedPages[0] ? new URL(mappedPages[0].url).hostname : "등록된 페이지 없음",
    sites: mappedSites.length ? mappedSites : fallbackSites,
    trackedPages: mappedPages,
    priorityPages: priorityPages.length ? priorityPages : fallbackPages,
    recentEvents: eventRows.slice(0, 120).map((event) => ({
      id: event.id,
      eventType: event.event_type,
      url: event.url ?? event.path ?? "-",
      createdAt: event.created_at,
      pageRegion: event.page_region ?? "page",
      elementLabel: event.element_label ?? "",
      deviceType: event.device_type ?? "unknown",
      referrer: event.referrer ?? "direct"
    }))
  };
}
