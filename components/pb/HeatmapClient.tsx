"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition
} from "react";
import type { HeatmapData, HeatmapRangePreset } from "@/lib/pb/heatmap-data";
import { DateRangePicker, toServerPreset, type DateRange } from "@/components/pb/DateRangePicker";

type SecretPageItem = {
  id: string;
  key: string;
  label: string;
  url: string;
  pageViews: number;
  averageScrollPercent: number;
};

type HeatmapClientProps = {
  data: HeatmapData | null;
  initialSecretMode?: string;
};

type LayoutMetrics = {
  originalWidth: number;
  originalHeight: number;
};

type DropPoint = {
  index: number;
  label: string;
  percent: number;
  ratio: number;
  delta: number;
};

const PC_WIDTH = 1440;
const MO_WIDTH = 430;
const PREVIEW_VIEWPORT_HEIGHT_PC = 840;
const PREVIEW_VIEWPORT_HEIGHT_MO = 860;

/* 기간 계산은 DateRangePicker 가 서울 시간 기준으로 전담한다(예전 toDateInput/buildPresetRange 제거). */

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

function buildDistributionPoints(values: { percent: number; ratio: number }[], width: number, height: number) {
  return values.map((item) => ({
    x: 16 + (Math.max(0, Math.min(100, item.ratio)) / 100) * (width - 32),
    y: (item.percent / 100) * height,
    ratio: item.ratio,
    percent: item.percent
  }));
}

function buildDistributionPath(values: { percent: number; ratio: number }[], width: number, height: number) {
  const points = buildDistributionPoints(values, width, height);
  if (!points.length) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function buildDistributionArea(values: { percent: number; ratio: number }[], width: number, height: number) {
  const points = buildDistributionPoints(values, width, height);
  if (!points.length) return "";
  const line = buildDistributionPath(values, width, height);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L 0 ${last.y.toFixed(2)} L 0 ${first.y.toFixed(2)} Z`;
}

function buildCurvePoints(values: { label: string; ratio: number }[], width: number, height: number) {
  return values.map((item, index) => ({
    x: values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: height - (Math.max(0, Math.min(100, item.ratio)) / 100) * height,
    label: item.label,
    ratio: item.ratio
  }));
}

function buildLinePath(points: { x: number; y: number }[]) {
  if (!points.length) return "";
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function buildAreaPath(points: { x: number; y: number }[], width: number, height: number) {
  if (!points.length) return "";
  return `${buildLinePath(points)} L ${width} ${height} L 0 ${height} Z`;
}

function getThresholdDropPoints(curve: HeatmapData["scrollCurve"]) {
  const drops: DropPoint[] = [];
  for (let index = 1; index < curve.length; index += 1) {
    const prev = curve[index - 1];
    const next = curve[index];
    const delta = prev.ratio - next.ratio;
    if (delta >= 10) {
      drops.push({
        index,
        label: next.label,
        percent: next.percent,
        ratio: next.ratio,
        delta
      });
    }
  }
  return drops.slice(0, 5);
}

function formatRangeLabel(startDate: string, endDate: string) {
  if (startDate === endDate) return startDate;
  return `${startDate} ~ ${endDate}`;
}

function toSecretPageItem(raw: any): SecretPageItem {
  return {
    id: String(raw.id),
    key: String(raw.page_key),
    label: String(raw.name),
    url: String(raw.url),
    pageViews: Number(raw.pageViews ?? raw.page_views ?? 0),
    averageScrollPercent: Number(raw.averageScrollPercent ?? raw.average_scroll_percent ?? 0)
  };
}

function getDebugPayload(params: {
  debugEnabled: boolean;
  originalWidth: number;
  originalHeight: number;
  previewWidth: number;
  previewHeight: number;
  scaleX: number;
  scaleY: number;
  points: { x: number; y: number; percent: number; ratio: number }[];
}) {
  if (!params.debugEnabled) return;
  const first = params.points[0];
  const last = params.points[params.points.length - 1];
  console.log("[Pulseboard Heatmap Debug]", {
    originalWidth: params.originalWidth,
    originalHeight: params.originalHeight,
    previewWidth: params.previewWidth,
    previewHeight: params.previewHeight,
    scaleX: params.scaleX,
    scaleY: params.scaleY,
    firstPoint: first
      ? { original: { x: first.ratio, y: first.percent }, transformed: { x: first.x, y: first.y } }
      : null,
    lastPoint: last
      ? { original: { x: last.ratio, y: last.percent }, transformed: { x: last.x, y: last.y } }
      : null
  });
}

function HeatmapEmpty() {
  return (
    <main className="heatmap-shell">
      <section className="heatmap-empty-card">
        <Link href="/data-tracking" className="workspace-link-button">
          대시보드로 돌아가기
        </Link>
        <h1>UX HeatMap</h1>
        <p>프로젝트를 먼저 선택한 뒤 다시 들어와 주세요.</p>
      </section>
    </main>
  );
}

export function HeatmapClient({ data, initialSecretMode }: HeatmapClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  if (!data) {
    return <HeatmapEmpty />;
  }

  const heatmapData = data;

  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<"pc" | "mo">(heatmapData.deviceView);
  const [startDate, setStartDate] = useState(heatmapData.startDate);
  const [endDate, setEndDate] = useState(heatmapData.endDate);
  const [rangePreset, setRangePreset] = useState<HeatmapRangePreset>(heatmapData.rangePreset);
  const [previewPath, setPreviewPath] = useState(heatmapData.pageKey);
  const [secretMode, setSecretMode] = useState(initialSecretMode === "1" || heatmapData.isSecretPage);
  const [showSecretModal, setShowSecretModal] = useState(false);
  const [editingSecretId, setEditingSecretId] = useState<string | null>(null);
  const [secretName, setSecretName] = useState("");
  const [secretUrl, setSecretUrl] = useState("");
  const [secretError, setSecretError] = useState("");
  const [secretPages, setSecretPages] = useState<SecretPageItem[]>(heatmapData.secretPages);
  const [layoutMetrics, setLayoutMetrics] = useState<LayoutMetrics>({
    originalWidth: heatmapData.deviceView === "pc" ? PC_WIDTH : MO_WIDTH,
    originalHeight: heatmapData.deviceView === "pc" ? heatmapData.previewHeightDesktop : heatmapData.previewHeightMobile
  });
  const [scrollPercent, setScrollPercent] = useState(0);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [hoverDrop, setHoverDrop] = useState<DropPoint | null>(null);

  useEffect(() => {
    setSelectedDevice(heatmapData.deviceView);
    setStartDate(heatmapData.startDate);
    setEndDate(heatmapData.endDate);
    setRangePreset(heatmapData.rangePreset);
    setSecretPages(heatmapData.secretPages);
    setSecretMode(initialSecretMode === "1" || heatmapData.isSecretPage);
    setPreviewPath(heatmapData.pageKey);
    setLayoutMetrics({
      originalWidth: heatmapData.deviceView === "pc" ? PC_WIDTH : MO_WIDTH,
      originalHeight: heatmapData.deviceView === "pc" ? heatmapData.previewHeightDesktop : heatmapData.previewHeightMobile
    });
    setScrollPercent(0);
    setHoverDrop(null);
  }, [heatmapData, initialSecretMode]);

  useEffect(() => {
    const target = previewPanelRef.current;
    if (!target) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setPreviewWidth(entry.contentRect.width);
    });
    observer.observe(target);
    setPreviewWidth(target.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const originalWidth = layoutMetrics.originalWidth || (selectedDevice === "pc" ? PC_WIDTH : MO_WIDTH);
  const originalHeight =
    layoutMetrics.originalHeight ||
    (selectedDevice === "pc" ? heatmapData.previewHeightDesktop : heatmapData.previewHeightMobile);
  const viewportHeight = selectedDevice === "pc" ? PREVIEW_VIEWPORT_HEIGHT_PC : PREVIEW_VIEWPORT_HEIGHT_MO;
  const scale = previewWidth > 0 && originalWidth > 0 ? previewWidth / originalWidth : 1;
  const unscaledViewportHeight = Math.max(480, viewportHeight / Math.max(scale, 0.01));
  const scaledContentHeight = Math.max(viewportHeight, Math.round(originalHeight * scale));
  const translatedY = Math.max(0, (scaledContentHeight - viewportHeight) * (scrollPercent / 100));

  const distributionWidth = 160;
  const distributionHeight = scaledContentHeight;
  const distributionPoints = useMemo(
    () => buildDistributionPoints(heatmapData.scrollCurve, distributionWidth, distributionHeight),
    [heatmapData.scrollCurve, distributionHeight]
  );
  const distributionPath = useMemo(
    () => buildDistributionPath(heatmapData.scrollCurve, distributionWidth, distributionHeight),
    [heatmapData.scrollCurve, distributionHeight]
  );
  const distributionArea = useMemo(
    () => buildDistributionArea(heatmapData.scrollCurve, distributionWidth, distributionHeight),
    [heatmapData.scrollCurve, distributionHeight]
  );

  const curveWidth = 620;
  const curveHeight = 220;
  const curvePoints = useMemo(() => buildCurvePoints(heatmapData.scrollCurve, curveWidth, curveHeight), [heatmapData.scrollCurve]);
  const dropPoints = useMemo(() => getThresholdDropPoints(heatmapData.scrollCurve), [heatmapData.scrollCurve]);

  useEffect(() => {
    getDebugPayload({
      debugEnabled,
      originalWidth,
      originalHeight,
      previewWidth,
      previewHeight: viewportHeight,
      scaleX: scale,
      scaleY: scale,
      points: distributionPoints
    });
  }, [debugEnabled, originalHeight, originalWidth, previewWidth, viewportHeight, scale, distributionPoints]);

  function updateRoute(next: {
    start?: string;
    end?: string;
    preset?: HeatmapRangePreset;
    page?: string;
    device?: "pc" | "mo";
    secret?: boolean;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("project", heatmapData.projectId);
    params.set("start", next.start ?? startDate);
    params.set("end", next.end ?? endDate);
    params.set("preset", next.preset ?? rangePreset);
    params.set("device", next.device ?? selectedDevice);
    const pageValue = next.page ?? previewPath;
    if (pageValue) params.set("page", pageValue);
    if (next.secret ?? secretMode) params.set("secret", "1");
    else params.delete("secret");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  /* 기간 선택기에서 [업데이트] 를 누르면 호출. 선택기가 다루는 기간이 서버 타입보다 많아
     서버가 아는 것만 환산하고 나머지는 실제 날짜(CUSTOM)로 넘긴다. */
  function applyRange(range: DateRange, presetKey: string) {
    const preset = toServerPreset(presetKey) as HeatmapRangePreset;
    setRangePreset(preset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
    updateRoute({ start: range.startDate, end: range.endDate, preset });
  }

  function handleDeviceChange(device: "pc" | "mo") {
    setSelectedDevice(device);
    setLayoutMetrics({
      originalWidth: device === "pc" ? PC_WIDTH : MO_WIDTH,
      originalHeight: device === "pc" ? heatmapData.previewHeightDesktop : heatmapData.previewHeightMobile
    });
    updateRoute({ device });
  }

  const selectedPageTitle = secretMode ? "비밀페이지 데이터 전용 모드" : heatmapData.pageLabel;
  const secretPreviewEnabled = !secretMode;

  const translatedPreviewStyle: CSSProperties = {
    width: `${originalWidth}px`,
    height: `${unscaledViewportHeight}px`,
    transform: `scale(${scale})`,
    transformOrigin: "top left"
  };

  const iframeStyle: CSSProperties = {
    width: `${originalWidth}px`,
    height: `${unscaledViewportHeight}px`
  };

  async function handleSecretSubmit() {
    setSecretError("");
    try {
      const response = await fetch(
        editingSecretId
          ? `/api/pb/sites/${heatmapData.projectId}/secret-pages/${editingSecretId}`
          : `/api/pb/sites/${heatmapData.projectId}/secret-pages`,
        {
          method: editingSecretId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: secretName, url: secretUrl })
        }
      );
      const payload = await response.json();
      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "비밀페이지 저장에 실패했습니다.");
      }
      const item = toSecretPageItem(payload.item);
      setSecretPages((current) => {
        const next = current.filter((entry) => entry.id !== item.id);
        next.push(item);
        return next;
      });
      setShowSecretModal(false);
      setEditingSecretId(null);
      setSecretName("");
      setSecretUrl("");
      setSecretMode(true);
      setPreviewPath(item.key);
      updateRoute({ page: item.key, secret: true });
    } catch (error) {
      setSecretError(error instanceof Error ? error.message : "비밀페이지 저장에 실패했습니다.");
    }
  }

  async function handleSecretDelete(secretId: string) {
    const response = await fetch(`/api/pb/sites/${heatmapData.projectId}/secret-pages/${secretId}`, {
      method: "DELETE"
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) {
      setSecretError(payload?.error ?? "비밀페이지 삭제에 실패했습니다.");
      return;
    }
    setSecretPages((current) => current.filter((item) => item.id !== secretId));
  }

  function openSecretCreate() {
    setEditingSecretId(null);
    setSecretName("");
    setSecretUrl("");
    setSecretError("");
    setShowSecretModal(true);
  }

  function openSecretEdit(item: SecretPageItem) {
    setEditingSecretId(item.id);
    setSecretName(item.label);
    setSecretUrl(item.url);
    setSecretError("");
    setShowSecretModal(true);
  }

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const payload = event.data;
      if (!payload || typeof payload !== "object") return;
      if (payload.siteId && payload.siteId !== heatmapData.projectId) return;

      if (payload.type === "pulseboard:layout-context") {
        setLayoutMetrics((current) => ({
          originalWidth: selectedDevice === "pc" ? PC_WIDTH : MO_WIDTH,
          originalHeight:
            typeof payload.originalHeight === "number" && payload.originalHeight > 0
              ? Math.max(current.originalHeight, payload.originalHeight)
              : current.originalHeight
        }));
      }

      if (payload.type === "pulseboard:scroll-context" && typeof payload.scrollPercent === "number") {
        setScrollPercent(Math.max(0, Math.min(100, payload.scrollPercent)));
      }

      if (payload.type === "pulseboard:page-context") {
        const nextKey = normalizePageKeyFromUrl(payload.url || payload.path || heatmapData.projectUrl);
        setPreviewPath(nextKey);
        const matchedSecret = secretPages.find((item) => item.key === nextKey);
        if (matchedSecret) {
          if (!secretMode || searchParams.get("page") !== nextKey) {
            setSecretMode(true);
            updateRoute({ page: nextKey, secret: true });
          }
          return;
        }

        const matchedPage = heatmapData.pageOptions.find((item) => item.key === nextKey);
        if (matchedPage && searchParams.get("page") !== nextKey) {
          setSecretMode(false);
          updateRoute({ page: nextKey, secret: false });
        }
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [heatmapData.pageOptions, heatmapData.projectId, heatmapData.projectUrl, searchParams, secretMode, secretPages, selectedDevice]);

  return (
    <main className="heatmap-shell">
      <section className="heatmap-header-card">
        <div>
          <Link href={`/data-tracking?project=${encodeURIComponent(heatmapData.projectId)}`} className="workspace-link-button">
            대시보드로 돌아가기
          </Link>
          <h1>UX HeatMap</h1>
          <p>{heatmapData.projectName}</p>
        </div>
        <div className="heatmap-header-actions">
          <div className="heatmap-device-toggle">
            <button type="button" className={`heatmap-mode-button ${selectedDevice === "pc" ? "active" : ""}`} onClick={() => handleDeviceChange("pc")}>
              PC
            </button>
            <button type="button" className={`heatmap-mode-button ${selectedDevice === "mo" ? "active" : ""}`} onClick={() => handleDeviceChange("mo")}>
              MO
            </button>
            <button type="button" className={`heatmap-mode-button ${debugEnabled ? "active" : ""}`} onClick={() => setDebugEnabled((current) => !current)}>
              DEBUG
            </button>
          </div>
          <div className="heatmap-range-actions workspace-settings-actions">
            {/* 대시보드와 같은 기간 선택기(광고 관리자 스타일) */}
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              disabled={isPending}
              onApply={(range, presetKey) => applyRange(range, presetKey)}
            />
            <button type="button" className="workspace-button-secondary" onClick={openSecretCreate}>
              비밀페이지 등록
            </button>
          </div>
        </div>
      </section>

      <section className="heatmap-stage-card">
        <div className="heatmap-stage-toolbar">
          <div>
            <strong>스크롤 히트맵</strong>
            <p>{selectedPageTitle} 기준으로 스크롤 도달률을 계산합니다.</p>
          </div>
          <div className="heatmap-legend-bar">
            <span>COLD</span>
            <div className="heatmap-legend-gradient" />
            <span>HOT</span>
          </div>
        </div>

        <div className="heatmap-layout heatmap-layout-rebuilt">
          <section className="heatmap-preview-card heatmap-preview-card-rebuilt">
            <div className="heatmap-card-head">
              <div>
                <strong>{heatmapData.pageLabel}</strong>
                <span>{heatmapData.projectUrl}</span>
              </div>
              <span>{formatRangeLabel(heatmapData.startDate, heatmapData.endDate)}</span>
            </div>

            <div className="heatmap-linked-shell">
              <div className="heatmap-linked-track">
                <div
                  ref={previewPanelRef}
                  className={`heatmap-preview-panel ${debugEnabled ? "heatmap-debug-preview" : ""}`}
                  style={{ height: `${viewportHeight}px` }}
                >
                  <div className="heatmap-preview-stage" style={translatedPreviewStyle}>
                    {secretPreviewEnabled ? (
                      <iframe
                        title={`${heatmapData.projectName} heatmap preview`}
                        className="heatmap-preview-frame"
                        src={heatmapData.projectUrl}
                        style={iframeStyle}
                      />
                    ) : (
                      <div className="heatmap-secret-empty" style={{ width: `${originalWidth}px`, height: `${unscaledViewportHeight}px` }}>
                        <strong>비밀페이지는 미리보기를 지원하지 않습니다.</strong>
                        <span>등록한 랜딩페이지의 스크롤 데이터만 확인합니다.</span>
                      </div>
                    )}
                  </div>
                </div>

                <aside className="heatmap-scrollmap-panel">
                  <div className="heatmap-scrollmap-head">
                    <strong>스크롤 도달 분포</strong>
                    <span>{formatRangeLabel(heatmapData.startDate, heatmapData.endDate)}</span>
                  </div>
                  <div className="heatmap-scrollmap-body">
                    <div className="heatmap-scrollmap-legend">
                      <span>HOT</span>
                      <div className="heatmap-scrollmap-legend-bar" style={{ height: `${viewportHeight}px` }} />
                      <span>COLD</span>
                    </div>
                    <div
                      className={`heatmap-scrollmap-stage ${debugEnabled ? "heatmap-debug-canvas" : ""}`}
                      style={{ height: `${viewportHeight}px` }}
                    >
                      <div
                        className="heatmap-scrollmap-content"
                        style={{
                          height: `${scaledContentHeight}px`,
                          transform: `translateY(-${translatedY}px)`
                        }}
                      >
                        {heatmapData.scrollBands.map((band) => (
                          <div
                            key={`${band.from}-${band.to}`}
                            className="heatmap-scrollmap-band"
                            style={{
                              top: `${(band.from / 100) * scaledContentHeight}px`,
                              height: `${((band.to - band.from) / 100) * scaledContentHeight}px`,
                              background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,${Math.min(0.08 + band.ratio / 180, 0.42)}) 100%)`
                            }}
                          />
                        ))}
                        <svg viewBox={`0 0 ${distributionWidth} ${distributionHeight}`} className="heatmap-scrollmap-svg" preserveAspectRatio="none">
                          <defs>
                            <filter id="scrollMapGlow">
                              <feGaussianBlur stdDeviation="2.4" result="blur" />
                              <feMerge>
                                <feMergeNode in="blur" />
                                <feMergeNode in="SourceGraphic" />
                              </feMerge>
                            </filter>
                          </defs>
                          <path d={distributionArea} className="heatmap-scrollmap-area" />
                          <path d={distributionPath} className="heatmap-scrollmap-line" />
                        </svg>
                        {heatmapData.thresholdSummary.map((item) => {
                          const top = (Number(item.label.replace("%", "")) / 100) * scaledContentHeight;
                          return (
                            <div key={item.label} className="heatmap-scrollmap-line-row" style={{ top }}>
                              <span>{item.label}</span>
                            </div>
                          );
                        })}
                        <div className="heatmap-scrollmap-fold" style={{ top: `${(heatmapData.averageFoldPercent / 100) * scaledContentHeight}px` }}>
                          <span>AVERAGE FOLD {heatmapData.averageFoldPercent}%</span>
                        </div>
                        {dropPoints.map((item) => {
                          const point = distributionPoints[item.index];
                          if (!point) return null;
                          return (
                            <div key={`${item.label}-${item.percent}`} className="heatmap-drop-group">
                              <svg viewBox={`0 0 ${distributionWidth} ${distributionHeight}`} className="heatmap-scrollmap-svg" preserveAspectRatio="none">
                                <circle
                                  cx={point.x}
                                  cy={point.y}
                                  r="6"
                                  className="heatmap-drop-point"
                                  onMouseEnter={() => setHoverDrop(item)}
                                  onMouseLeave={() => setHoverDrop((current) => (current?.index === item.index ? null : current))}
                                />
                              </svg>
                              {hoverDrop?.index === item.index ? (
                                <div className="heatmap-drop-tooltip heatmap-drop-tooltip-scrollmap" style={{ left: `${Math.min(point.x + 10, distributionWidth - 90)}px`, top: `${point.y}px` }}>
                                  <strong>급락 포인트!</strong>
                                  <span>{item.label} / -{item.delta.toFixed(1)}%</span>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
          </section>

          <aside className="heatmap-side-column">
            <section className="heatmap-side-card heatmap-side-card-metrics">
              <article className="heatmap-mini-stat"><span>이 페이지 방문자</span><strong>{heatmapData.totalVisitors.toLocaleString()}</strong></article>
              <article className="heatmap-mini-stat"><span>페이지뷰</span><strong>{heatmapData.totalPageViews.toLocaleString()}</strong></article>
              <article className="heatmap-mini-stat"><span>평균 도달률</span><strong>{heatmapData.averageScrollPercent}%</strong></article>
              <article className="heatmap-mini-stat"><span>평균 Fold</span><strong>{heatmapData.averageFoldPercent}%</strong></article>
            </section>

            <section className="heatmap-side-card">
              <div className="heatmap-card-head"><strong>도달 구간</strong><span>{selectedDevice === "pc" ? "PC" : "MO"}</span></div>
              <div className="heatmap-threshold-grid">
                {heatmapData.thresholdSummary.map((item, index) => (
                  <article key={item.label} className={`heatmap-threshold-card ${index === 0 ? "warm" : index === 1 ? "neutral" : index === 2 ? "cool" : "dark"}`}>
                    <span>{item.label} 이상</span>
                    <strong>{item.ratio}%</strong>
                    <small>{item.visitors.toLocaleString()}명</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="heatmap-side-card">
              <div className="heatmap-card-head"><strong>도달률 추이</strong><span>{selectedPageTitle}</span></div>
              <div className="heatmap-curve-chart">
                <div className="heatmap-curve-scale"><span>100%</span><span>50%</span><span>0</span></div>
                <div className="heatmap-curve-body">
                  <svg viewBox={`0 0 ${curveWidth} ${curveHeight}`} className="heatmap-curve-svg" preserveAspectRatio="none">
                    {[0, 0.5, 1].map((ratioItem) => (
                      <line key={ratioItem} className="heatmap-gridline" x1="0" x2={curveWidth} y1={(1 - ratioItem) * curveHeight} y2={(1 - ratioItem) * curveHeight} />
                    ))}
                    <path d={buildAreaPath(curvePoints, curveWidth, curveHeight)} className="heatmap-curve-fill" />
                    <path d={buildLinePath(curvePoints)} className="heatmap-curve-line" />
                  </svg>
                  {hoverDrop ? (
                    <div className="heatmap-drop-tooltip heatmap-drop-tooltip-curve" style={{ left: "16px", top: "12px" }}>
                      <strong>급락 포인트!</strong>
                      <span>{hoverDrop.label} / -{hoverDrop.delta.toFixed(1)}%</span>
                    </div>
                  ) : null}
                  <div className="heatmap-curve-labels">
                    {heatmapData.scrollCurve.filter((_, index) => index % 4 === 0 || index === heatmapData.scrollCurve.length - 1).map((item) => (
                      <span key={item.label}>{item.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="heatmap-side-card">
              <div className="heatmap-card-head">
                <strong>비밀페이지</strong>
                <button type="button" className="heatmap-link-button" onClick={openSecretCreate}>등록</button>
              </div>
              {secretPages.length ? (
                <div className="heatmap-secret-list">
                  {secretPages.map((item) => (
                    <div key={item.id} className={`heatmap-secret-row ${previewPath === item.key ? "active" : ""}`}>
                      <button type="button" className="heatmap-secret-open" onClick={() => {
                        setSecretMode(true);
                        setPreviewPath(item.key);
                        updateRoute({ page: item.key, secret: true });
                      }}>●</button>
                      <div className="heatmap-secret-meta">
                        <strong>{item.label}</strong>
                        <span>{item.url}</span>
                      </div>
                      <div className="heatmap-secret-actions">
                        <button type="button" className="heatmap-icon-button" onClick={() => openSecretEdit(item)}>수정</button>
                        <button type="button" className="heatmap-icon-button danger" onClick={() => void handleSecretDelete(item.id)}>삭제</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="heatmap-secret-empty">
                  <strong>등록된 비밀페이지가 없습니다.</strong>
                  <span>링크를 등록하면 미리보기 없이 데이터 전용 모드로 분석할 수 있습니다.</span>
                </div>
              )}
            </section>
          </aside>
        </div>
      </section>

      {showSecretModal ? (
        <div className="workspace-modal-backdrop" role="presentation" onClick={() => setShowSecretModal(false)}>
          <section className="workspace-modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h2>{editingSecretId ? "비밀페이지 수정" : "비밀페이지 등록"}</h2>
            <p>미리보기 없이 스크롤 데이터만 확인할 랜딩페이지를 등록합니다.</p>
            <div className="workspace-form">
              <label className="workspace-form-field">
                <span>페이지 이름</span>
                <input value={secretName} onChange={(event) => setSecretName(event.target.value)} placeholder="예: 블로그 랜딩" />
              </label>
              <label className="workspace-form-field">
                <span>페이지 URL</span>
                <input value={secretUrl} onChange={(event) => setSecretUrl(event.target.value)} placeholder="https://example.com/landing" />
              </label>
            </div>
            {secretError ? <p style={{ color: "#dc2626" }}>{secretError}</p> : null}
            <div className="workspace-modal-actions">
              <button type="button" className="workspace-button-secondary" onClick={() => setShowSecretModal(false)}>닫기</button>
              <button type="button" className="workspace-button-primary" onClick={() => void handleSecretSubmit()}>{editingSecretId ? "수정" : "등록"}</button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
