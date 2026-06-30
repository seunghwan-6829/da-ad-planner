import { supabaseAdmin } from "@/lib/supabase-admin";

type LandingEventRow = {
  id: string;
  event_type: string;
  url: string | null;
  path: string | null;
  referrer: string | null;
  created_at: string;
  duration_ms: number | null;
  max_scroll_percent: number | null;
  scroll_percent: number | null;
  click_x: number | null;
  click_y: number | null;
  device_type: string | null;
  page_region: string | null;
  element_label: string | null;
  metadata: {
    firstInteractionMs?: number | null;
  } | null;
};

type ManagedPageRow = {
  id: number;
  page_name: string;
  url: string;
  capture_url: string | null;
  matching_type: string;
  group_name: string | null;
};

export type LandingPageData = {
  id: number;
  pageName: string;
  url: string;
  captureUrl: string;
  groupName: string;
  views: number;
  avgStaySeconds: number;
  avgScroll: number;
  avgFirstInteractionSeconds: number;
  clickCount: number;
  ctaClickCount: number;
  ctr: number;
  healthScore: number;
  estimatedLostVisitors: number;
  projectedAdditionalCtas: number;
  summaryText: string;
  recommendations: string[];
  heatmap: { x: number; y: number; strength: number }[];
  scrollBuckets: { label: string; count: number }[];
  scrollProgress: { label: string; percent: number; visitors: number }[];
  exitPressure: { label: string; percent: number; exits: number }[];
  clickHotspots: { label: string; x: number; y: number; count: number }[];
  referrers: { label: string; count: number }[];
  devices: { label: string; count: number }[];
  topClicks: { label: string; count: number }[];
  recentEvents: { id: string; label: string; createdAt: string; device: string }[];
};

function matchesUrl(eventUrl: string, pageUrl: string, matchingType: string) {
  if (matchingType === "Exact Match") {
    return eventUrl === pageUrl;
  }

  if (matchingType === "Contains") {
    return eventUrl.includes(pageUrl);
  }

  return eventUrl.startsWith(pageUrl);
}

function average(values: number[]) {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function rankCounts(items: string[], limit = 5) {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = item.trim() || "알 수 없음";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function bucketScroll(values: number[]) {
  const buckets = [
    { label: "0-25%", min: 0, max: 25 },
    { label: "26-50%", min: 26, max: 50 },
    { label: "51-75%", min: 51, max: 75 },
    { label: "76-100%", min: 76, max: 100 }
  ];

  return buckets.map((bucket) => ({
    label: bucket.label,
    count: values.filter((value) => value >= bucket.min && value <= bucket.max).length
  }));
}

function buildScrollProgress(values: number[]) {
  const thresholds = [25, 50, 75, 100];

  return thresholds.map((threshold) => ({
    label: `${threshold}%`,
    percent: threshold,
    visitors: values.filter((value) => value >= threshold).length
  }));
}

function buildExitPressure(values: number[]) {
  const stages = [
    { label: "상단 이탈", min: 0, max: 25, percent: 18 },
    { label: "중상단 이탈", min: 26, max: 50, percent: 42 },
    { label: "중하단 이탈", min: 51, max: 75, percent: 68 },
    { label: "하단 이탈", min: 76, max: 100, percent: 90 }
  ];

  return stages.map((stage) => ({
    label: stage.label,
    percent: stage.percent,
    exits: values.filter((value) => value >= stage.min && value <= stage.max).length
  }));
}

function buildClickHotspots(
  events: Array<{ click_x: number | null; click_y: number | null; element_label: string | null; page_region: string | null }>
) {
  const clusters = new Map<string, { label: string; x: number; y: number; count: number }>();

  for (const event of events) {
    if (typeof event.click_x !== "number" || typeof event.click_y !== "number") {
      continue;
    }

    const xBucket = Math.round(event.click_x * 10) / 10;
    const yBucket = Math.round(event.click_y * 12) / 12;
    const key = `${xBucket}-${yBucket}`;
    const label = event.element_label ?? event.page_region ?? "알 수 없는 요소";
    const current = clusters.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    clusters.set(key, {
      label,
      x: xBucket,
      y: yBucket,
      count: 1
    });
  }

  return [...clusters.values()].sort((a, b) => b.count - a.count).slice(0, 8);
}

function buildRecommendations(params: {
  ctr: number;
  avgScroll: number;
  avgStaySeconds: number;
  avgFirstInteractionSeconds: number;
  topClicks: { label: string; count: number }[];
}) {
  const { ctr, avgScroll, avgStaySeconds, avgFirstInteractionSeconds, topClicks } = params;
  const items: string[] = [];

  if (ctr < 3) {
    items.push("CTA 문구를 더 직접적으로 바꾸고 첫 화면 안에 한 번 더 노출하세요.");
  }

  if (avgScroll < 45) {
    items.push("상단 소개 구간을 줄이고 혜택, 후기, 가격 포인트를 더 빠르게 배치하세요.");
  }

  if (avgStaySeconds < 20) {
    items.push("콘텐츠 길이가 길거나 핵심 정보가 늦게 나옵니다. 신뢰 요소를 더 앞당기세요.");
  }

  if (avgFirstInteractionSeconds > 8) {
    items.push("첫 상호작용이 늦습니다. 주요 버튼 대비와 주변 여백을 더 키워보세요.");
  }

  if (topClicks[0]?.label && ctr < 4) {
    items.push(`"${topClicks[0].label}" 근처에 전환 CTA를 붙여 클릭 흐름을 전환으로 연결하세요.`);
  }

  return items.slice(0, 3);
}

export async function getLandingAnalysisData(): Promise<{ pages: LandingPageData[] }> {
  const supabase = supabaseAdmin;

  if (!supabase) {
    return { pages: [] };
  }

  const [{ data: pages }, { data: events }] = await Promise.all([
    supabase
      .from("pb_managed_pages")
      .select("id,page_name,url,capture_url,matching_type,group_name")
      .order("id"),
    supabase
      .from("pb_analytics_events")
      .select(
        "id,event_type,url,path,referrer,created_at,duration_ms,max_scroll_percent,scroll_percent,click_x,click_y,device_type,page_region,element_label,metadata"
      )
      .order("created_at", { ascending: false })
      .limit(2500)
  ]);

  const pageRows = (pages as ManagedPageRow[] | null) ?? [];
  const eventRows = (events as LandingEventRow[] | null) ?? [];

  return {
    pages: pageRows.map((page) => {
      const related = eventRows.filter((event) =>
        matchesUrl(event.url ?? event.path ?? "", page.url, page.matching_type)
      );
      const views = related.filter((event) => event.event_type === "page_view");
      const leaves = related.filter(
        (event) => event.event_type === "page_leave" && typeof event.duration_ms === "number"
      );
      const clickEvents = related.filter(
        (event) =>
          (event.event_type === "element_click" || event.event_type === "cta_click") &&
          typeof event.click_x === "number" &&
          typeof event.click_y === "number"
      );
      const ctaClicks = related.filter((event) => event.event_type === "cta_click");
      const scrollValues = related
        .map((event) => event.max_scroll_percent ?? event.scroll_percent ?? 0)
        .filter((value) => value > 0);
      const firstInteractionValues = related
        .map((event) => Number(event.metadata?.firstInteractionMs ?? 0))
        .filter((value) => value > 0)
        .map((value) => Math.round(value / 1000));
      const topClicks = rankCounts(
        clickEvents.map((event) => event.element_label ?? event.page_region ?? "알 수 없는 요소"),
        6
      );
      const avgStaySeconds = average(leaves.map((event) => Math.round((event.duration_ms ?? 0) / 1000)));
      const avgScroll = average(scrollValues);
      const avgFirstInteractionSeconds = average(firstInteractionValues);
      const ctr = views.length ? Math.round((ctaClicks.length / views.length) * 100) : 0;
      const healthScore = Math.round(
        clamp(
          Math.min(avgScroll, 100) * 0.25 +
            (Math.min(avgStaySeconds, 60) / 60) * 25 +
            (Math.min(ctr, 6) / 6) * 35 +
            (avgFirstInteractionSeconds > 0
              ? ((10 - Math.min(avgFirstInteractionSeconds, 10)) / 10) * 15
              : 0),
          0,
          100
        )
      );
      const estimatedLostVisitors = Math.max(0, views.length - Math.round((views.length * avgScroll) / 100));
      const targetCtr = ctr < 2 ? 4 : ctr < 4 ? 5 : 6;
      const projectedAdditionalCtas = Math.max(
        0,
        Math.round(views.length * ((targetCtr - ctr) / 100))
      );
      const recommendations = buildRecommendations({
        ctr,
        avgScroll,
        avgStaySeconds,
        avgFirstInteractionSeconds,
        topClicks
      });

      return {
        id: page.id,
        pageName: page.page_name,
        url: page.url,
        captureUrl: page.capture_url ?? page.url,
        groupName: page.group_name ?? "기본 그룹",
        views: views.length,
        avgStaySeconds,
        avgScroll,
        avgFirstInteractionSeconds,
        clickCount: clickEvents.length,
        ctaClickCount: ctaClicks.length,
        ctr,
        healthScore,
        estimatedLostVisitors,
        projectedAdditionalCtas,
        summaryText:
          ctr < 3
            ? "조회는 들어오지만 CTA 반응이 약한 편입니다. 상단 구조와 CTA 배치를 우선 보세요."
            : "전환 반응은 유지되고 있습니다. 이탈 구간과 유입 품질을 같이 보며 미세 조정하세요.",
        recommendations,
        heatmap: clickEvents.slice(0, 60).map((event) => ({
          x: event.click_x ?? 0.5,
          y: event.click_y ?? 0.5,
          strength: event.event_type === "cta_click" ? 2 : 1
        })),
        scrollBuckets: bucketScroll(scrollValues),
        scrollProgress: buildScrollProgress(scrollValues),
        exitPressure: buildExitPressure(
          leaves.map((event) => event.max_scroll_percent ?? event.scroll_percent ?? 0).filter((value) => value > 0)
        ),
        clickHotspots: buildClickHotspots(clickEvents),
        referrers: rankCounts(
          views.map((event) => {
            if (!event.referrer || event.referrer === "direct") {
              return "직접 유입";
            }

            try {
              return new URL(event.referrer).hostname;
            } catch {
              return event.referrer;
            }
          })
        ),
        devices: rankCounts(views.map((event) => event.device_type ?? "unknown"), 3),
        topClicks,
        recentEvents: related.slice(0, 10).map((event) => ({
          id: event.id,
          label: event.element_label ?? event.page_region ?? event.event_type,
          createdAt: event.created_at,
          device: event.device_type ?? "unknown"
        }))
      };
    })
  };
}
