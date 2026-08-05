"use client";

/* 세션 리플레이 — '방문(세션)' 단위 여정 뷰.
   한 줄 = 한 사람의 방문: 누가(방문자 칩 · n번째 방문) · 어디서(유입: UTM/검색/SNS/직접) ·
   어떤 경로로 움직였는지(페이지 여정 칩, 각각 바로 재생) · 기기 · 총 체류.
   유입/경로/기기/방문자 필터 + 상위 경로·유입 요약 칩(클릭=필터). 재생기는 클릭 시 동적 import. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import { ArrowLeft, Loader2, MonitorPlay, RefreshCw, Smartphone, Tablet, Trash2, X } from "lucide-react";

type SessionPage = { replay_id: string; path: string; duration_ms: number; created_at: string };
type SessionRow = {
  session_key: string;
  site_id: string;
  visitor_id: string | null;
  visit_no: number;
  visit_total: number;
  source_label: string;
  source_kind: "utm" | "ref" | "direct";
  device_type: string | null;
  started_at: string;
  total_duration_ms: number;
  pages: SessionPage[];
};

type ReplayEvent = { type: number; data: unknown; timestamp: number };

function fmtDuration(ms: number | null) {
  const s = Math.max(1, Math.round((ms || 0) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`;
}

function DeviceIcon({ type }: { type: string | null }) {
  if (type === "phone") return <Smartphone className="h-3.5 w-3.5" />;
  if (type === "tablet") return <Tablet className="h-3.5 w-3.5" />;
  return <MonitorPlay className="h-3.5 w-3.5" />;
}

// 방문자 칩 — visitor_id 해시로 고정 색, 뒤 4자리로 짧은 이름. 같은 사람은 항상 같은 색/이름.
function visitorHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}
function visitorTag(id: string | null): string {
  if (!id) return "익명";
  return id.replace(/^visitor_/, "").slice(-4);
}

const SOURCE_STYLE: Record<SessionRow["source_kind"], string> = {
  utm: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800",
  ref: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  direct: "bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700",
};

export function ReplayListClient({ initialSite }: { initialSite?: string }) {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [siteNames, setSiteNames] = useState<Record<string, string>>({});
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const [siteFilter, setSiteFilter] = useState(initialSite || "all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [pathFilter, setPathFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState<"all" | "desktop" | "phone" | "tablet">("all");
  const [visitorFilter, setVisitorFilter] = useState<string | null>(null);

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerTitle, setPlayerTitle] = useState("");
  const playerHost = useRef<HTMLDivElement | null>(null);

  const load = useCallback((site: string) => {
    setLoading(true);
    setLoadErr("");
    fetch(`/api/pb/replays${site !== "all" ? `?site=${encodeURIComponent(site)}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "목록을 불러오지 못했어요.");
        setSessions((j.sessions as SessionRow[]) || []);
        setSiteNames((j.siteNames as Record<string, string>) || {});
        setTableMissing(!!j.tableMissing);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(siteFilter);
  }, [load, siteFilter]);

  // 클라이언트 필터(300건 이내라 즉시)
  const filtered = useMemo(
    () =>
      sessions.filter(
        (s) =>
          (sourceFilter === "all" || s.source_label === sourceFilter) &&
          (pathFilter === "all" || s.pages.some((p) => p.path === pathFilter)) &&
          (deviceFilter === "all" || (s.device_type || "desktop") === deviceFilter) &&
          (!visitorFilter || s.visitor_id === visitorFilter)
      ),
    [sessions, sourceFilter, pathFilter, deviceFilter, visitorFilter]
  );

  // 요약: 상위 경로·유입(클릭=필터) — "경로를 한번에 분류해서" 보는 용도
  const topPaths = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of sessions) for (const p of s.pages) c.set(p.path, (c.get(p.path) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [sessions]);
  const topSources = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of sessions) c.set(s.source_label, (c.get(s.source_label) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [sessions]);

  async function openReplay(page: SessionPage, session: SessionRow) {
    setPlayerTitle(`${siteNames[session.site_id] || session.site_id} · ${page.path}`);
    setPlayerOpen(true);
    setPlayerLoading(true);
    try {
      const r = await fetch(`/api/pb/replays?id=${encodeURIComponent(page.replay_id)}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "리플레이를 불러오지 못했어요.");
      const events = (j.events as ReplayEvent[]) || [];
      if (events.length < 2) throw new Error("재생할 이벤트가 부족해요(녹화가 너무 짧음).");
      const { default: rrwebPlayer } = await import("rrweb-player");
      if (!playerHost.current) return;
      playerHost.current.innerHTML = "";
      const width = Math.min(1000, window.innerWidth - 96);
      new rrwebPlayer({
        target: playerHost.current,
        props: { events: events as never, width, height: Math.min(560, window.innerHeight - 220), autoPlay: true, skipInactive: true },
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "재생 실패");
      setPlayerOpen(false);
    } finally {
      setPlayerLoading(false);
    }
  }

  function closePlayer() {
    setPlayerOpen(false);
    setPlayerTitle("");
    if (playerHost.current) playerHost.current.innerHTML = "";
  }

  async function removeSession(s: SessionRow) {
    if (!confirm(`이 방문 기록(페이지 ${s.pages.length}개)을 삭제할까요?`)) return;
    const r = await fetch(`/api/pb/replays?session=${encodeURIComponent(s.session_key)}`, { method: "DELETE" });
    if (r.ok) setSessions((prev) => prev.filter((x) => x.session_key !== s.session_key));
    else alert("삭제 실패");
  }

  const chip = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-gray-200 text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
    }`;

  return (
    <div className="min-h-full bg-gray-50 p-8 dark:bg-gray-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100">
            <MonitorPlay className="h-6 w-6 text-primary" /> 세션 리플레이
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            한 줄 = 한 사람의 방문 — 누가 · 어디서 유입 · 어떤 경로로 움직였는지, 페이지마다 바로 재생. (입력값 전부 마스킹 · 페이지당 최대 60초)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/data-tracking" className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <ArrowLeft className="h-3.5 w-3.5" /> 데이터 추적
          </a>
          <select
            value={siteFilter}
            onChange={(e) => { setSiteFilter(e.target.value); setSourceFilter("all"); setPathFilter("all"); setVisitorFilter(null); }}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="all">전체 프로젝트</option>
            {Object.entries(siteNames).map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button onClick={() => load(siteFilter)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
        </div>
      </div>

      {/* 요약·필터 스트립 — 유입/경로를 '한눈에 분류'해서 보고, 누르면 그대로 필터 */}
      {sessions.length > 0 && (
        <div className="mb-4 space-y-2 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold text-gray-400">유입</span>
            <button className={chip(sourceFilter === "all")} onClick={() => setSourceFilter("all")}>전체</button>
            {topSources.map(([label, n]) => (
              <button key={label} className={chip(sourceFilter === label)} onClick={() => setSourceFilter(sourceFilter === label ? "all" : label)}>
                {label} <b>{n}</b>
              </button>
            ))}
            <span className="ml-3 mr-1 text-[11px] font-bold text-gray-400">기기</span>
            {([["all", "전체"], ["desktop", "데스크탑"], ["phone", "폰"], ["tablet", "태블릿"]] as const).map(([k, label]) => (
              <button key={k} className={chip(deviceFilter === k)} onClick={() => setDeviceFilter(k)}>{label}</button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-bold text-gray-400">경로</span>
            <button className={chip(pathFilter === "all")} onClick={() => setPathFilter("all")}>전체</button>
            {topPaths.map(([p, n]) => (
              <button key={p} className={chip(pathFilter === p)} onClick={() => setPathFilter(pathFilter === p ? "all" : p)}>
                <span className="max-w-[180px] truncate align-middle" style={{ display: "inline-block" }}>{p}</span> <b>{n}</b>
              </button>
            ))}
            {visitorFilter && (
              <button className="ml-3 rounded-full border border-primary bg-primary/10 px-2.5 py-1 text-[11px] font-bold text-primary" onClick={() => setVisitorFilter(null)}>
                방문자 {visitorTag(visitorFilter)}만 보는 중 ✕
              </button>
            )}
          </div>
        </div>
      )}

      {tableMissing ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          아직 리플레이 테이블이 없어요. Supabase SQL Editor 에서 <b>db/pb-replays.sql</b> 을 1회 실행하면 이 순간부터 방문 화면이 저장됩니다.
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : loadErr ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{loadErr}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {sessions.length === 0 ? "아직 저장된 리플레이가 없어요. 방문자가 5초 이상 머물면 자동으로 쌓입니다." : "필터에 맞는 방문이 없어요."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-4 py-3 font-medium">시간</th>
                <th className="px-4 py-3 font-medium">방문자</th>
                <th className="px-4 py-3 font-medium">유입</th>
                <th className="px-4 py-3 font-medium">여정 (누르면 그 페이지 재생)</th>
                <th className="px-4 py-3 font-medium">기기</th>
                <th className="px-4 py-3 font-medium">총 체류</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const hue = visitorHue(s.visitor_id || "anon");
                return (
                  <tr key={s.session_key} className="border-b align-top last:border-0 dark:border-gray-800">
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">
                      {new Date(s.started_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      {siteFilter === "all" && <div className="mt-0.5 text-[10px] text-gray-400">{siteNames[s.site_id] || s.site_id}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        onClick={() => setVisitorFilter(visitorFilter === s.visitor_id ? null : s.visitor_id)}
                        title="누르면 이 방문자의 방문만 모아봐요"
                        className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2 py-0.5 text-xs font-semibold hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        style={{ color: `hsl(${hue} 60% 40%)` }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: `hsl(${hue} 70% 50%)` }} />
                        {visitorTag(s.visitor_id)}
                      </button>
                      <div className="mt-1 text-[10px] text-gray-400">
                        {s.visit_no <= 1 ? "신규 방문" : `${s.visit_no}번째 방문`}{s.visit_total > 1 ? ` · 총 ${s.visit_total}회` : ""}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SOURCE_STYLE[s.source_kind]}`}>
                        {s.source_kind === "utm" ? "📣 " : s.source_kind === "ref" ? "🔗 " : ""}{s.source_label}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {s.pages.map((p, i) => (
                          <span key={p.replay_id} className="flex items-center gap-1">
                            {i > 0 && <span className="text-gray-300 dark:text-gray-600">→</span>}
                            <button
                              onClick={() => void openReplay(p, s)}
                              title={`${p.path} · ${fmtDuration(p.duration_ms)} 재생`}
                              className="group flex max-w-[220px] items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-primary hover:bg-primary/5 hover:text-primary dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                            >
                              <span className="text-primary">▶</span>
                              <span className="truncate">{p.path}</span>
                              <span className="shrink-0 text-[10px] text-gray-400 group-hover:text-primary/70">{fmtDuration(p.duration_ms)}</span>
                            </button>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400">
                      <span className="inline-flex items-center gap-1"><DeviceIcon type={s.device_type} />{s.device_type === "phone" ? "폰" : s.device_type === "tablet" ? "태블릿" : "데스크탑"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-700 dark:text-gray-200">{fmtDuration(s.total_duration_ms)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <button onClick={() => void removeSession(s)} title="이 방문 기록 삭제" className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/40">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {playerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={closePlayer}>
          <div className="max-h-[94vh] overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="truncate text-sm font-bold dark:text-gray-100">{playerTitle || "리플레이"}</p>
              <button onClick={closePlayer} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            {playerLoading ? (
              <div className="flex h-64 w-[70vw] max-w-[1000px] items-center justify-center text-gray-400">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 리플레이 불러오는 중…
              </div>
            ) : null}
            <div ref={playerHost} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
