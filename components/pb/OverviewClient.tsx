"use client";

/* 데이터 추적 '전체 대시보드' — 모든 브랜드의 현황을 한 화면에(기본 최근 7일, 기간 지정 가능).
   ⚡ 렉 제거: 결과를 모듈 메모리에 캐시 — 프로젝트를 오가다 다시 들어와도 로딩 없이 즉시 뜨고,
      뒤에서 조용히 최신값으로 갱신한다(서버도 기간별 5분 캐시라 재집계가 드물다).
   📅 기간: 프로젝트 대시보드와 같은 선택기(오늘/최근 7·14·30일/이번 달/직접 지정) — 비교는 항상 '직전 같은 길이 구간'.
   🖱 호버: 숫자 셀 = 이전 기간 수치·증감 툴팁, 추이 = 일별(장기간은 라인) 차트 + 피크 팝오버.
   📋 AI 주간 리포트: 매주 월요일 아침 크론이 자동 작성 — 사람이 누를 버튼은 없다. */

import { useEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import type { OverviewData, OverviewSite } from "@/lib/pb/overview-data";
import { DateRangePicker, type DateRange } from "@/components/pb/DateRangePicker";

// 리포트 저장 시점의 집계 스냅샷(stats jsonb) — 브랜드별 수치를 화면에서 표·미니차트로 붙인다.
type ReportStats = {
  전체?: { visitors: number; pageViews: number; avgStaySeconds: number; prevVisitors: number; prevPageViews: number; prevAvgStaySeconds: number };
  브랜드별?: { 이름: string; 방문자: number; 지난주방문자: number; 페이지뷰: number; 지난주페이지뷰: number; 평균체류초: number; 지난주평균체류초: number; 이탈률: number }[];
};
type Report = { week_key: string; content: string; created_at: string; stats?: ReportStats | null };

// AI 가 내는 구조화 리포트(JSON). 옛 리포트(마크다운)는 파싱 실패 → 폴백 렌더.
type SReport = {
  headline: string;
  overview?: string;
  brands: { name: string; status?: string; diag?: string; flag?: string }[];
  internal?: string[];
  macro?: { point: string; source?: string; url?: string }[];
  actions?: { brand?: string; todo: string; why?: string }[];
};

function parseStructured(content: string): SReport | null {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]) as SReport;
    if (!j || typeof j.headline !== "string" || !Array.isArray(j.brands)) return null;
    return j;
  } catch {
    return null;
  }
}

const STATUS_META: Record<string, { dot: string; label: string; bg: string; fg: string }> = {
  good: { dot: "#10b981", label: "양호", bg: "rgba(16,185,129,0.1)", fg: "#059669" },
  watch: { dot: "#f59e0b", label: "관찰", bg: "rgba(245,158,11,0.12)", fg: "#b45309" },
  bad: { dot: "#ef4444", label: "주의", bg: "rgba(239,68,68,0.1)", fg: "#dc2626" },
};

// 이번(위) vs 이전(아래) 미니 이중 막대 — 크기 비교가 눈에 바로 들어오게.
function DuoBar({ cur, prev, width = 72 }: { cur: number; prev: number; width?: number | string }) {
  const max = Math.max(cur, prev, 1);
  return (
    <div style={{ display: "grid", gap: 2, width }}>
      <div style={{ height: 5, borderRadius: 3, width: `${Math.max(4, Math.round((cur / max) * 100))}%`, background: "#0f9ec3" }} />
      <div style={{ height: 5, borderRadius: 3, width: `${Math.max(4, Math.round((prev / max) * 100))}%`, background: "#cbd5e1" }} />
    </div>
  );
}

// 모듈 메모리 캐시 — SPA 이동 중에는 살아있어 재진입이 즉시다(새로고침 시에만 초기화).
let memOverview: OverviewData | null = null;
let memRange: DateRange | null = null; // null = 기본(최근 7일)
let memReport: Report | null = null;
let memReportMissing = false;

const DAY_MS = 24 * 60 * 60 * 1000;
const kstTodayYmd = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addD = (s: string, n: number) => new Date(Date.parse(`${s}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function pctBadge(cur: number, prev: number) {
  if (!prev) return { text: cur > 0 ? "NEW" : "—", color: cur > 0 ? "#0f9ec3" : "#9aa4b2" };
  const d = Math.round(((cur - prev) / prev) * 100);
  if (d > 0) return { text: `▲ ${d}%`, color: "#0f9ec3" };
  if (d < 0) return { text: `▼ ${Math.abs(d)}%`, color: "#ff5b1a" };
  return { text: "0%", color: "#9aa4b2" };
}

function Spark({ values }: { values: number[] }) {
  const w = 96;
  const h = 26;
  const max = Math.max(...values, 1);
  const pts = values
    .map((v, i) => `${((i / Math.max(values.length - 1, 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#0f9ec3" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/* (폴백용) 리포트 마크다운 → HTML — 옛 포맷 리포트를 위해 표·구분선·코드까지 처리. XSS 방지로 먼저 이스케이프. */
function mdToHtml(md: string): string {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, '<code style="background:rgba(15,23,42,0.06);border-radius:4px;padding:1px 5px;font-size:12px">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0f9ec3;text-decoration:underline">$1</a>');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    const isLi = /^\s*[-*•]\s+/.test(line);
    if (inList && !isLi) { out.push("</ul>"); inList = false; }
    if (!line.trim()) continue;
    // 구분선(---) → hr
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr style="border:none;border-top:1px solid rgba(15,23,42,0.08);margin:14px 0">');
      continue;
    }
    // 마크다운 표(| a | b |) → 진짜 표로
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i].trimEnd())) {
        const cells = lines[i].trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells); // 구분행(---)은 버림
        i++;
      }
      i--;
      if (rows.length) {
        const [head, ...body] = rows;
        out.push('<div style="overflow-x:auto;margin:10px 0"><table style="width:100%;border-collapse:collapse;font-size:12.5px">');
        out.push("<thead><tr>" + head.map((c) => `<th style="text-align:left;padding:7px 9px;border-bottom:1px solid rgba(15,23,42,0.12);color:#6b7686;font-weight:600;white-space:nowrap">${inline(c)}</th>`).join("") + "</tr></thead>");
        out.push("<tbody>" + body.map((r) => "<tr>" + r.map((c) => `<td style="padding:7px 9px;border-bottom:1px solid rgba(15,23,42,0.05);line-height:1.55">${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table></div>");
      }
      continue;
    }
    if (/^###\s+/.test(line)) out.push(`<h4 style="margin:14px 0 6px;font-size:13px;font-weight:700">${inline(line.replace(/^###\s+/, ""))}</h4>`);
    else if (/^##\s+/.test(line)) out.push(`<h3 style="margin:18px 0 8px;font-size:14px;font-weight:800">${inline(line.replace(/^##\s+/, ""))}</h3>`);
    else if (/^#\s+/.test(line)) out.push(`<h3 style="margin:18px 0 8px;font-size:15px;font-weight:800">${inline(line.replace(/^#\s+/, ""))}</h3>`);
    else if (isLi) {
      if (!inList) { out.push('<ul style="margin:4px 0 8px;padding-left:18px;list-style:disc">'); inList = true; }
      out.push(`<li style="margin:3px 0;line-height:1.6">${inline(line.replace(/^\s*[-*•]\s+/, ""))}</li>`);
    } else out.push(`<p style="margin:6px 0;line-height:1.7">${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("");
}

/* 호버 툴팁(고정 위치) — 표가 가로 스크롤 컨테이너 안이라 absolute 는 잘리기 때문에 fixed 로 띄운다. */
type TipState = { x: number; y: number; node: ReactNode } | null;

function numTipNode(label: string, curText: string, prevText: string, curN: number, prevN: number) {
  const d = curN - prevN;
  const pct = prevN ? Math.round((d / prevN) * 100) : null;
  return (
    <div>
      <div style={{ fontWeight: 800, marginBottom: 5 }}>{label}</div>
      <div>이번 기간 <b>{curText}</b></div>
      <div style={{ color: "#9ca3af" }}>이전 기간 {prevText}</div>
      <div style={{ marginTop: 5, fontWeight: 700, color: d > 0 ? "#38bdf8" : d < 0 ? "#fb923c" : "#9ca3af" }}>
        {d > 0 ? "▲" : d < 0 ? "▼" : "—"} {Math.abs(d).toLocaleString()}
        {pct !== null ? ` (${pct > 0 ? "+" : ""}${pct}%)` : curN > 0 ? " (이전 기간 0 → NEW)" : ""}
      </div>
    </div>
  );
}

function sparkTipNode(s: OverviewSite) {
  const n = s.spark.length;
  const max = Math.max(...s.spark, 1);
  const total = s.spark.reduce((a, b) => a + b, 0);
  const peakIdx = s.spark.indexOf(Math.max(...s.spark));

  // 포인트가 많으면(장기간·시간단위) 막대 대신 라인 차트 + 요약으로.
  if (n > 16) {
    const w = 300;
    const h = 70;
    const pts = s.spark
      .map((v, i) => `${((i / Math.max(n - 1, 1)) * w).toFixed(1)},${(h - (v / max) * (h - 8) - 4).toFixed(1)}`)
      .join(" ");
    const px = (peakIdx / Math.max(n - 1, 1)) * w;
    const py = h - (s.spark[peakIdx] / max) * (h - 8) - 4;
    return (
      <div style={{ width: w }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>{s.name} · 기간 내 방문자</div>
        <svg width={w} height={h}>
          <polyline points={pts} fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          {total > 0 ? <circle cx={px} cy={py} r={3.5} fill="#38bdf8" /> : null}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#9ca3af", marginTop: 2 }}>
          <span>{s.sparkLabels[0]}</span>
          <span>{s.sparkLabels[n - 1]}</span>
        </div>
        <div style={{ marginTop: 7, fontSize: 11, color: "#d1d5db" }}>
          {total > 0
            ? <>🔥 피크 <b style={{ color: "#38bdf8" }}>{s.sparkLabels[peakIdx]}</b> · {s.spark[peakIdx].toLocaleString()}명 · 합 {total.toLocaleString()}명 · 평균 {Math.round(total / n).toLocaleString()}명</>
            : "이 기간 방문 기록이 없어요"}
        </div>
      </div>
    );
  }

  const showAllValues = n <= 10;
  return (
    <div style={{ width: Math.max(252, n * 34) }}>
      <div style={{ fontWeight: 800, marginBottom: 8 }}>{s.name} · 일별 방문자</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 78 }}>
        {s.spark.map((v, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: i === peakIdx && total > 0 ? 800 : 500, color: i === peakIdx && total > 0 ? "#38bdf8" : "#d1d5db", visibility: showAllValues || i === peakIdx ? "visible" : "hidden" }}>{v}</div>
            <div style={{ height: Math.max(4, Math.round((v / max) * 52)), background: i === peakIdx && total > 0 ? "#38bdf8" : "#4b5563", borderRadius: 3, marginTop: 2 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 3 }}>
        {s.sparkLabels.map((l, i) => (
          <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 9, color: i === peakIdx && total > 0 ? "#38bdf8" : "#9ca3af" }}>{l}</div>
        ))}
      </div>
      <div style={{ marginTop: 7, fontSize: 11, color: "#d1d5db" }}>
        {total > 0 ? <>🔥 피크 <b style={{ color: "#38bdf8" }}>{s.sparkLabels[peakIdx]}</b> · {s.spark[peakIdx]}명 &nbsp;·&nbsp; 기간 합 {total.toLocaleString()}명</> : "이 기간 방문 기록이 없어요"}
      </div>
    </div>
  );
}

/* 주간 리포트 인포그래픽 뷰 — AI 의 구조화 JSON + 저장된 수치(stats)를 합쳐
   헤드라인/요약 칩/브랜드 표(상태등·증감·미니막대)/원인 2단/액션 카드로 그린다.
   옛 마크다운 리포트는 mdToHtml 폴백. */
function ReportView({ report }: { report: Report }) {
  const s = parseStructured(report.content);
  if (!s) return <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: mdToHtml(report.content) }} />;

  const tot = report.stats?.전체;
  const brandStats = new Map((report.stats?.브랜드별 ?? []).map((b) => [b.이름, b]));
  const box: CSSProperties = { border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: "12px 14px" };
  const eyebrow: CSSProperties = { fontSize: 11, fontWeight: 800, color: "#6b7686", letterSpacing: 0.4, margin: "16px 0 8px" };
  const smallDelta = (cur: number, prev: number) => {
    const b = pctBadge(cur, prev);
    return <span style={{ color: b.color, fontSize: 10.5, fontWeight: 700 }}>{b.text}</span>;
  };

  return (
    <div style={{ fontSize: 13 }}>
      {/* 헤드라인 */}
      <div style={{ marginTop: 4, background: "linear-gradient(135deg, rgba(15,158,195,0.09), rgba(15,158,195,0.02))", border: "1px solid rgba(15,158,195,0.22)", borderRadius: 12, padding: "12px 14px", fontWeight: 800, fontSize: 14, lineHeight: 1.5 }}>
        📊 {s.headline}
      </div>
      {s.overview ? <p style={{ margin: "10px 2px 0", lineHeight: 1.75, color: "#374151" }}>{s.overview}</p> : null}

      {/* 전체 요약 칩(이번 vs 지난 이중 막대) */}
      {tot ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10, marginTop: 12 }}>
          {[
            { label: "방문자", cur: tot.visitors, prev: tot.prevVisitors, unit: "명" },
            { label: "페이지 뷰", cur: tot.pageViews, prev: tot.prevPageViews, unit: "회" },
            { label: "평균 체류", cur: tot.avgStaySeconds, prev: tot.prevAvgStaySeconds, unit: "초" },
          ].map((c) => (
            <div key={c.label} style={box}>
              <div style={{ fontSize: 11, color: "#6b7686" }}>{c.label}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <b style={{ fontSize: 18 }}>{c.cur.toLocaleString()}{c.unit}</b>
                {smallDelta(c.cur, c.prev)}
              </div>
              <div style={{ fontSize: 10.5, color: "#9aa4b2", marginTop: 1 }}>지난주 {c.prev.toLocaleString()}{c.unit}</div>
              <div style={{ marginTop: 7 }}><DuoBar cur={c.cur} prev={c.prev} width="100%" /></div>
            </div>
          ))}
        </div>
      ) : null}

      {/* 브랜드별 진단 표 */}
      <div style={eyebrow}>브랜드별 진단 <span style={{ fontWeight: 500, color: "#9aa4b2" }}>· 막대: <span style={{ color: "#0f9ec3" }}>■ 이번 주</span> <span style={{ color: "#94a3b8" }}>■ 지난주</span></span></div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#6b7686" }}>
              {["브랜드", "상태", "방문자", "페이지 뷰", "체류", "진단"].map((h) => (
                <th key={h} style={{ padding: "7px 9px", borderBottom: "1px solid rgba(15,23,42,0.1)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.brands.map((b) => {
              const st = STATUS_META[b.status ?? ""] ?? STATUS_META.watch;
              const bs = brandStats.get(b.name);
              return (
                <tr key={b.name} style={{ borderBottom: "1px solid rgba(15,23,42,0.05)", verticalAlign: "top" }}>
                  <td style={{ padding: "9px", fontWeight: 700, whiteSpace: "nowrap" }}>{b.name}</td>
                  <td style={{ padding: "9px", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: st.bg, color: st.fg, borderRadius: 999, padding: "3px 9px", fontSize: 11, fontWeight: 700 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 99, background: st.dot }} /> {st.label}
                    </span>
                  </td>
                  <td style={{ padding: "9px", whiteSpace: "nowrap" }}>
                    {bs ? (
                      <div style={{ display: "grid", gap: 3 }}>
                        <div><b>{bs.방문자.toLocaleString()}</b> {smallDelta(bs.방문자, bs.지난주방문자)}</div>
                        <DuoBar cur={bs.방문자} prev={bs.지난주방문자} />
                      </div>
                    ) : "—"}
                  </td>
                  <td style={{ padding: "9px", whiteSpace: "nowrap" }}>
                    {bs ? <>{bs.페이지뷰.toLocaleString()} {smallDelta(bs.페이지뷰, bs.지난주페이지뷰)}</> : "—"}
                  </td>
                  <td style={{ padding: "9px", whiteSpace: "nowrap" }}>
                    {bs ? <>{bs.평균체류초}초 {smallDelta(bs.평균체류초, bs.지난주평균체류초)}</> : "—"}
                  </td>
                  <td style={{ padding: "9px", minWidth: 200, lineHeight: 1.55 }}>
                    {b.diag}
                    {b.flag ? <span style={{ marginLeft: 6, background: "rgba(239,68,68,0.09)", color: "#dc2626", borderRadius: 6, padding: "1px 7px", fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>{b.flag}</span> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 원인 2단: 내부 vs 거시·뉴스 */}
      {(s.internal?.length || s.macro?.length) ? (
        <>
          <div style={eyebrow}>왜 이런 흐름인가</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {s.internal?.length ? (
              <div style={box}>
                <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>🔍 내부 요인 (우리 데이터)</div>
                <ul style={{ paddingLeft: 16, display: "grid", gap: 5 }}>
                  {s.internal.map((t, i) => <li key={i} style={{ lineHeight: 1.6, listStyle: "disc" }}>{t}</li>)}
                </ul>
              </div>
            ) : null}
            {s.macro?.length ? (
              <div style={box}>
                <div style={{ fontWeight: 800, fontSize: 12.5, marginBottom: 6 }}>🌏 거시 요인 (시장·뉴스)</div>
                <ul style={{ paddingLeft: 16, display: "grid", gap: 5 }}>
                  {s.macro.map((m, i) => (
                    <li key={i} style={{ lineHeight: 1.6, listStyle: "disc" }}>
                      {m.point}
                      {m.source ? (
                        m.url ? (
                          <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 6, color: "#0f9ec3", fontSize: 11, textDecoration: "underline", whiteSpace: "nowrap" }}>{m.source} ↗</a>
                        ) : (
                          <span style={{ marginLeft: 6, color: "#9aa4b2", fontSize: 11 }}>{m.source}</span>
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {/* 다음 주 액션 카드 */}
      {s.actions?.length ? (
        <>
          <div style={eyebrow}>다음 주 액션</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {s.actions.map((a, i) => (
              <div key={i} style={{ border: "1px solid rgba(15,158,195,0.25)", background: "rgba(15,158,195,0.04)", borderRadius: 12, padding: "11px 13px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "#0f9ec3", letterSpacing: 0.5 }}>ACTION {i + 1}{a.brand ? ` · ${a.brand}` : ""}</div>
                <div style={{ fontWeight: 700, marginTop: 4, lineHeight: 1.5 }}>{a.todo}</div>
                {a.why ? <div style={{ fontSize: 11.5, color: "#6b7686", marginTop: 3 }}>{a.why}</div> : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function OverviewClient({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(memOverview);
  const [dateRange, setDateRange] = useState<DateRange | null>(memRange);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [report, setReport] = useState<Report | null>(memReport);
  const [reportMissing, setReportMissing] = useState(memReportMissing);
  const [tip, setTip] = useState<TipState>(null);

  function overviewUrl(range: DateRange | null) {
    return range ? `/api/pb/overview?start=${range.startDate}&end=${range.endDate}` : "/api/pb/overview";
  }

  // 캐시가 있으면 즉시 그리고, 뒤에서 조용히 최신값으로 바꾼다(로딩 화면 없음).
  useEffect(() => {
    fetch(overviewUrl(memRange), { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "전체 현황을 불러오지 못했어요.");
        memOverview = j as OverviewData;
        setData(memOverview);
      })
      .catch((e) => { if (!memOverview) setLoadErr(e instanceof Error ? e.message : "불러오기 실패"); });
    fetch("/api/pb/weekly-report", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        memReport = (j?.report as Report) ?? null;
        memReportMissing = !!j?.tableMissing;
        setReport(memReport);
        setReportMissing(memReportMissing);
      })
      .catch(() => {});
  }, []);

  // 기간 적용 — 표는 그대로 두고 위에 로딩 표시만(화면 덜컹임 없음). 같은 기간 재선택은 서버 캐시라 즉시.
  async function applyRange(range: DateRange) {
    setRangeLoading(true);
    setLoadErr("");
    try {
      const r = await fetch(overviewUrl(range), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "기간 데이터를 불러오지 못했어요.");
      memOverview = j as OverviewData;
      memRange = range;
      setData(memOverview);
      setDateRange(range);
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : "기간 변경 실패");
    } finally {
      setRangeLoading(false);
    }
  }

  function showTip(e: ReactMouseEvent<HTMLElement>, node: ReactNode) {
    const r = e.currentTarget.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, node });
  }
  const hideTip = () => setTip(null);

  const cardStyle: CSSProperties = {
    background: "var(--pb-card, #fff)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 16,
    padding: 18,
  };
  const tipCell: CSSProperties = { padding: "10px", whiteSpace: "nowrap", cursor: "default" };

  const pickerStart = dateRange?.startDate ?? data?.range.start ?? addD(kstTodayYmd(), -6);
  const pickerEnd = dateRange?.endDate ?? data?.range.end ?? kstTodayYmd();

  return (
    <>
      <header className="workspace-topbar">
        <div className="workspace-title-block">
          <p className="workspace-eyebrow">전체 대시보드</p>
          <div className="workspace-title-row">
            <h1>전 브랜드 현황</h1>
            <a className="workspace-secondary-button workspace-settings-trigger" href="/data-tracking/replays">
              세션 리플레이
            </a>
            {/* 프로젝트 대시보드와 같은 기간 선택기 — 기본 최근 7일, 자유 지정 가능 */}
            <DateRangePicker startDate={pickerStart} endDate={pickerEnd} disabled={rangeLoading} onApply={(r) => void applyRange(r)} />
          </div>
          <p className="workspace-subtle">
            {data
              ? `${data.range.start} ~ ${data.range.end} · 이전 기간(${data.range.prevStart} ~ ${data.range.prevEnd}) 대비${rangeLoading ? " · 계산 중…" : ""}`
              : "최근 7일 · 이전 7일 대비"}
          </p>
        </div>
      </header>

      {loadErr ? <div className="workspace-notice">{loadErr}</div> : null}

      {!data ? (
        <div className="workspace-blank-state">
          <h2>전체 현황을 계산하는 중…</h2>
          <p>브랜드별 데이터를 모으고 있어요. (한 번 열리면 다음부터는 즉시 떠요)</p>
        </div>
      ) : (
        <>
          {/* 전체 합계 — 호버 시 이전 기간 수치 */}
          <section className="workspace-stats-grid workspace-stats-grid-compact workspace-stats-grid-triple" style={rangeLoading ? { opacity: 0.6 } : undefined}>
            {[
              { label: "기간 내 방문자", value: data.totals.visitors.toLocaleString(), cur: data.totals.visitors, prev: data.totals.prevVisitors, prevText: `${data.totals.prevVisitors.toLocaleString()}명` },
              { label: "기간 내 페이지 뷰", value: data.totals.pageViews.toLocaleString(), cur: data.totals.pageViews, prev: data.totals.prevPageViews, prevText: `${data.totals.prevPageViews.toLocaleString()}회` },
              { label: "평균 체류시간", value: `${data.totals.avgStaySeconds}초`, cur: data.totals.avgStaySeconds, prev: data.totals.prevAvgStaySeconds, prevText: `${data.totals.prevAvgStaySeconds}초` },
            ].map((c) => {
              const b = pctBadge(c.cur, c.prev);
              return (
                <article
                  key={c.label}
                  className="workspace-stat-card"
                  onMouseEnter={(e) => showTip(e, numTipNode(c.label, c.value, c.prevText, c.cur, c.prev))}
                  onMouseLeave={hideTip}
                >
                  <span>{c.label}</span>
                  <strong>{c.value}</strong>
                  <p style={{ color: b.color, fontWeight: 700 }}>{b.text} <span style={{ color: "#9aa4b2", fontWeight: 500 }}>이전 기간 대비</span></p>
                </article>
              );
            })}
          </section>

          {/* 브랜드별 표 — 숫자 호버=이전 기간 비교, 추이 호버=일별 차트+피크 */}
          <section style={{ ...cardStyle, marginTop: 16, ...(rangeLoading ? { opacity: 0.6 } : {}) }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800 }}>브랜드별 현황</h2>
              <span style={{ fontSize: 12, color: "#9aa4b2" }}>숫자에 마우스를 올리면 이전 기간 비교 · 행 클릭 시 브랜드 대시보드</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6b7686" }}>
                    {["브랜드", "방문자", "페이지 뷰", "평균 체류", "이탈률", "추이", "많이 본 페이지"].map((h) => (
                      <th key={h} style={{ padding: "8px 10px", borderBottom: "1px solid rgba(15,23,42,0.08)", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sites.map((s) => {
                    const v = pctBadge(s.visitors, s.prev.visitors);
                    const p = pctBadge(s.pageViews, s.prev.pageViews);
                    const st = pctBadge(s.avgStaySeconds, s.prev.avgStaySeconds);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => onOpenProject(s.id)}
                        style={{ cursor: "pointer", borderBottom: "1px solid rgba(15,23,42,0.05)" }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(15,158,195,0.05)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "10px", fontWeight: 700, whiteSpace: "nowrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            {s.logoUrl ? <img src={s.logoUrl} alt="" width={18} height={18} style={{ borderRadius: 4 }} /> : null}
                            <span>{s.name}</span>
                          </div>
                        </td>
                        <td style={tipCell} onMouseEnter={(e) => showTip(e, numTipNode("방문자", `${s.visitors.toLocaleString()}명`, `${s.prev.visitors.toLocaleString()}명`, s.visitors, s.prev.visitors))} onMouseLeave={hideTip}>
                          <strong>{s.visitors.toLocaleString()}</strong>{" "}
                          <span style={{ color: v.color, fontSize: 11, fontWeight: 700 }}>{v.text}</span>
                        </td>
                        <td style={tipCell} onMouseEnter={(e) => showTip(e, numTipNode("페이지 뷰", `${s.pageViews.toLocaleString()}회`, `${s.prev.pageViews.toLocaleString()}회`, s.pageViews, s.prev.pageViews))} onMouseLeave={hideTip}>
                          {s.pageViews.toLocaleString()}{" "}
                          <span style={{ color: p.color, fontSize: 11, fontWeight: 700 }}>{p.text}</span>
                        </td>
                        <td style={tipCell} onMouseEnter={(e) => showTip(e, numTipNode("평균 체류시간", `${s.avgStaySeconds}초`, `${s.prev.avgStaySeconds}초`, s.avgStaySeconds, s.prev.avgStaySeconds))} onMouseLeave={hideTip}>
                          {s.avgStaySeconds}초{" "}
                          <span style={{ color: st.color, fontSize: 11, fontWeight: 700 }}>{st.text}</span>
                        </td>
                        <td style={tipCell} onMouseEnter={(e) => showTip(e, numTipNode("이탈률", `${s.bounceRate}%`, `${s.prev.bounceRate}%`, s.bounceRate, s.prev.bounceRate))} onMouseLeave={hideTip}>
                          {s.bounceRate}%
                        </td>
                        <td style={{ padding: "6px 10px", cursor: "default" }} onMouseEnter={(e) => showTip(e, sparkTipNode(s))} onMouseLeave={hideTip}>
                          <Spark values={s.spark} />
                        </td>
                        <td style={{ padding: "10px", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6b7686" }}>
                          {s.topPages.map((tp) => tp.url).join(" · ") || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* AI 주간 진단 리포트 — 매주 월요일 아침 자동 생성(버튼 없음) */}
          <section style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800 }}>AI 주간 진단 리포트</h2>
                <p style={{ fontSize: 12, color: "#6b7686", marginTop: 2 }}>
                  매주 월요일 아침, 지난주(월~일) 데이터 + 계절·소비심리·경기 + 최신 뉴스(웹 검색)를 조합해 자동 작성돼요.
                </p>
              </div>
              <span style={{ fontSize: 11, color: "#9aa4b2", border: "1px solid rgba(15,23,42,0.1)", borderRadius: 999, padding: "4px 10px" }}>⏰ 매주 월요일 07:30 자동</span>
            </div>
            {report ? (
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(15,23,42,0.08)", paddingTop: 8 }}>
                <p style={{ fontSize: 11, color: "#9aa4b2", marginBottom: 6 }}>
                  {report.week_key} 마감 주 기준 · {new Date(report.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 생성
                </p>
                <ReportView report={report} />
              </div>
            ) : (
              <p style={{ marginTop: 12, fontSize: 13, color: "#9aa4b2" }}>
                {reportMissing
                  ? "리포트 저장 테이블이 아직 없어요 — Supabase 에서 db/pb-replays.sql 을 실행해 두면 다음 월요일부터 자동으로 쌓입니다."
                  : "아직 생성된 리포트가 없어요. 다음 월요일 아침에 첫 리포트가 자동으로 작성돼요."}
              </p>
            )}
          </section>
        </>
      )}

      {/* 고정 위치 툴팁(표의 overflow 에 안 잘리게 fixed) */}
      {tip ? (
        <div
          style={{
            position: "fixed",
            left: Math.min(Math.max(tip.x, 165), (typeof window !== "undefined" ? window.innerWidth : 1200) - 165),
            top: tip.y - 10,
            transform: "translate(-50%, -100%)",
            zIndex: 70,
            pointerEvents: "none",
          }}
        >
          <div style={{ background: "#111827", color: "#fff", borderRadius: 12, padding: "10px 13px", fontSize: 12, lineHeight: 1.55, boxShadow: "0 10px 30px rgba(0,0,0,0.3)", minWidth: 150 }}>
            {tip.node}
          </div>
        </div>
      ) : null}
    </>
  );
}
