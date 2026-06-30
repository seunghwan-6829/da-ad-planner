import { supabaseAdmin } from "@/lib/supabase-admin";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WORKSPACE_CACHE_TTL_MS = 30 * 1000;
const KST_DATE_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
const KST_TIME_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

type SiteRow = {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
  tracking_verified: boolean | null;
  tracking_checked_at: string | null;
  last_tested_at: string | null;
  trashed_at: string | null;
  created_at: string;
};

type AnalyticsEventRow = {
  id: string;
  site_id: string;
  session_id: string;
  visitor_id: string;
  event_type: string;
  url: string | null;
  path: string | null;
  referrer: string | null;
  device_type: string | null;
  element_label?: string | null;
  scroll_percent?: number | null;
  duration_ms: number | null;
  ip_address: string | null;
  created_at: string;
};

export type RangePreset = "TODAY" | "7D" | "30D" | "CUSTOM";

export type MetricItem = {
  label: string;
  count: number;
  ratio: number;
};

type TrendPoint = {
  label: string;
  visitors: number;
  pageViews: number;
};

type DeviceTrendPoint = {
  label: string;
  phone: number;
  desktop: number;
  tablet: number;
};

type VisitTypeTrendPoint = {
  label: string;
  newVisits: number;
  returningVisits: number;
};

type ReferrerTrendPoint = {
  label: string;
  ratio: number;
};

type ReferrerTrendSeries = {
  label: string;
  values: number[];
};

export type TopPageItem = {
  title: string;
  url: string;
  views: number;
};

export type ActivityItem = {
  label: string;
  detail: string;
  count: number;
};

export type BehaviorCard = {
  label: string;
  value: number;
  suffix: string;
  accent: string;
  icon: string;
  max: number;
  min: number;
};

export type ProjectStats = {
  uniqueVisitors: number;
  pageViews: number;
  averagePagesPerVisitor: number;
  averageStaySeconds: number;
  dailyVisitorsTrend: TrendPoint[];
  deviceSummary: MetricItem[];
  deviceTrend: DeviceTrendPoint[];
  visitTypeSummary: MetricItem[];
  visitTypeTrend: VisitTypeTrendPoint[];
  referrerSummary: MetricItem[];
  referrerTrend: ReferrerTrendPoint[];
  referrerTrendSeries: ReferrerTrendSeries[];
  topReferrerLabel: string;
  topPages: TopPageItem[];
  topActivities: ActivityItem[];
  behaviorCards: BehaviorCard[];
};

export type ProjectRecord = {
  id: string;
  name: string;
  domain: string;
  url: string;
  logoUrl: string;
  headCode: string;
  trackingVerified: boolean;
  trackingCheckedAt: string;
  lastTestedAt: string;
  createdAt: string;
  trashedAt: string;
  stats: ProjectStats;
};

export type WorkspaceData = {
  isAdmin: boolean;
  startDate: string;
  endDate: string;
  rangePreset: RangePreset;
  projects: ProjectRecord[];
  trashedProjects: ProjectRecord[];
};

type Bucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

type WorkspaceCacheEntry = {
  expiresAt: number;
  value: WorkspaceData;
};

const workspaceCache = new Map<string, WorkspaceCacheEntry>();

const DEVICE_ORDER = ["폰", "데스크탑", "태블릿"] as const;

function formatIso(value: string | null) {
  return value ?? "";
}

function normalizeDomain(urlValue: string | null) {
  if (!urlValue) return "";
  try {
    return new URL(urlValue).hostname.replace(/^www\./, "");
  } catch {
    return urlValue.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function normalizeReferrer(referrer: string | null) {
  if (!referrer || referrer === "direct" || referrer === "manual_test") {
    return "직접 유입";
  }
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return referrer;
  }
}

function getVisitorKey(event: AnalyticsEventRow) {
  return event.visitor_id?.trim() || event.ip_address?.trim() || "unknown_visitor";
}

function createLogoUrl(domain: string, customLogoUrl: string | null) {
  if (customLogoUrl) return customLogoUrl;
  if (!domain) return "";
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

function ratio(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, current) => sum + current, 0) / values.length);
}

function sanitizeStaySeconds(valueMs: number | null) {
  if (!valueMs || valueMs <= 0) return 0;
  const seconds = Math.round(valueMs / 1000);
  return Math.min(seconds, 180);
}

function getDeviceLabel(value: string | null) {
  if (value === "phone" || value === "mobile") return "폰";
  if (value === "tablet") return "태블릿";
  return "데스크탑";
}

function getDeviceKey(value: string | null) {
  if (value === "phone" || value === "mobile") return "phone" as const;
  if (value === "tablet") return "tablet" as const;
  return "desktop" as const;
}

function getKstDate(date: Date) {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

function getFormatterParts(formatter: Intl.DateTimeFormat, input: Date | string) {
  const value = typeof input === "string" ? new Date(input) : input;
  const parts = formatter.formatToParts(value);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return map;
}

function getKstDateKey(input: Date | string) {
  const parts = getFormatterParts(KST_DATE_PARTS, input);
  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
}

function getKstHourKey(input: Date | string) {
  const parts = getFormatterParts(KST_TIME_PARTS, input);
  return `${parts.get("hour")}:00`;
}

function toDateInput(date: Date) {
  return getKstDateKey(date);
}

function cloneDate(date: Date) {
  return new Date(date.getTime());
}

function startOfDay(date: Date) {
  const next = cloneDate(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = cloneDate(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function formatHourLabel(date: Date) {
  return getKstHourKey(date);
}

function formatMinuteLabel(date: Date) {
  const kstDate = getKstDate(date);
  return `${String(kstDate.getUTCHours()).padStart(2, "0")}:${String(kstDate.getUTCMinutes()).padStart(2, "0")}`;
}

function startOfKstDay(dateInput: string) {
  return new Date(`${dateInput}T00:00:00+09:00`);
}

function endOfKstDay(dateInput: string) {
  return new Date(`${dateInput}T23:59:59.999+09:00`);
}

function getInclusiveDaySpan(startDate: string, endDate: string) {
  const start = startOfKstDay(startDate).getTime();
  const end = startOfKstDay(endDate).getTime();
  const diff = Math.max(0, end - start);
  return Math.floor(diff / (24 * 60 * 60 * 1000)) + 1;
}

async function fetchAnalyticsEventsInRange(
  siteIds: string[],
  rangeStart: string,
  rangeEnd: string,
  maxTotal: number
) {
  const supabase = supabaseAdmin;
  if (!supabase || !siteIds.length) return [] as AnalyticsEventRow[];

  const pageSize = 1000;
  const rows: AnalyticsEventRow[] = [];
  let offset = 0;

  while (offset < maxTotal) {
    const upper = Math.min(offset + pageSize - 1, maxTotal - 1);
    const { data } = await supabase
      .from("pb_analytics_events")
      .select("id,site_id,session_id,visitor_id,event_type,url,path,referrer,device_type,element_label,scroll_percent,duration_ms,ip_address,created_at")
      .in("site_id", siteIds)
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .order("created_at", { ascending: false })
      .range(offset, upper);

    const batch = (data as AnalyticsEventRow[] | null) ?? [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function getDefaultRange() {
  const today = new Date();
  const todayString = toDateInput(today);
  return {
    startDate: todayString,
    endDate: todayString,
    rangePreset: "TODAY" as RangePreset
  };
}

function normalizePreset(value?: string | null): RangePreset {
  if (value === "TODAY" || value === "7D" || value === "30D") {
    return value;
  }
  return "CUSTOM";
}

function getRangeConfig(
  startDateInput?: string,
  endDateInput?: string,
  presetInput?: string | null
): { startDate: string; endDate: string; rangePreset: RangePreset } {
  const defaults = getDefaultRange();
  const preset = presetInput ? normalizePreset(presetInput) : defaults.rangePreset;
  const today = toDateInput(new Date());

  if (preset === "TODAY") {
    return { startDate: today, endDate: today, rangePreset: preset };
  }

  if (preset === "7D") {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    return { startDate: toDateInput(start), endDate: toDateInput(end), rangePreset: preset };
  }

  if (preset === "30D") {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 29);
    return { startDate: toDateInput(start), endDate: toDateInput(end), rangePreset: preset };
  }

  if (preset === "CUSTOM" && startDateInput && endDateInput) {
    const safeStart = startDateInput;
    const safeEnd = endDateInput;
    return safeStart <= safeEnd
      ? { startDate: safeStart, endDate: safeEnd, rangePreset: "CUSTOM" as RangePreset }
      : { startDate: safeEnd, endDate: safeStart, rangePreset: "CUSTOM" as RangePreset };
  }

  return {
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    rangePreset: defaults.rangePreset
  };
}

function buildBuckets(startDate: string, endDate: string, preset: RangePreset) {
  if (preset === "TODAY") {
    const anchorDate = toDateInput(new Date());
    const anchor = startOfKstDay(anchorDate);
    const buckets: Bucket[] = [];
    for (let index = 0; index < 24; index += 1) {
      const start = new Date(anchor.getTime() + index * 60 * 60 * 1000);
      const next = new Date(start.getTime());
      next.setUTCMinutes(59, 59, 999);
      buckets.push({
        key: formatHourLabel(start),
        label: formatHourLabel(start),
        start,
        end: next
      });
    }
    return buckets;
  }

  if (startDate === endDate) {
    const anchor = startOfKstDay(startDate);
    const buckets: Bucket[] = [];
    for (let index = 0; index < 24; index += 1) {
      const start = new Date(anchor.getTime() + index * 60 * 60 * 1000);
      const next = new Date(start.getTime());
      next.setUTCMinutes(59, 59, 999);
      buckets.push({
        key: formatHourLabel(start),
        label: formatHourLabel(start),
        start,
        end: next
      });
    }
    return buckets;
  }

  const start = startOfKstDay(startDate);
  const end = endOfKstDay(endDate);
  const buckets: Bucket[] = [];
  const cursor = cloneDate(start);

  while (cursor <= end) {
    const bucketStart = startOfKstDay(toDateInput(cursor));
    const bucketEnd = endOfKstDay(toDateInput(cursor));
    buckets.push({
      key: toDateInput(bucketStart),
      label: toDateInput(bucketStart).slice(5),
      start: bucketStart,
      end: bucketEnd
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

function buildMetricItems(source: Map<string, number>, total: number, order: readonly string[]) {
  return order.map((label) => ({
    label,
    count: source.get(label) ?? 0,
    ratio: ratio(source.get(label) ?? 0, total)
  }));
}

function formatPageTitle(path: string | null, url: string | null) {
  const source = path || url || "/";
  if (source === "/" || source === "") return "메인 페이지";
  const cleaned = source.replace(/^https?:\/\/[^/]+/i, "").replace(/\?.*$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  const last = parts[parts.length - 1] || cleaned;
  return decodeURIComponent(last).replace(/[-_]/g, " ");
}

function formatActivityLabel(event: AnalyticsEventRow) {
  if (event.event_type === "page_view") {
    return {
      label: `${formatPageTitle(event.path, event.url)} 방문`,
      detail: event.path || event.url || "/"
    };
  }

  if (event.event_type === "cta_click") {
    return {
      label: `${event.element_label || formatPageTitle(event.path, event.url)} 클릭`,
      detail: event.path || event.url || "/"
    };
  }

  if (event.event_type === "scroll_depth") {
    const depth = event.scroll_percent ?? 0;
    return {
      label: `스크롤 ${depth}% 도달`,
      detail: event.path || event.url || "/"
    };
  }

  return {
    label: event.element_label || event.event_type,
    detail: event.path || event.url || "/"
  };
}

function buildStats(events: AnalyticsEventRow[], buckets: Bucket[], startDate: string, endDate: string): ProjectStats {
  const sameDayRange = startDate === endDate;
  const filtered = events.filter((event) => {
    const dateKey = getKstDateKey(event.created_at);
    return dateKey >= startDate && dateKey <= endDate;
  });

  const pageViews = filtered
    .filter((event) => event.event_type === "page_view")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const pageLeaves = filtered
    .filter((event) => event.event_type === "page_leave" && typeof event.duration_ms === "number")
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const uniqueVisitors = new Set(pageViews.map(getVisitorKey)).size;
  const averagePagesPerVisitor = uniqueVisitors > 0 ? Number((pageViews.length / uniqueVisitors).toFixed(1)) : 0;
  const dedupedLeaveMap = new Map<string, number>();
  for (const event of pageLeaves) {
    const key = `${event.session_id}:${event.path ?? event.url ?? ""}`;
    const sanitizedSeconds = sanitizeStaySeconds(event.duration_ms);
    if (!sanitizedSeconds) continue;
    const current = dedupedLeaveMap.get(key) ?? 0;
    dedupedLeaveMap.set(key, Math.max(current, sanitizedSeconds));
  }

  const averageStaySeconds = average([...dedupedLeaveMap.values()]);

  const deviceCountMap = new Map<string, number>([
    ["폰", 0],
    ["데스크탑", 0],
    ["태블릿", 0]
  ]);
  const referrerCountMap = new Map<string, number>();
  const pageCountMap = new Map<string, TopPageItem>();
  const activityCountMap = new Map<string, ActivityItem>();
  const visitorPrimaryDevice = new Map<string, string>();
  const visitorPageViewCount = new Map<string, number>();
  const visitorBucketMap = new Map<string, Set<string>>();
  const visitorFirstSeenAt = new Map<string, number>();

  const bucketMap = new Map(
    buckets.map((bucket) => [
      bucket.key,
      {
        visitors: new Set<string>(),
        pageViews: 0,
        deviceVisitors: {
          phone: new Set<string>(),
          desktop: new Set<string>(),
          tablet: new Set<string>()
        },
        visitorFirstSeen: new Map<string, number>(),
        referrers: new Map<string, number>(),
        pageViewEvents: [] as AnalyticsEventRow[]
      }
    ])
  );

  function findBucketKey(dateValue: string) {
    return sameDayRange ? getKstHourKey(dateValue) : getKstDateKey(dateValue);
  }

  for (const event of pageViews) {
    const bucketKey = findBucketKey(event.created_at);
    const state = bucketMap.get(bucketKey);
    if (!state) continue;
    const visitorKey = getVisitorKey(event);
    const deviceLabel = getDeviceLabel(event.device_type);
    const deviceKey = getDeviceKey(event.device_type);
    const referrerLabel = normalizeReferrer(event.referrer);
    const createdAtMs = new Date(event.created_at).getTime();

    state.visitors.add(visitorKey);
    state.pageViews += 1;
    state.pageViewEvents.push(event);
    state.deviceVisitors[deviceKey].add(visitorKey);
    referrerCountMap.set(referrerLabel, (referrerCountMap.get(referrerLabel) ?? 0) + 1);
    state.referrers.set(referrerLabel, (state.referrers.get(referrerLabel) ?? 0) + 1);

    if (!visitorPrimaryDevice.has(visitorKey)) {
      visitorPrimaryDevice.set(visitorKey, deviceLabel);
    }
    visitorPageViewCount.set(visitorKey, (visitorPageViewCount.get(visitorKey) ?? 0) + 1);
    if (!visitorFirstSeenAt.has(visitorKey) || createdAtMs < (visitorFirstSeenAt.get(visitorKey) ?? Number.MAX_SAFE_INTEGER)) {
      visitorFirstSeenAt.set(visitorKey, createdAtMs);
    }
    const currentVisitorBuckets = visitorBucketMap.get(visitorKey) ?? new Set<string>();
    currentVisitorBuckets.add(bucketKey);
    visitorBucketMap.set(visitorKey, currentVisitorBuckets);
    if (!state.visitorFirstSeen.has(visitorKey) || createdAtMs < (state.visitorFirstSeen.get(visitorKey) ?? Number.MAX_SAFE_INTEGER)) {
      state.visitorFirstSeen.set(visitorKey, createdAtMs);
    }

    const pageKey = event.path || event.url || "/";
    const currentPage = pageCountMap.get(pageKey);
    pageCountMap.set(pageKey, {
      title: formatPageTitle(event.path, event.url),
      url: pageKey,
      views: (currentPage?.views ?? 0) + 1
    });
  }

  for (const event of filtered.filter((item) => item.event_type !== "page_leave")) {
    const { label, detail } = formatActivityLabel(event);
    const activityKey = `${label}::${detail}`;
    const currentActivity = activityCountMap.get(activityKey);
    activityCountMap.set(activityKey, {
      label,
      detail,
      count: (currentActivity?.count ?? 0) + 1
    });
  }

  for (const [, deviceLabel] of visitorPrimaryDevice.entries()) {
    deviceCountMap.set(deviceLabel, (deviceCountMap.get(deviceLabel) ?? 0) + 1);
  }

  let newVisitCount = 0;
  let returningVisitCount = 0;
  for (const [visitorKey, count] of visitorPageViewCount.entries()) {
    const bucketCount = visitorBucketMap.get(visitorKey)?.size ?? 0;
    if (count > 1 || bucketCount > 1) returningVisitCount += 1;
    else newVisitCount += 1;
  }

  const referrerSummary = [...referrerCountMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({
      label,
      count,
      ratio: ratio(count, pageViews.length)
    }));

  const topReferrerLabel = referrerSummary[0]?.label ?? "";
  const referrerTrendSeries = referrerSummary.map((item) => ({
    label: item.label,
    values: buckets.map((bucket) => {
      const state = bucketMap.get(bucket.key)!;
      return ratio(state.referrers.get(item.label) ?? 0, state.pageViews);
    })
  }));

  const topPages = [...pageCountMap.values()]
    .sort((left, right) => right.views - left.views)
    .slice(0, 10);

  const topActivities = [...activityCountMap.values()]
    .sort((left, right) => right.count - left.count)
    .slice(0, 20);

  const sessionPathMap = new Map<string, string[]>();
  const sessionPageViewCount = new Map<string, number>();
  const pageViewsBySession = new Map<string, AnalyticsEventRow[]>();
  for (const event of pageViews) {
    const path = event.path || event.url || "/";
    sessionPageViewCount.set(event.session_id, (sessionPageViewCount.get(event.session_id) ?? 0) + 1);
    const currentPaths = sessionPathMap.get(event.session_id) ?? [];
    currentPaths.push(path);
    sessionPathMap.set(event.session_id, currentPaths);
    const currentEvents = pageViewsBySession.get(event.session_id) ?? [];
    currentEvents.push(event);
    pageViewsBySession.set(event.session_id, currentEvents);
  }

  const sessionCount = sessionPageViewCount.size || 1;
  const bounceSessions = [...sessionPageViewCount.values()].filter((count) => count === 1).length;

  let refreshLikeViews = 0;
  let rollbackLikeViews = 0;

  for (const [, sessionEvents] of pageViewsBySession) {
    for (let index = 1; index < sessionEvents.length; index += 1) {
      const previous = sessionEvents[index - 1];
      const current = sessionEvents[index];
      const previousPath = previous.path || previous.url || "/";
      const currentPath = current.path || current.url || "/";
      const diffMs = new Date(current.created_at).getTime() - new Date(previous.created_at).getTime();
      if (previousPath === currentPath && diffMs <= 90_000) {
        refreshLikeViews += 1;
      }
      const earlierPaths = sessionEvents.slice(0, index - 1).map((item) => item.path || item.url || "/");
      if (earlierPaths.includes(currentPath) && previousPath !== currentPath) {
        rollbackLikeViews += 1;
      }
    }
  }

  const bounceRate = ratio(bounceSessions, sessionCount);
  const refreshRate = ratio(refreshLikeViews, Math.max(pageViews.length, 1));
  const rollbackRate = ratio(rollbackLikeViews, Math.max(pageViews.length, 1));

  const behaviorTrend = buckets.map((bucket) => {
    const bucketViews = bucketMap.get(bucket.key)?.pageViewEvents ?? [];
    const sessionCounts = new Map<string, number>();
    const sessionEvents = new Map<string, AnalyticsEventRow[]>();
    for (const event of bucketViews) {
      sessionCounts.set(event.session_id, (sessionCounts.get(event.session_id) ?? 0) + 1);
      const current = sessionEvents.get(event.session_id) ?? [];
      current.push(event);
      sessionEvents.set(event.session_id, current);
    }

    const bucketSessionTotal = sessionCounts.size || 1;
    const bucketBounceSessions = [...sessionCounts.values()].filter((count) => count === 1).length;
    let bucketRefresh = 0;
    let bucketRollback = 0;
    for (const [, eventsInSession] of sessionEvents) {
      for (let index = 1; index < eventsInSession.length; index += 1) {
        const previous = eventsInSession[index - 1];
        const current = eventsInSession[index];
        const previousPath = previous.path || previous.url || "/";
        const currentPath = current.path || current.url || "/";
        const diffMs = new Date(current.created_at).getTime() - new Date(previous.created_at).getTime();
        if (previousPath === currentPath && diffMs <= 90_000) {
          bucketRefresh += 1;
        }
        const earlierPaths = eventsInSession.slice(0, index - 1).map((item) => item.path || item.url || "/");
        if (earlierPaths.includes(currentPath) && previousPath !== currentPath) {
          bucketRollback += 1;
        }
      }
    }

    return {
      bounce: ratio(bucketBounceSessions, bucketSessionTotal),
      refresh: ratio(bucketRefresh, Math.max(bucketViews.length, 1)),
      rollback: ratio(bucketRollback, Math.max(bucketViews.length, 1))
    };
  });

  const bounceValues = behaviorTrend.map((item) => item.bounce);
  const refreshValues = behaviorTrend.map((item) => item.refresh);
  const rollbackValues = behaviorTrend.map((item) => item.rollback);

  return {
    uniqueVisitors,
    pageViews: pageViews.length,
    averagePagesPerVisitor,
    averageStaySeconds,
    dailyVisitorsTrend: buckets.map((bucket) => {
      const state = bucketMap.get(bucket.key)!;
      return {
        label: bucket.label,
        visitors: state.visitors.size,
        pageViews: state.pageViews
      };
    }),
    deviceSummary: buildMetricItems(deviceCountMap, uniqueVisitors, DEVICE_ORDER),
    deviceTrend: buckets.map((bucket) => {
      const state = bucketMap.get(bucket.key)!;
      const bucketVisitorTotal = state.visitors.size;
      return {
        label: bucket.label,
        phone: ratio(state.deviceVisitors.phone.size, bucketVisitorTotal),
        desktop: ratio(state.deviceVisitors.desktop.size, bucketVisitorTotal),
        tablet: ratio(state.deviceVisitors.tablet.size, bucketVisitorTotal)
      };
    }),
    visitTypeSummary: [
      { label: "신규", count: newVisitCount, ratio: ratio(newVisitCount, uniqueVisitors) },
      { label: "재방문", count: returningVisitCount, ratio: ratio(returningVisitCount, uniqueVisitors) }
    ],
    visitTypeTrend: buckets.map((bucket) => {
      const state = bucketMap.get(bucket.key)!;
      let bucketNewVisits = 0;
      let bucketReturningVisits = 0;
      for (const [visitorKey, firstSeenAt] of state.visitorFirstSeen.entries()) {
        if (visitorFirstSeenAt.get(visitorKey) === firstSeenAt) bucketNewVisits += 1;
        else bucketReturningVisits += 1;
      }
      const bucketVisitorTotal = state.visitors.size;
      return {
        label: bucket.label,
        newVisits: ratio(bucketNewVisits, bucketVisitorTotal),
        returningVisits: ratio(bucketReturningVisits, bucketVisitorTotal)
      };
    }),
    referrerSummary,
    referrerTrend: buckets.map((bucket) => {
      const state = bucketMap.get(bucket.key)!;
      const current = state.referrers.get(topReferrerLabel) ?? 0;
      return {
        label: bucket.label,
        ratio: ratio(current, state.pageViews)
      };
    }),
    referrerTrendSeries,
    topReferrerLabel,
    topPages,
    topActivities,
    behaviorCards: [
      {
        label: "이탈",
        value: bounceRate,
        suffix: "%",
        accent: "#ff5b1a",
        icon: "↓",
        max: Math.max(...bounceValues, 0),
        min: Math.min(...bounceValues, 0)
      },
      {
        label: "새로고침",
        value: refreshRate,
        suffix: "%",
        accent: "#2966ff",
        icon: "⟳",
        max: Math.max(...refreshValues, 0),
        min: Math.min(...refreshValues, 0)
      },
      {
        label: "롤백",
        value: rollbackRate,
        suffix: "%",
        accent: "#9460ff",
        icon: "↶",
        max: Math.max(...rollbackValues, 0),
        min: Math.min(...rollbackValues, 0)
      }
    ]
  };
}

function mapProject(site: SiteRow, events: AnalyticsEventRow[], buckets: Bucket[], startDate: string, endDate: string): ProjectRecord {
  const domain = normalizeDomain(site.url);
  return {
    id: site.id,
    name: site.name,
    domain,
    url: site.url ?? "",
    logoUrl: createLogoUrl(domain, site.logo_url),
    headCode: "",
    trackingVerified: Boolean(site.tracking_verified),
    trackingCheckedAt: formatIso(site.tracking_checked_at),
    lastTestedAt: formatIso(site.last_tested_at),
    createdAt: site.created_at,
    trashedAt: formatIso(site.trashed_at),
    stats: buildStats(events, buckets, startDate, endDate)
  };
}

export async function getWorkspaceData(
  isAdmin: boolean,
  startDateInput?: string,
  endDateInput?: string,
  presetInput?: string | null
): Promise<WorkspaceData> {
  const cacheKey = JSON.stringify({
    isAdmin,
    startDateInput: startDateInput ?? "",
    endDateInput: endDateInput ?? "",
    presetInput: presetInput ?? ""
  });
  const cached = workspaceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { startDate, endDate, rangePreset } = getRangeConfig(startDateInput, endDateInput, presetInput);
  const buckets = buildBuckets(startDate, endDate, rangePreset);
  const rangeStart = startOfKstDay(startDate).toISOString();
  const rangeEnd = endOfKstDay(endDate).toISOString();
  const maxTotalEvents = getInclusiveDaySpan(startDate, endDate) * 50000;
  const supabase = supabaseAdmin;

  if (!supabase) {
    const emptyValue = {
      isAdmin,
      startDate,
      endDate,
      rangePreset,
      projects: [],
      trashedProjects: []
    };
    workspaceCache.set(cacheKey, {
      value: emptyValue,
      expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS
    });
    return emptyValue;
  }

  const { data: sites } = await supabase.from("pb_sites").select("*").order("created_at", { ascending: true });

  const siteRows = (sites as SiteRow[] | null) ?? [];
  const eventRows = await fetchAnalyticsEventsInRange(
    siteRows.map((site) => site.id),
    rangeStart,
    rangeEnd,
    maxTotalEvents
  );
  const mapped = siteRows.map((site) =>
    mapProject(
      site,
      eventRows.filter((event) => event.site_id === site.id),
      buckets,
      startDate,
      endDate
    )
  );

  const result = {
    isAdmin,
    startDate,
    endDate,
    rangePreset,
    projects: mapped.filter((site) => !site.trashedAt),
    trashedProjects: mapped.filter((site) => Boolean(site.trashedAt))
  };
  workspaceCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + WORKSPACE_CACHE_TTL_MS
  });
  return result;
}

