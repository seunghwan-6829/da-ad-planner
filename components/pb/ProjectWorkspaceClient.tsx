"use client";

import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityItem, BehaviorCard, MetricItem, ProjectRecord, RangePreset, TopPageItem, WorkspaceData } from "@/lib/pb/home-data";
import { DateRangePicker, toServerPreset, type DateRange } from "@/components/pb/DateRangePicker";

type Props = {
  initialData: WorkspaceData;
  initialSelectedProjectId?: string;
};

function SuccessIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="workspace-icon-svg">
      <path d="M3.5 8.4 6.4 11.3 12.5 4.9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="workspace-icon-svg">
      <rect x="5" y="3" width="8" height="10" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 11V5.8C3 4.81 3.81 4 4.8 4H10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function formatDateTime(value: string) {
  if (!value) return "-";
  return new Date(value).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/* 기간 계산은 DateRangePicker 가 서울 시간 기준으로 전담한다(예전 toDateInput/buildPresetRange 제거).
   기존 함수들은 브라우저 로컬 시간을 써서, 해외에서 접속하면 하루가 밀릴 수 있었다. */

function buildHeadCode(project: ProjectRecord) {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  return `<script>\nwindow.PULSEBOARD_SITE_ID = "${project.id}";\nwindow.PULSEBOARD_ENDPOINT = "${origin}/api/pb/collect";\n</script>\n<script async src="${origin}/pb-tracker.js"></script>`;
}

async function readJson(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    throw new Error(data?.error ?? "요청을 처리하지 못했습니다.");
  }
  return data;
}

function buildLinePath(values: number[], width: number, height: number, max = Math.max(...values, 1)) {
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - (value / max) * height;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildAreaPath(values: number[], width: number, height: number, max = Math.max(...values, 1)) {
  return `${buildLinePath(values, width, height, max)} L ${width} ${height} L 0 ${height} Z`;
}

function polarToCartesian(cx: number, cy: number, radius: number, angle: number) {
  const radians = ((angle - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function buildArcPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function buildSectorPath(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}

function Labels({ labels }: { labels: string[] }) {
  const isHourly = labels.length === 24 && labels.every((label) => /^\d{2}:00$/.test(label));
  const visibleLabels = isHourly
    ? Array.from({ length: 13 }, (_, index) => {
        if (index === 12) {
          return { label: "24:00", index: labels.length };
        }
        const hourIndex = index * 2;
        return { label: labels[hourIndex] ?? `${String(hourIndex).padStart(2, "0")}:00`, index: hourIndex };
      })
    : labels
        .map((label, index) => ({ label, index }))
        .filter(({ index }) => {
          const every = labels.length > 18 ? 4 : labels.length > 12 ? 3 : labels.length > 8 ? 2 : 1;
          return index % every === 0 || index === labels.length - 1;
        });

  return (
    <div className="workspace-chart-labels">
      {visibleLabels.map(({ label, index }, visibleIndex) => {
        const position = labels.length <= 1 ? 0 : Math.min(index, labels.length - 1) / (labels.length - 1);
        const nextLabel = label;
        return (
        <span
          key={`${nextLabel}-${index}`}
          className={visibleIndex === 0 ? "start" : visibleIndex === visibleLabels.length - 1 ? "end" : "center"}
          style={{ left: `${(position * 100).toFixed(4)}%` }}
        >
          {nextLabel}
        </span>
      )})}
    </div>
  );
}

function clampIndex(index: number, length: number) {
  if (!length) return 0;
  return Math.max(0, Math.min(length - 1, index));
}

function TrendChart({ title, total, accent, labels, values }: { title: string; total: number; accent: string; labels: string[]; values: number[] }) {
  const width = 620;
  const height = 190;
  const topPad = 14;
  const max = Math.max(...values, 1);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const activeIndex = hoverIndex === null ? null : clampIndex(hoverIndex, values.length);
  const activeValue = activeIndex === null ? null : values[activeIndex] ?? 0;
  const activeLabel = activeIndex === null ? null : labels[activeIndex] ?? "";
  const activeX = activeIndex === null ? 0 : (activeIndex / Math.max(values.length - 1, 1)) * width;
  const activeY = activeIndex === null ? height + topPad : topPad + height - ((activeValue ?? 0) / max) * height;

  function handlePointerMove(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
    setHoverIndex(Math.round(ratio * Math.max(values.length - 1, 0)));
  }

  return (
    <article className="workspace-chart-card">
      <div className="workspace-chart-head">
        <div>
          <span>{title}</span>
          <strong>{total.toLocaleString()}</strong>
        </div>
      </div>
      <div className="workspace-chart-frame">
        <svg
          viewBox={`0 0 ${width} ${height + topPad + 12}`}
          className="workspace-chart-svg"
          preserveAspectRatio="none"
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIndex(null)}
        >
          <g transform={`translate(0 ${topPad})`}>
            <path d={buildAreaPath(values, width, height, max)} fill={`${accent}24`} />
            <path d={buildLinePath(values, width, height, max)} fill="none" stroke={accent} strokeWidth="3" />
          </g>
          {activeIndex !== null ? (
            <g>
              <line x1={activeX} x2={activeX} y1={topPad} y2={height + topPad} className="workspace-chart-crosshair" />
              <circle cx={activeX} cy={activeY} r="5" fill="#fff" stroke={accent} strokeWidth="3" />
            </g>
          ) : null}
        </svg>
        {activeIndex !== null ? (
          <div
            className="workspace-chart-tooltip"
            style={{
              left: `clamp(16px, calc(${((activeX / width) * 100).toFixed(2)}% - 52px), calc(100% - 120px))`,
              top: `clamp(14px, calc(${((activeY / height) * 100).toFixed(2)}% - 48px), calc(100% - 86px))`
            }}
          >
            <strong>{activeLabel}</strong>
            <span>{activeValue?.toLocaleString()}건</span>
          </div>
        ) : null}
      </div>
      <Labels labels={labels} />
    </article>
  );
}

function TopPagesCard({ items, onMore }: { items: TopPageItem[]; onMore: () => void }) {
  return (
    <article className="workspace-stat-card workspace-stat-card-list">
      <div className="workspace-card-topline">
        <span>많이 방문한 페이지</span>
        <button type="button" className="workspace-link-button" onClick={onMore}>
          더보기
        </button>
      </div>
      <div className="workspace-inline-table">
        {items.slice(0, 5).map((item) => (
          <div key={`${item.url}-${item.title}`} className="workspace-inline-table-row">
            <div className="workspace-inline-table-main workspace-inline-table-main-inline">
              <strong>{item.title}</strong>
              <span>|</span>
              <span>{item.url}</span>
            </div>
            <b>{item.views.toLocaleString()}</b>
          </div>
        ))}
        {!items.length ? <p className="workspace-empty-copy">이 기간에는 페이지 방문 데이터가 아직 없습니다.</p> : null}
      </div>
    </article>
  );
}

function TopActivitiesCard({ items, onMore }: { items: ActivityItem[]; onMore: () => void }) {
  return (
    <article className="workspace-panel-card workspace-panel-card-list">
      <div className="workspace-card-topline">
        <span>자주 하는 활동</span>
        <button type="button" className="workspace-link-button" onClick={onMore}>
          더보기
        </button>
      </div>
      <div className="workspace-inline-table">
        {items.slice(0, 5).map((item) => (
          <div key={`${item.label}-${item.detail}`} className="workspace-inline-table-row">
            <div className="workspace-inline-table-main workspace-inline-table-main-inline">
              <strong>{item.label}</strong>
              <span>|</span>
              <span>{item.detail}</span>
            </div>
            <b>{item.count.toLocaleString()}회</b>
          </div>
        ))}
        {!items.length ? <p className="workspace-empty-copy">이 기간에는 활동 로그가 아직 없습니다.</p> : null}
      </div>
    </article>
  );
}

function DetailListModal({
  open,
  title,
  subtitle,
  rows,
  onClose
}: {
  open: boolean;
  title: string;
  subtitle: string;
  rows: { title: string; subtitle: string; value: string }[];
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="workspace-modal-backdrop" onClick={onClose}>
      <div className="workspace-modal-card workspace-modal-list" onClick={(event) => event.stopPropagation()}>
        <div className="workspace-list-modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="workspace-secondary-button" onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="workspace-detail-list">
          {rows.length ? (
            rows.map((row, index) => (
              <div key={`${row.title}-${row.subtitle}-${index}`} className="workspace-detail-row">
                <span className="workspace-detail-rank">{index + 1}</span>
                <div className="workspace-detail-main workspace-detail-main-inline">
                  <strong>{row.title}</strong>
                  <span>|</span>
                  <span>{row.subtitle}</span>
                </div>
                <b>{row.value}</b>
              </div>
            ))
          ) : (
            <p className="workspace-empty-copy">이 기간에는 아직 확인할 상세 데이터가 없습니다.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BehaviorSummaryCard({ item }: { item: BehaviorCard }) {
  return (
    <article className="workspace-panel-card workspace-behavior-card">
      <span className="workspace-behavior-label">{item.label}</span>
      <div className="workspace-behavior-kicker">Avg.</div>
      <div className="workspace-behavior-value" style={{ color: item.accent }}>
        <strong>{item.value.toFixed(1)}</strong>
        <em>{item.suffix}</em>
        <i>{item.icon}</i>
      </div>
      <p>
        max. {item.max.toFixed(1)}
        {item.suffix} <span>|</span> min. {item.min.toFixed(1)}
        {item.suffix}
      </p>
    </article>
  );
}

function DonutChart({ items, colors }: { items: MetricItem[]; colors: string[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  let startAngle = 0;

  return (
    <div className="workspace-donut-shell">
      <div className="workspace-donut-hero">
        <svg viewBox="0 0 120 120" className="workspace-donut-ring">
          {total > 0 ? (
            items.map((item, index) => {
              const angle = (item.count / total) * 360;
              const path = buildSectorPath(60, 60, 48, startAngle, startAngle + angle);
              startAngle += angle;
              return (
                <path
                  key={item.label}
                  d={path}
                  fill={colors[index % colors.length]}
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              );
            })
          ) : (
            <circle cx="60" cy="60" r="48" fill="#eef1f4" />
          )}
        </svg>
        <div className="workspace-donut-hole">
          <span>합계</span>
          <strong>{total.toLocaleString()}</strong>
        </div>
      </div>
      <div className="workspace-donut-legend">
        {items.map((item, index) => (
          <div key={item.label} className="workspace-donut-legend-row">
            <div className="workspace-donut-legend-label">
              <span className="workspace-donut-legend-dot" style={{ backgroundColor: colors[index % colors.length] }} />
              <strong>{item.label}</strong>
            </div>
            <div className="workspace-donut-legend-value">
              <span>{item.count.toLocaleString()}</span>
              <strong>{item.ratio}%</strong>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiLinePercentChart({ labels, series }: { labels: string[]; series: { key: string; label: string; values: number[]; color: string; fill: string }[] }) {
  const width = 620;
  const height = 190;
  const topPad = 14;
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const activeIndex = hoverIndex === null ? null : clampIndex(hoverIndex, labels.length);
  const activeX = activeIndex === null ? 0 : (activeIndex / Math.max(labels.length - 1, 1)) * width;

  return (
    <div className="workspace-analytics-trend">
      <div className="workspace-analytics-scale">
        <span>100%</span>
        <span>50%</span>
        <span>0</span>
      </div>
      <div className="workspace-analytics-chart">
        <svg
          viewBox={`0 0 ${width} ${height + topPad + 8}`}
          className="workspace-analytics-svg"
          preserveAspectRatio="none"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
            setHoverIndex(Math.round(ratio * Math.max(labels.length - 1, 0)));
          }}
          onMouseLeave={() => setHoverIndex(null)}
        >
          {[0, 0.5, 1].map((step) => (
            <line key={step} x1="0" x2={width} y1={topPad + height - step * height} y2={topPad + height - step * height} className="workspace-analytics-gridline" />
          ))}
          {activeIndex !== null ? <line x1={activeX} x2={activeX} y1={topPad} y2={height + topPad} className="workspace-chart-crosshair" /> : null}
          <g transform={`translate(0 ${topPad})`}>
            {series.map((item) => (
              <g key={item.key}>
                <path d={buildAreaPath(item.values, width, height, 100)} fill={item.fill} />
                <path d={buildLinePath(item.values, width, height, 100)} fill="none" stroke={item.color} strokeWidth="3" />
                {activeIndex !== null ? (
                  <circle
                    cx={activeX}
                    cy={height - ((item.values[activeIndex] ?? 0) / 100) * height}
                    r="4.5"
                    fill="#fff"
                    stroke={item.color}
                    strokeWidth="2.5"
                  />
                ) : null}
              </g>
            ))}
          </g>
        </svg>
        {activeIndex !== null ? (
          <div
            className="workspace-chart-tooltip workspace-chart-tooltip-multi"
            style={{
              left: `clamp(16px, calc(${((activeX / width) * 100).toFixed(2)}% - 56px), calc(100% - 150px))`,
              top: "12px"
            }}
          >
            <strong>{labels[activeIndex]}</strong>
            {series.map((item) => (
              <span key={item.key}>
                <i style={{ backgroundColor: item.color }} />
                {item.label} {(item.values[activeIndex] ?? 0).toFixed(0)}%
              </span>
            ))}
          </div>
        ) : null}
        <Labels labels={labels} />
      </div>
    </div>
  );
}

function AnalyticsCard({ title, totalValue, totalLabel, items, labels, chartSeries }: { title: string; totalValue: string; totalLabel: string; items: MetricItem[]; labels: string[]; chartSeries: { key: string; label: string; values: number[]; color: string; fill: string }[] }) {
  return (
    <article className="workspace-analytics-card">
      <div className="workspace-analytics-header">
        <h3>{title}</h3>
        <span>{totalValue}{totalLabel}</span>
      </div>
      <div className="workspace-analytics-card-grid">
        <DonutChart items={items} colors={chartSeries.map((item) => item.color)} />
        <MultiLinePercentChart labels={labels} series={chartSeries} />
      </div>
    </article>
  );
}

function ReferrerAnalytics({
  items,
  labels,
  topLabel,
  trend,
  trendSeries
  }: {
    items: MetricItem[];
    labels: string[];
    topLabel: string;
    trend: { label: string; ratio: number }[];
    trendSeries: { label: string; values: number[] }[];
  }) {
    const width = 760;
    const height = 220;
    const topPad = 14;
  const colors = ["#1f9cf0", "#2454e6", "#9acb4f", "#f4b000", "#9b7ef3"];
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const activeIndex = hoverIndex === null ? null : clampIndex(hoverIndex, trend.length);
  const activeX = activeIndex === null ? 0 : (activeIndex / Math.max(trend.length - 1, 1)) * width;

  return (
      <article className="workspace-chart-card workspace-chart-card-wide">
      <div className="workspace-chart-head">
        <div>
          <span>유입경로 Top5</span>
          <strong>{topLabel || "데이터 없음"}</strong>
        </div>
      </div>
        {items.length ? (
          <div className="workspace-referrer-analytics">
            <div className="workspace-referrer-summary">
              <DonutChart items={items} colors={colors} />
            </div>
          <div className="workspace-referrer-trend">
             <div className="workspace-referrer-trend-head">
               <strong>대표 유입경로</strong>
                <span>일별 비중</span>
              </div>
              <div className="workspace-chart-frame">
              <svg
                viewBox={`0 0 ${width} ${height + topPad + 10}`}
                className="workspace-chart-svg workspace-chart-svg-tall"
                  preserveAspectRatio="none"
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const ratio = rect.width ? (event.clientX - rect.left) / rect.width : 0;
                    setHoverIndex(Math.round(ratio * Math.max(trend.length - 1, 0)));
                }}
                onMouseLeave={() => setHoverIndex(null)}
              >
                  {[0, 0.5, 1].map((step) => (
                    <line key={step} x1="0" x2={width} y1={topPad + height - step * height} y2={topPad + height - step * height} className="workspace-analytics-gridline" />
                  ))}
                  <g transform={`translate(0 ${topPad})`}>
                    {trendSeries.map((series, index) => (
                      <g key={series.label}>
                        {index === 0 ? <path d={buildAreaPath(series.values, width, height, 100)} fill={`${colors[index % colors.length]}1f`} /> : null}
                        <path d={buildLinePath(series.values, width, height, 100)} fill="none" stroke={colors[index % colors.length]} strokeWidth={index === 0 ? "3" : "2.2"} />
                        {activeIndex !== null ? (
                          <circle
                            cx={activeX}
                            cy={height - (((series.values[activeIndex] ?? 0) / 100) * height)}
                            r="4.5"
                            fill="#fff"
                            stroke={colors[index % colors.length]}
                            strokeWidth="2.5"
                          />
                        ) : null}
                      </g>
                    ))}
                  </g>
                  {activeIndex !== null ? <line x1={activeX} x2={activeX} y1={topPad} y2={height + topPad} className="workspace-chart-crosshair" /> : null}
                </svg>
                {activeIndex !== null ? (
                  <div
                    className="workspace-chart-tooltip"
                    style={{
                      left: `clamp(16px, calc(${((activeX / width) * 100).toFixed(2)}% - 64px), calc(100% - 168px))`,
                      top: "12px"
                    }}
                >
                  <strong>{trend[activeIndex]?.label ?? labels[activeIndex] ?? ""}</strong>
                  {trendSeries.map((series, index) => (
                    <span key={series.label}>
                      <i style={{ backgroundColor: colors[index % colors.length] }} />
                      {series.label} {(series.values[activeIndex] ?? 0).toFixed(0)}%
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <Labels labels={labels} />
          </div>
        </div>
      ) : (
        <div className="workspace-referrer-empty">
          <div>
            <strong>데이터 없음</strong>
            <p>이 기간에는 유입 데이터가 아직 없습니다.</p>
          </div>
          <div className="workspace-referrer-empty-side">
            <span>대표 유입경로</span>
            <strong>없음</strong>
          </div>
        </div>
      )}
    </article>
  );
}

export function ProjectWorkspaceClient({ initialData, initialSelectedProjectId }: Props) {
  const [workspace, setWorkspace] = useState(initialData);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialSelectedProjectId && initialData.projects.some((project) => project.id === initialSelectedProjectId)
      ? initialSelectedProjectId
      : initialData.projects[0]?.id ?? ""
  );
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createUrl, setCreateUrl] = useState("");
  const [settingsName, setSettingsName] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testSuccess, setTestSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [pagesModalOpen, setPagesModalOpen] = useState(false);
  const [activitiesModalOpen, setActivitiesModalOpen] = useState(false);
  const [dateRange, setDateRange] = useState({ startDate: initialData.startDate, endDate: initialData.endDate });
  const [rangePreset, setRangePreset] = useState<RangePreset>(initialData.rangePreset);

  const selectedProject = useMemo(
    () => workspace.projects.find((project) => project.id === selectedProjectId) ?? workspace.projects[0] ?? null,
    [selectedProjectId, workspace.projects]
  );

  useEffect(() => {
    if (!selectedProject) return;
    setSettingsName(selectedProject.name);
  }, [selectedProject]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("start", dateRange.startDate);
    params.set("end", dateRange.endDate);
    params.set("preset", rangePreset);
    if (selectedProjectId) params.set("project", selectedProjectId);
    window.history.replaceState(null, "", `/data-tracking?${params.toString()}`);
  }, [dateRange.endDate, dateRange.startDate, rangePreset, selectedProjectId]);

  async function refreshWorkspace(nextSelectedId?: string, range = dateRange, preset: RangePreset = rangePreset) {
    const params = new URLSearchParams({ start: range.startDate, end: range.endDate, preset });
    const response = await fetch(`/api/pb/sites?${params.toString()}`, { cache: "no-store" });
    const data = (await readJson(response)) as WorkspaceData & { ok: true };
    setWorkspace({
      isAdmin: true,
      startDate: data.startDate,
      endDate: data.endDate,
      rangePreset: data.rangePreset,
      projects: data.projects,
      trashedProjects: data.trashedProjects
      });
      setRangePreset(data.rangePreset);
      const targetId = nextSelectedId && data.projects.some((project) => project.id === nextSelectedId) ? nextSelectedId : data.projects[0]?.id ?? "";
      setSelectedProjectId(targetId);
    }

  useEffect(() => {
    if (!verifySuccess) return;
    const timer = window.setTimeout(() => setVerifySuccess(false), 1800);
    return () => window.clearTimeout(timer);
  }, [verifySuccess]);

  useEffect(() => {
    if (!testSuccess) return;
    const timer = window.setTimeout(() => setTestSuccess(false), 1800);
    return () => window.clearTimeout(timer);
  }, [testSuccess]);

  useEffect(() => {
    if (!copySuccess) return;
    const timer = window.setTimeout(() => setCopySuccess(false), 1400);
    return () => window.clearTimeout(timer);
  }, [copySuccess]);

  async function handleCreateProject() {
    if (!createUrl.trim()) {
      setNotice("사이트 URL을 입력해주세요.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/pb/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: createUrl.trim() })
      });
      const data = await readJson(response);
      await refreshWorkspace(data.site.id);
      setCreateUrl("");
      setCreateOpen(false);
      setNotice(data.restored ? "휴지통에 있던 프로젝트를 같은 site_id로 복구했습니다." : "프로젝트가 추가되었습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로젝트를 추가하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function mutateProject(action: string, extra: Record<string, unknown> = {}) {
    if (!selectedProject) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/pb/sites/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra })
      });
      await readJson(response);
      await refreshWorkspace(action === "trash" ? undefined : selectedProject.id);
      setNotice(action === "settings" ? "프로젝트 설정을 저장했습니다." : action === "trash" ? "프로젝트를 휴지통으로 이동했습니다." : "프로젝트를 업데이트했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "작업을 처리하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyHead() {
    if (!selectedProject) return;
    setVerifyLoading(true);
    try {
      const response = await fetch(`/api/pb/sites/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify_head" })
      });
      const data = await readJson(response);
      await refreshWorkspace(selectedProject.id);
      if (data.matched) {
        setVerifySuccess(true);
        setNotice(data.reason === "signal_verified" ? "실제 수집 신호가 확인되어 설치 완료로 처리했습니다." : "설치 코드가 실제로 확인되었습니다.");
      } else {
        setVerifySuccess(false);
        if (data.reason === "site_id_mismatch" && data.detectedSiteId) {
          setNotice(`HEAD 코드의 site_id가 현재 프로젝트와 다릅니다. 현재 프로젝트: ${data.expectedSiteId} / 감지된 값: ${data.detectedSiteId}`);
        } else if (data.reason === "site_id_missing") {
          setNotice("Pulseboard 스크립트는 보이지만 현재 프로젝트의 site_id가 아닙니다. HEAD 코드를 다시 붙여넣어 주세요.");
        } else {
          setNotice("아직 현재 프로젝트의 HEAD 설치 코드가 확인되지 않았습니다.");
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "설치 확인에 실패했습니다.");
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleTestView() {
    if (!selectedProject) return;
    setTestLoading(true);
    try {
      const response = await fetch(`/api/pb/sites/${selectedProject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_view" })
      });
      await readJson(response);
      await refreshWorkspace(selectedProject.id);
      setTestSuccess(true);
      setNotice("테스트 데이터가 반영되었습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "테스트 실행에 실패했습니다.");
    } finally {
      setTestLoading(false);
    }
  }

  async function handleRestoreProject(projectId: string) {
    setLoading(true);
    try {
      const response = await fetch(`/api/pb/sites/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore" })
      });
      await readJson(response);
      await refreshWorkspace(projectId);
      setNotice("프로젝트를 복구했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "프로젝트를 복구하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteProject(projectId: string) {
    setLoading(true);
    try {
      const response = await fetch(`/api/pb/sites/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_permanently" })
      });
      await readJson(response);
      await refreshWorkspace(selectedProject?.id === projectId ? undefined : selectedProject?.id);
      setNotice("휴지통 프로젝트를 영구 삭제했습니다.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "휴지통 프로젝트를 삭제하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function copyHeadCode() {
    if (!selectedProject) return;
    await navigator.clipboard.writeText(buildHeadCode(selectedProject));
    setCopySuccess(true);
    setNotice("HEAD 코드를 복사했습니다.");
  }

  /* 기간 선택기에서 [업데이트] 를 누르면 호출. 선택기는 서버가 모르는 기간(최근 14일 등)도
     다루므로, 서버가 아는 종류로 환산하고 나머지는 실제 날짜(CUSTOM)로 넘긴다. */
  async function applyRange(range: DateRange, presetKey: string) {
    const serverPreset = toServerPreset(presetKey) as RangePreset;
    setRangeLoading(true);
    try {
      setDateRange(range);
      setRangePreset(serverPreset);
      await refreshWorkspace(selectedProject?.id, range, serverPreset);
      const label = range.startDate === range.endDate ? range.startDate : `${range.startDate} ~ ${range.endDate}`;
      setNotice(`${label} 기준으로 데이터를 다시 불러왔습니다.`);
    } finally {
      setRangeLoading(false);
    }
  }

  const labels = selectedProject?.stats.dailyVisitorsTrend.map((item) => item.label) ?? [];
  const visitorValues = selectedProject?.stats.dailyVisitorsTrend.map((item) => item.visitors) ?? [];
  const pageViewValues = selectedProject?.stats.dailyVisitorsTrend.map((item) => item.pageViews) ?? [];
  const headCode = selectedProject ? buildHeadCode(selectedProject) : "";
  const topPagesRows = selectedProject?.stats.topPages.map((item) => ({
    title: item.title,
    subtitle: item.url,
    value: `${item.views.toLocaleString()}회`
  })) ?? [];
  const topActivityRows = selectedProject?.stats.topActivities.map((item) => ({
    title: item.label,
    subtitle: item.detail,
    value: `${item.count.toLocaleString()}회`
  })) ?? [];

  return (
    <main className="workspace-shell">
      <aside className="workspace-sidebar">
        <div className="workspace-sidebar-top">
          <div className="workspace-brand">
            {selectedProject?.logoUrl ? <img className="workspace-brand-logo" src={selectedProject.logoUrl} alt={selectedProject.domain} /> : <div className="workspace-brand-fallback">P</div>}
            <div>
              <strong>데이터 추적</strong>
              <p>{selectedProject?.domain || "프로젝트 없음"}</p>
            </div>
          </div>
          <button className="workspace-primary-button" onClick={() => setCreateOpen(true)}>+ 프로젝트 등록</button>
          <button className="workspace-secondary-button workspace-admin-button" onClick={() => setAdminOpen(true)}>관리자 설정</button>
          <div className="workspace-sidebar-group">
            <p className="workspace-sidebar-label">프로젝트</p>
            <div className="workspace-project-list">
              {workspace.projects.length ? workspace.projects.map((project) => (
                <button key={project.id} className={`workspace-project-item ${selectedProject?.id === project.id ? "active" : ""}`} onClick={() => setSelectedProjectId(project.id)}>
                  <span className="workspace-project-name">{project.name}</span>
                  <span className="workspace-project-domain">{project.domain}</span>
                </button>
              )) : <div className="workspace-empty-sidebar">등록된 프로젝트가 없습니다.</div>}
            </div>
          </div>
        </div>
      </aside>

      <section className="workspace-content">
        <header className="workspace-topbar">
          <div className="workspace-title-block">
            <p className="workspace-eyebrow">프로젝트 대시보드</p>
            <div className="workspace-title-row">
              <h1>{selectedProject?.name || "프로젝트를 추가해주세요"}</h1>
              {selectedProject ? (
                <>
                  <button className="workspace-secondary-button workspace-settings-trigger" onClick={() => setSettingsOpen(true)}>
                    프로젝트 설정
                  </button>
                  <a
                    className="workspace-secondary-button workspace-settings-trigger"
                    href={`/data-tracking/heatmap?project=${selectedProject.id}&start=${dateRange.startDate}&end=${dateRange.endDate}`}
                  >
                    UX HeatMap
                  </a>
                  <a
                    className="workspace-secondary-button workspace-settings-trigger"
                    href={`/data-tracking/heatmap?project=${selectedProject.id}&start=${dateRange.startDate}&end=${dateRange.endDate}&secret=create`}
                  >
                    비밀페이지 등록
                  </a>
                  <button className="workspace-chip-button" onClick={handleVerifyHead} disabled={verifyLoading}>
                    {verifyLoading ? <span className="workspace-spinner" /> : null}
                    {verifySuccess ? <span className="workspace-checkmark"><SuccessIcon /></span> : "설치 확인"}
                  </button>
                  <button className="workspace-chip-button" onClick={handleTestView} disabled={testLoading}>
                    {testLoading ? <span className="workspace-spinner" /> : null}
                    {testSuccess ? <span className="workspace-checkmark"><SuccessIcon /></span> : "테스트"}
                  </button>
                </>
              ) : null}
            </div>
            <p className="workspace-subtle">{selectedProject?.url || "왼쪽에서 프로젝트를 등록하면 이 영역에 데이터가 들어옵니다."}</p>
          </div>
        </header>

        {notice ? <div className="workspace-notice">{notice}</div> : null}

        {!selectedProject ? (
          <div className="workspace-blank-state">
            <h2>빈 작업 공간입니다.</h2>
            <p>프로젝트를 등록하면 날짜 기준 데이터와 설치 상태를 여기에서 관리할 수 있습니다.</p>
          </div>
        ) : (
          <>
            <section className="workspace-range-card">
              <div className="workspace-range-copy">
                <p className="workspace-eyebrow">날짜 범위</p>
                <h2>기준 기간을 바꾸면 전체 지표가 다시 계산됩니다.</h2>
                {rangeLoading ? (
                  <div className="workspace-range-loading">
                    <span>데이터를 다시 불러오는 중입니다.</span>
                    <div className="workspace-range-loading-bar" aria-hidden="true">
                      <div className="workspace-range-loading-fill" />
                    </div>
                  </div>
                ) : null}
              </div>
                <div className="workspace-range-controls">
                  {/* 광고 관리자와 같은 기간 선택기 — 자주 쓰는 기간 + 2개월 달력. */}
                  <DateRangePicker
                    startDate={dateRange.startDate}
                    endDate={dateRange.endDate}
                    disabled={rangeLoading || loading}
                    onApply={(range, presetKey) => void applyRange(range, presetKey)}
                  />
              </div>
            </section>

            <section className="workspace-stats-grid workspace-stats-grid-compact workspace-stats-grid-triple">
              <article className="workspace-stat-card">
                <span>평균 조회 페이지 수</span>
                <strong>{selectedProject.stats.averagePagesPerVisitor}</strong>
                <p>방문자 1명당 평균</p>
              </article>
              <article className="workspace-stat-card">
                <span>평균 체류시간</span>
                <strong>{selectedProject.stats.averageStaySeconds}초</strong>
                <p>page_leave 기준 평균</p>
              </article>
              <TopPagesCard items={selectedProject.stats.topPages} onMore={() => setPagesModalOpen(true)} />
            </section>

            <section className="workspace-chart-grid">
              <TrendChart title="들어온 인원 추이" total={selectedProject.stats.uniqueVisitors} accent="#0f9ec3" labels={labels} values={visitorValues} />
              <TrendChart title="페이지 뷰 추이" total={selectedProject.stats.pageViews} accent="#374151" labels={labels} values={pageViewValues} />
            </section>

            <section className="workspace-panels-grid workspace-panels-grid-quad">
              <TopActivitiesCard items={selectedProject.stats.topActivities} onMore={() => setActivitiesModalOpen(true)} />
              {selectedProject.stats.behaviorCards.map((item) => (
                <BehaviorSummaryCard key={item.label} item={item} />
              ))}
            </section>

            <section className="workspace-analytics-grid">
              <AnalyticsCard
                title="기기 통계"
                totalValue={selectedProject.stats.deviceSummary.reduce((sum, item) => sum + item.count, 0).toLocaleString()}
                totalLabel="건"
                items={selectedProject.stats.deviceSummary}
                labels={labels}
                chartSeries={[
                  { key: "phone", label: "폰", values: selectedProject.stats.deviceTrend.map((item) => item.phone), color: "#84c341", fill: "#84c34112" },
                  { key: "desktop", label: "데스크탑", values: selectedProject.stats.deviceTrend.map((item) => item.desktop), color: "#148cae", fill: "#148cae12" },
                  { key: "tablet", label: "태블릿", values: selectedProject.stats.deviceTrend.map((item) => item.tablet), color: "#f5c400", fill: "#f5c40010" }
                ]}
              />
              <AnalyticsCard
                title="방문 유형 통계"
                totalValue={selectedProject.stats.visitTypeSummary.reduce((sum, item) => sum + item.count, 0).toLocaleString()}
                totalLabel="건"
                items={selectedProject.stats.visitTypeSummary}
                labels={labels}
                chartSeries={[
                  { key: "new", label: "신규", values: selectedProject.stats.visitTypeTrend.map((item) => item.newVisits), color: "#20a9f5", fill: "#20a9f518" },
                  { key: "returning", label: "재방문", values: selectedProject.stats.visitTypeTrend.map((item) => item.returningVisits), color: "#174b93", fill: "#174b9314" }
                ]}
              />
            </section>

            <ReferrerAnalytics
              items={selectedProject.stats.referrerSummary}
              labels={labels}
              topLabel={selectedProject.stats.topReferrerLabel}
              trend={selectedProject.stats.referrerTrend}
              trendSeries={selectedProject.stats.referrerTrendSeries}
            />
          </>
        )}
      </section>

      {createOpen ? (
        <div className="workspace-modal-backdrop" onClick={() => setCreateOpen(false)}>
          <div className="workspace-modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>프로젝트 등록</h2>
            <p>사이트 URL만 입력하면 프로젝트가 생성되고, 사이드바에 바로 추가됩니다.</p>
            <label className="workspace-field">
              <span>사이트 URL</span>
              <input placeholder="https://example.com" value={createUrl} onChange={(event) => setCreateUrl(event.target.value)} />
            </label>
            <div className="workspace-modal-actions">
              <button className="workspace-secondary-button" onClick={() => setCreateOpen(false)}>닫기</button>
              <button className="workspace-primary-button" disabled={loading} onClick={handleCreateProject}>저장</button>
            </div>
          </div>
        </div>
      ) : null}

      {settingsOpen && selectedProject ? (
        <div className="workspace-modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div className="workspace-modal-card workspace-modal-wide" onClick={(event) => event.stopPropagation()}>
            <div className="workspace-settings-header">
              <div>
                <p className="workspace-eyebrow">프로젝트 설정</p>
                <h2>{selectedProject.domain}</h2>
              </div>
              <div className="workspace-status-row">
                <span className={`workspace-badge ${selectedProject.trackingVerified ? "ok" : "warn"}`}>
                  {selectedProject.trackingVerified ? "HEAD 설치 확인됨" : "HEAD 설치 대기"}
                </span>
                <span className="workspace-muted-label">최근 확인 {formatDateTime(selectedProject.trackingCheckedAt)}</span>
              </div>
            </div>
            <div className="workspace-settings-grid">
              <label className="workspace-field">
                <span>프로젝트 이름</span>
                <input value={settingsName} onChange={(event) => setSettingsName(event.target.value)} />
              </label>
              <div className="workspace-field workspace-field-wide">
                <div className="workspace-inline-label">
                  <span>프로젝트 식별자</span>
                </div>
                <input value={selectedProject.id} readOnly />
              </div>
              <div className="workspace-field workspace-field-wide">
                <div className="workspace-inline-label">
                  <span>HEAD 삽입 코드</span>
                  <button className="workspace-icon-button" onClick={copyHeadCode} aria-label="HEAD 코드 복사">
                    {copySuccess ? <SuccessIcon /> : <CopyIcon />}
                  </button>
                </div>
                <textarea value={headCode} readOnly />
              </div>
            </div>
            <div className="workspace-modal-actions">
              <button className="workspace-secondary-button" onClick={() => setSettingsOpen(false)}>닫기</button>
              <button className="workspace-primary-button" onClick={async () => { await mutateProject("settings", { name: settingsName, url: selectedProject.url }); setSettingsOpen(false); }}>저장</button>
            </div>
          </div>
        </div>
      ) : null}

      {adminOpen ? (
        <div className="workspace-modal-backdrop" onClick={() => setAdminOpen(false)}>
          <div className="workspace-modal-card workspace-modal-wide" onClick={(event) => event.stopPropagation()}>
            <h2>관리자 설정</h2>
            <p>휴지통으로 보낸 프로젝트를 복구하거나 현재 프로젝트를 휴지통으로 이동할 수 있습니다.</p>
            {selectedProject ? <div className="workspace-admin-danger"><button className="workspace-chip-button danger" onClick={() => mutateProject("trash")}>현재 프로젝트 휴지통 이동</button></div> : null}
            <div className="workspace-trash-list">
              {workspace.trashedProjects.length ? workspace.trashedProjects.map((project) => (
                <div key={project.id} className="workspace-trash-row">
                  <div>
                    <strong>{project.name}</strong>
                    <p>{project.url}</p>
                  </div>
                  <div className="workspace-trash-actions">
                    <button className="workspace-primary-button" onClick={() => handleRestoreProject(project.id)}>복구</button>
                    <button className="workspace-chip-button danger" onClick={() => handleDeleteProject(project.id)}>삭제</button>
                  </div>
                </div>
              )) : <p className="workspace-subtle">휴지통에 있는 프로젝트가 없습니다.</p>}
            </div>
            <div className="workspace-modal-actions">
              <button className="workspace-secondary-button" onClick={() => setAdminOpen(false)}>닫기</button>
            </div>
          </div>
        </div>
      ) : null}

      <DetailListModal
        open={pagesModalOpen}
        title="많이 방문한 페이지"
        subtitle="선택한 날짜 범위 기준으로 페이지 조회가 많은 순서입니다."
        rows={topPagesRows}
        onClose={() => setPagesModalOpen(false)}
      />

      <DetailListModal
        open={activitiesModalOpen}
        title="자주 하는 활동"
        subtitle="선택한 날짜 범위 기준으로 사용자가 많이 수행한 행동입니다."
        rows={topActivityRows}
        onClose={() => setActivitiesModalOpen(false)}
      />
    </main>
  );
}



