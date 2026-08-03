"use client";

/* 데이터 추적 '전체 대시보드' — 모든 브랜드의 최근 7일 현황(vs 이전 7일)을 한 화면에.
   + AI 주간 진단 리포트: 내부 데이터 + 거시 흐름(계절·소비심리·경기) + 최신 뉴스(웹 검색) 조합 진단.
   리포트 생성은 사용자 본인 Anthropic 키(aiFetch)를 쓴다 — 기존 AI 기능들과 동일. */

import { useEffect, useState, type CSSProperties } from "react";
import { aiFetch } from "@/lib/ai-fetch";
import type { OverviewData } from "@/lib/pb/overview-data";

type Report = { week_key: string; content: string; created_at: string };

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

/* 리포트(마크다운)를 가볍게 HTML 로 — 외부 라이브러리 없이 ##/**/-/링크만 처리. XSS 방지로 먼저 이스케이프. */
function mdToHtml(md: string): string {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const inline = (s: string) =>
    s
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#0f9ec3;text-decoration:underline">$1</a>');
  for (const raw of lines) {
    const line = raw.trimEnd();
    const isLi = /^\s*[-*•]\s+/.test(line);
    if (inList && !isLi) { out.push("</ul>"); inList = false; }
    if (!line.trim()) continue;
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

export function OverviewClient({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [reportNote, setReportNote] = useState("");

  useEffect(() => {
    fetch("/api/pb/overview", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "전체 현황을 불러오지 못했어요.");
        setData(j as OverviewData);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "불러오기 실패"));
    fetch("/api/pb/weekly-report", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (j?.report) setReport(j.report as Report);
      })
      .catch(() => {});
  }, []);

  async function generateReport() {
    setGenBusy(true);
    setReportNote("");
    try {
      const res = await aiFetch("/api/pb/weekly-report", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || "리포트 생성에 실패했어요.");
      setReport(j.report as Report);
      if (!j.saved) setReportNote("리포트가 저장되진 않았어요 — Supabase 에서 db/pb-replays.sql 을 실행하면 팀 전체가 같은 리포트를 봅니다.");
    } catch (e) {
      setReportNote(e instanceof Error ? e.message : "리포트 생성 실패");
    } finally {
      setGenBusy(false);
    }
  }

  const cardStyle: CSSProperties = {
    background: "var(--pb-card, #fff)",
    border: "1px solid rgba(15,23,42,0.08)",
    borderRadius: 16,
    padding: 18,
  };

  return (
    <>
      <header className="workspace-topbar">
        <div className="workspace-title-block">
          <p className="workspace-eyebrow">전체 대시보드</p>
          <div className="workspace-title-row">
            <h1>이번 주 전 브랜드 현황</h1>
            <a className="workspace-secondary-button workspace-settings-trigger" href="/data-tracking/replays">
              세션 리플레이
            </a>
          </div>
          <p className="workspace-subtle">
            {data ? `최근 7일 (${data.range.start} ~ ${data.range.end}) · 이전 7일 대비` : "최근 7일 · 이전 7일 대비"}
          </p>
        </div>
      </header>

      {loadErr ? <div className="workspace-notice">{loadErr}</div> : null}

      {!data ? (
        <div className="workspace-blank-state">
          <h2>전체 현황을 계산하는 중…</h2>
          <p>브랜드별 최근 7일 데이터를 모으고 있어요.</p>
        </div>
      ) : (
        <>
          {/* 전체 합계 */}
          <section className="workspace-stats-grid workspace-stats-grid-compact workspace-stats-grid-triple">
            {[
              { label: "이번 주 방문자", value: data.totals.visitors.toLocaleString(), prev: pctBadge(data.totals.visitors, data.totals.prevVisitors) },
              { label: "이번 주 페이지 뷰", value: data.totals.pageViews.toLocaleString(), prev: pctBadge(data.totals.pageViews, data.totals.prevPageViews) },
              { label: "평균 체류시간", value: `${data.totals.avgStaySeconds}초`, prev: pctBadge(data.totals.avgStaySeconds, data.totals.prevAvgStaySeconds) },
            ].map((c) => (
              <article key={c.label} className="workspace-stat-card">
                <span>{c.label}</span>
                <strong>{c.value}</strong>
                <p style={{ color: c.prev.color, fontWeight: 700 }}>{c.prev.text} <span style={{ color: "#9aa4b2", fontWeight: 500 }}>지난 7일 대비</span></p>
              </article>
            ))}
          </section>

          {/* 브랜드별 표 */}
          <section style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800 }}>브랜드별 이번 주</h2>
              <span style={{ fontSize: 12, color: "#9aa4b2" }}>행을 누르면 그 브랜드 대시보드로 이동</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "#6b7686" }}>
                    {["브랜드", "방문자", "페이지 뷰", "평균 체류", "이탈률", "추이(7일)", "많이 본 페이지"].map((h) => (
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
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                          <strong>{s.visitors.toLocaleString()}</strong>{" "}
                          <span style={{ color: v.color, fontSize: 11, fontWeight: 700 }}>{v.text}</span>
                        </td>
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                          {s.pageViews.toLocaleString()}{" "}
                          <span style={{ color: p.color, fontSize: 11, fontWeight: 700 }}>{p.text}</span>
                        </td>
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>
                          {s.avgStaySeconds}초{" "}
                          <span style={{ color: st.color, fontSize: 11, fontWeight: 700 }}>{st.text}</span>
                        </td>
                        <td style={{ padding: "10px", whiteSpace: "nowrap" }}>{s.bounceRate}%</td>
                        <td style={{ padding: "6px 10px" }}><Spark values={s.spark} /></td>
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

          {/* AI 주간 진단 리포트 */}
          <section style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 style={{ fontSize: 15, fontWeight: 800 }}>AI 주간 진단 리포트</h2>
                <p style={{ fontSize: 12, color: "#6b7686", marginTop: 2 }}>
                  내부 데이터 + 계절·소비심리·경기 흐름 + 최신 뉴스(웹 검색)를 조합해 &quot;왜 이런 흐름인지&quot;까지 진단해요.
                </p>
              </div>
              <button className="workspace-primary-button" style={{ width: "auto", padding: "10px 16px" }} onClick={generateReport} disabled={genBusy}>
                {genBusy ? "생성 중… (30초~1분)" : report ? "리포트 다시 생성" : "이번 주 리포트 생성"}
              </button>
            </div>
            {reportNote ? <div className="workspace-notice" style={{ marginTop: 10 }}>{reportNote}</div> : null}
            {report ? (
              <div style={{ marginTop: 12, borderTop: "1px solid rgba(15,23,42,0.08)", paddingTop: 6 }}>
                <p style={{ fontSize: 11, color: "#9aa4b2" }}>
                  {report.week_key} 주 기준 · {new Date(report.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} 생성
                </p>
                <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: mdToHtml(report.content) }} />
              </div>
            ) : (
              <p style={{ marginTop: 12, fontSize: 13, color: "#9aa4b2" }}>
                아직 생성된 리포트가 없어요. 버튼을 누르면 이번 주 데이터를 진단해 드립니다. (마이페이지의 본인 Anthropic 키 사용)
              </p>
            )}
          </section>
        </>
      )}
    </>
  );
}
