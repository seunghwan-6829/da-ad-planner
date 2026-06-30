import { supabaseAdmin } from "@/lib/supabase-admin";

type SiteRow = {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
};

type SecretPageRow = {
  id: string;
  site_id: string;
  name: string;
  url: string;
  page_key: string;
  created_at: string;
  updated_at: string;
};

type HeatmapEventRow = {
  id: string;
  site_id: string;
  session_id: string | null;
  visitor_id: string | null;
  event_type: string;
  url: string | null;
  path: string | null;
  device_type?: string | null;
  created_at: string;
  max_scroll_percent: number | null;
  scroll_percent: number | null;
};

export type HeatmapRangePreset = "TODAY" | "7D" | "30D" | "CUSTOM";

export type HeatmapData = {
  projectId: string;
  projectName: string;
  projectUrl: string;
  pageKey: string;
  pageLabel: string;
  previewHeightDesktop: number;
  previewHeightMobile: number;
  isSecretPage: boolean;
  deviceView: "pc" | "mo";
  startDate: string;
  endDate: string;
  rangePreset: HeatmapRangePreset;
  pageOptions: { key: string; label: string; url: string; pageViews: number; averageScrollPercent: number }[];
  secretPages: { id: string; key: string; label: string; url: string; pageViews: number; averageScrollPercent: number }[];
  totalVisitors: number;
  totalPageViews: number;
  totalScrollSignals: number;
  averageScrollPercent: number;
  averageFoldPercent: number;
  thresholdSummary: { label: string; visitors: number; ratio: number }[];
  scrollBands: { from: number; to: number; visitors: number; ratio: number }[];
  scrollCurve: { label: string; percent: number; visitors: number; ratio: number }[];
};

type HeatmapCacheEntry = {
  expiresAt: number;
  value: HeatmapData | null;
};

const heatmapCache = new Map<string, HeatmapCacheEntry>();

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HEATMAP_CACHE_TTL_MS = 30 * 1000;

function toDateInput(date: Date) {
  const korea = new Date(date.getTime() + KST_OFFSET_MS);
  const year = korea.getUTCFullYear();
  const month = String(korea.getUTCMonth() + 1).padStart(2, "0");
  const day = String(korea.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

async function fetchHeatmapEventsInRange(
  projectId: string,
  rangeStart: string,
  rangeEnd: string,
  maxTotal: number
) {
  const supabase = supabaseAdmin;
  if (!supabase) return [] as HeatmapEventRow[];

  const pageSize = 1000;
  const rows: HeatmapEventRow[] = [];
  let offset = 0;

  while (offset < maxTotal) {
    const upper = Math.min(offset + pageSize - 1, maxTotal - 1);
    const { data } = await supabase
      .from("pb_analytics_events")
      .select("id,site_id,session_id,visitor_id,event_type,url,path,device_type,created_at,max_scroll_percent,scroll_percent")
      .eq("site_id", projectId)
      .gte("created_at", rangeStart)
      .lte("created_at", rangeEnd)
      .order("created_at", { ascending: false })
      .range(offset, upper);

    const batch = (data as HeatmapEventRow[] | null) ?? [];
    rows.push(...batch);

    if (batch.length < pageSize) break;
    offset += pageSize;
  }

  return rows;
}

function normalizePreset(value?: string | null): HeatmapRangePreset {
  if (value === "TODAY" || value === "7D" || value === "30D") {
    return value;
  }
  return "CUSTOM";
}

function getRange(
  startDateInput?: string,
  endDateInput?: string,
  presetInput?: string | null
): { startDate: string; endDate: string; rangePreset: HeatmapRangePreset } {
  const today = toDateInput(new Date());
  const preset = normalizePreset(presetInput);

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
    const startDate = startDateInput;
    const endDate = endDateInput;
    return startDate <= endDate
      ? { startDate, endDate, rangePreset: "CUSTOM" as const }
      : { startDate: endDate, endDate: startDate, rangePreset: "CUSTOM" as const };
  }

  return { startDate: today, endDate: today, rangePreset: "TODAY" as const };
}

function normalizePageKeyFromUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "/";
    const preserved = new URLSearchParams();
    for (const [key, rawValue] of url.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === "idx" ||
        normalizedKey === "id" ||
        normalizedKey === "page" ||
        normalizedKey === "tab" ||
        normalizedKey === "category" ||
        normalizedKey === "sort" ||
        normalizedKey === "type" ||
        normalizedKey === "q"
      ) {
        preserved.set(key, rawValue);
      }
    }
    const search = preserved.toString();
    return `${path}${search ? `?${search}` : ""}` || "/";
  } catch {
    return "/";
  }
}

function normalizePageKey(event: Pick<HeatmapEventRow, "url" | "path">) {
  if (event.url) return normalizePageKeyFromUrl(event.url);
  if (!event.path) return "/";
  if (event.path.startsWith("http")) return normalizePageKeyFromUrl(event.path);
  const [path, search = ""] = event.path.split("?");
  const normalizedPath = path !== "/" ? path.replace(/\/+$/, "") : "/";
  const params = new URLSearchParams(search);
  const preserved = new URLSearchParams();
  for (const [key, rawValue] of params.entries()) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === "idx" ||
      normalizedKey === "id" ||
      normalizedKey === "page" ||
      normalizedKey === "tab" ||
      normalizedKey === "category" ||
      normalizedKey === "sort" ||
      normalizedKey === "type" ||
      normalizedKey === "q"
    ) {
      preserved.set(key, rawValue);
    }
  }
  const normalizedSearch = preserved.toString();
  return `${normalizedPath}${normalizedSearch ? `?${normalizedSearch}` : ""}` || "/";
}

function getVisitorKey(event: Pick<HeatmapEventRow, "visitor_id" | "session_id">) {
  return event.visitor_id?.trim() || event.session_id?.trim() || "anonymous";
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, current) => sum + current, 0) / values.length);
}

function ratio(count: number, total: number) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

async function estimatePageHeights(url: string) {
  const fallback = { desktop: 5600, mobile: 7200 };
  if (!url) return fallback;

  try {
    const response = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      },
      cache: "no-store"
    });

    if (!response.ok) return fallback;

    const html = await response.text();
    const imgCount = (html.match(/<img\b/gi) ?? []).length;
    const sectionCount = (html.match(/<(section|article|main|header|footer|aside)\b/gi) ?? []).length;
    const paragraphCount = (html.match(/<(p|h1|h2|h3|li)\b/gi) ?? []).length;
    const buttonCount = (html.match(/<(button|a)\b/gi) ?? []).length;
    const tableCount = (html.match(/<table\b/gi) ?? []).length;
    const htmlLengthScore = Math.min(Math.ceil(html.length / 1600), 140);

    const desktopEstimate =
      1400 +
      imgCount * 220 +
      sectionCount * 220 +
      paragraphCount * 42 +
      buttonCount * 18 +
      tableCount * 260 +
      htmlLengthScore * 28;

    const desktop = Math.max(2200, Math.min(14000, desktopEstimate));
    const mobile = Math.max(2800, Math.min(20000, Math.round(desktop * 1.35)));

    return { desktop, mobile };
  } catch {
    return fallback;
  }
}

export async function getHeatmapData(
  projectId?: string,
  startDateInput?: string,
  endDateInput?: string,
  presetInput?: string | null,
  pageInput?: string,
  deviceInput?: string
): Promise<HeatmapData | null> {
  const cacheKey = JSON.stringify({
    projectId: projectId ?? "",
    startDateInput: startDateInput ?? "",
    endDateInput: endDateInput ?? "",
    presetInput: presetInput ?? "",
    pageInput: pageInput ?? "",
    deviceInput: deviceInput ?? ""
  });
  const cached = heatmapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const supabase = supabaseAdmin;
  if (!supabase || !projectId) return null;

  const { startDate, endDate, rangePreset } = getRange(startDateInput, endDateInput, presetInput);
  const rangeStart = startOfKstDay(startDate).toISOString();
  const rangeEnd = endOfKstDay(endDate).toISOString();
  const maxTotalEvents = getInclusiveDaySpan(startDate, endDate) * 50000;

  const [{ data: site }, events] = await Promise.all([
    supabase.from("pb_sites").select("id,name,url,logo_url").eq("id", projectId).single(),
    fetchHeatmapEventsInRange(projectId, rangeStart, rangeEnd, maxTotalEvents)
  ]);

  if (!site) return null;

  const siteRow = site as SiteRow;
  const { data: secretPagesData, error: secretPagesError } = await supabase
    .from("pb_secret_pages")
    .select("id,site_id,name,url,page_key,created_at,updated_at")
    .eq("site_id", projectId)
    .order("created_at", { ascending: true });

  const secretPageRows: SecretPageRow[] =
    secretPagesError || !secretPagesData ? [] : ((secretPagesData as SecretPageRow[]) ?? []);
  const requestedDevice: "pc" | "mo" = deviceInput === "mo" ? "mo" : "pc";
  const allEvents = (events ?? []).filter((event) => {
    const device = event.device_type ?? "desktop";
    if (requestedDevice === "pc") {
      return device === "desktop";
    }
    return device === "phone" || device === "mobile" || device === "tablet";
  });

  const pageMap = new Map<
    string,
    {
      key: string;
      label: string;
      url: string;
      pageViews: number;
      scrolls: number[];
    }
  >();

  for (const event of allEvents) {
    const key = normalizePageKey(event);
    const fallbackUrl = siteRow.url
      ? new URL(key === "/" ? "/" : key, siteRow.url).toString()
      : key;
    const entry = pageMap.get(key) ?? {
      key,
      label: key === "/" ? "메인 페이지" : key.split("?")[0].replace(/\//g, " ").trim() || key,
      url: event.url || fallbackUrl,
      pageViews: 0,
      scrolls: []
    };

    if (event.event_type === "page_view") {
      entry.pageViews += 1;
    }

    if (event.event_type === "page_leave" || event.event_type === "scroll_depth") {
      entry.scrolls.push(Math.max(event.max_scroll_percent ?? 0, event.scroll_percent ?? 0));
    }

    pageMap.set(key, entry);
  }

  const pageOptions = [...pageMap.values()]
    .map((item) => ({
      key: item.key,
      label: item.label,
      url: item.url,
      pageViews: item.pageViews,
      averageScrollPercent: average(item.scrolls)
    }))
    .sort((a, b) => b.pageViews - a.pageViews)
    .slice(0, 20);

  const secretPages = secretPageRows.map((item) => {
    const matchedEvents = allEvents.filter((event) => normalizePageKey(event) === item.page_key);
    const matchedScrolls = matchedEvents
      .filter((event) => event.event_type === "page_leave" || event.event_type === "scroll_depth")
      .map((event) => Math.max(event.max_scroll_percent ?? 0, event.scroll_percent ?? 0));

    return {
      id: item.id,
      key: item.page_key,
      label: item.name,
      url: item.url,
      pageViews: matchedEvents.filter((event) => event.event_type === "page_view").length,
      averageScrollPercent: average(matchedScrolls)
    };
  });

  const defaultPageKey = pageOptions[0]?.key ?? normalizePageKeyFromUrl(siteRow.url || "/");
  const selectedPageKey = typeof pageInput === "string" && pageInput.trim() ? pageInput : defaultPageKey;
  const selectedSecretPage = secretPages.find((item) => item.key === selectedPageKey) ?? null;
  const selectedPage =
    pageOptions.find((item) => item.key === selectedPageKey) ??
    (() => {
      const fallbackUrl = siteRow.url
        ? new URL(selectedPageKey === "/" ? "/" : selectedPageKey, siteRow.url).toString()
        : selectedPageKey;

      return {
        key: selectedPageKey,
        label:
          selectedPageKey === "/"
            ? "메인 페이지"
            : selectedPageKey.split("?")[0].replace(/\//g, " ").trim() || selectedPageKey,
        url: fallbackUrl,
        pageViews: 0,
        averageScrollPercent: 0
      };
    })();

  const eventRows = allEvents.filter((event) => normalizePageKey(event) === selectedPageKey);
  const pageViews = eventRows.filter((event) => event.event_type === "page_view");
  const scrollSignals = eventRows.filter((event) => event.event_type === "page_leave" || event.event_type === "scroll_depth");
  const previewHeights = await estimatePageHeights(selectedPage?.url || siteRow.url || "");

  const visitorSet = new Set(pageViews.map(getVisitorKey));
  const pageScrollMap = new Map<string, number>();
  for (const event of scrollSignals) {
    const visitorKey = getVisitorKey(event);
    const key = `${visitorKey}:${normalizePageKey(event)}`;
    const depth = Math.max(event.max_scroll_percent ?? 0, event.scroll_percent ?? 0);
    pageScrollMap.set(key, Math.max(pageScrollMap.get(key) ?? 0, depth));
  }

  const fallbackVisitors = new Set(pageScrollMap.keys().map((key) => key.split(":")[0]));
  const totalVisitors = visitorSet.size || fallbackVisitors.size;
  const maxScrollValues = [...pageScrollMap.values()];
  const averageScrollPercent = average(maxScrollValues);
  const averageFoldPercent = Math.max(15, Math.min(100, averageScrollPercent || 50));

  const thresholds = [25, 50, 75, 100];
  const thresholdSummary = thresholds.map((threshold) => {
    const visitors = maxScrollValues.filter((value) => value >= threshold).length;
    return {
      label: `${threshold}%`,
      visitors,
      ratio: ratio(visitors, totalVisitors)
    };
  });

  const scrollCurve = Array.from({ length: 21 }, (_, index) => {
    const percent = index * 5;
    const visitors = maxScrollValues.filter((value) => value >= percent).length;
    return {
      label: `${percent}%`,
      percent,
      visitors,
      ratio: ratio(visitors, totalVisitors)
    };
  });

  const scrollBands = scrollCurve.slice(0, -1).map((item, index) => ({
    from: item.percent,
    to: scrollCurve[index + 1].percent,
    visitors: item.visitors,
    ratio: item.ratio
  }));

  const result = {
    projectId: siteRow.id,
    projectName: siteRow.name,
    projectUrl: selectedSecretPage?.url || selectedPage?.url || siteRow.url || "",
    pageKey: selectedPageKey,
    pageLabel: selectedSecretPage?.label || selectedPage?.label || selectedPageKey,
    previewHeightDesktop: previewHeights.desktop,
    previewHeightMobile: previewHeights.mobile,
    isSecretPage: Boolean(selectedSecretPage),
    deviceView: requestedDevice,
    startDate,
    endDate,
    rangePreset,
    pageOptions,
    secretPages,
    totalVisitors,
    totalPageViews: pageViews.length,
    totalScrollSignals: scrollSignals.length,
    averageScrollPercent,
    averageFoldPercent,
    thresholdSummary,
    scrollBands,
    scrollCurve
  };
  heatmapCache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + HEATMAP_CACHE_TTL_MS
  });
  return result;
}
