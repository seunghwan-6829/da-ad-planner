"use client";

/* 세션 리플레이 목록 + 재생 — 트래커(rrweb)가 저장한 방문자 화면을 영상처럼 돌려본다.
   재생기는 rrweb-player 를 클릭 시점에 동적 import(서버 렌더에서 window 접근 방지). */

import { useCallback, useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";
import { ArrowLeft, Loader2, MonitorPlay, RefreshCw, Smartphone, Tablet, X } from "lucide-react";

type ReplayRow = {
  id: string;
  site_id: string;
  path: string | null;
  device_type: string | null;
  duration_ms: number | null;
  event_count: number | null;
  chunk_count: number | null;
  created_at: string;
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

export function ReplayListClient({ initialSite }: { initialSite?: string }) {
  const [rows, setRows] = useState<ReplayRow[]>([]);
  const [siteNames, setSiteNames] = useState<Record<string, string>>({});
  const [tableMissing, setTableMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [siteFilter, setSiteFilter] = useState(initialSite || "all");

  const [playerOpen, setPlayerOpen] = useState(false);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [playerMeta, setPlayerMeta] = useState<ReplayRow | null>(null);
  const playerHost = useRef<HTMLDivElement | null>(null);

  const load = useCallback((site: string) => {
    setLoading(true);
    setLoadErr("");
    fetch(`/api/pb/replays${site !== "all" ? `?site=${encodeURIComponent(site)}` : ""}`, { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || "목록을 불러오지 못했어요.");
        setRows((j.replays as ReplayRow[]) || []);
        setSiteNames((j.siteNames as Record<string, string>) || {});
        setTableMissing(!!j.tableMissing);
      })
      .catch((e) => setLoadErr(e instanceof Error ? e.message : "불러오기 실패"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(siteFilter);
  }, [load, siteFilter]);

  async function openReplay(row: ReplayRow) {
    setPlayerMeta(row);
    setPlayerOpen(true);
    setPlayerLoading(true);
    try {
      const r = await fetch(`/api/pb/replays?id=${encodeURIComponent(row.id)}`, { cache: "no-store" });
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
    setPlayerMeta(null);
    if (playerHost.current) playerHost.current.innerHTML = "";
  }

  const siteOptions = Object.entries(siteNames);

  return (
    <div className="min-h-full bg-gray-50 p-8 dark:bg-gray-900">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100">
            <MonitorPlay className="h-6 w-6 text-primary" /> 세션 리플레이
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            방문자가 실제로 어떻게 움직였는지 화면 그대로 재생해요. (입력값은 전부 마스킹 저장 · 페이지당 최대 60초)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/data-tracking" className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <ArrowLeft className="h-3.5 w-3.5" /> 데이터 추적
          </a>
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="all">전체 프로젝트</option>
            {siteOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <button onClick={() => load(siteFilter)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            <RefreshCw className="h-3.5 w-3.5" /> 새로고침
          </button>
        </div>
      </div>

      {tableMissing ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          아직 리플레이 테이블이 없어요. Supabase SQL Editor 에서 <b>db/pb-replays.sql</b> 을 1회 실행하면 이 순간부터 방문 화면이 저장됩니다.
        </div>
      ) : null}

      {loading ? (
        <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : loadErr ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{loadErr}</div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-gray-700">
          아직 저장된 리플레이가 없어요. 방문자가 5초 이상 머물면 자동으로 쌓입니다.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-4 py-3 font-medium">시간</th>
                <th className="px-4 py-3 font-medium">프로젝트</th>
                <th className="px-4 py-3 font-medium">페이지</th>
                <th className="px-4 py-3 font-medium">기기</th>
                <th className="px-4 py-3 font-medium">길이</th>
                <th className="px-4 py-3 font-medium text-right">재생</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} onClick={() => void openReplay(row)} className="cursor-pointer border-b last:border-0 hover:bg-primary/5 dark:border-gray-800">
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">
                    {new Date(row.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium dark:text-gray-200">{siteNames[row.site_id] || row.site_id}</td>
                  <td className="max-w-[280px] truncate px-4 py-3 text-gray-600 dark:text-gray-300">{row.path || "/"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500 dark:text-gray-400"><span className="inline-flex items-center gap-1"><DeviceIcon type={row.device_type} />{row.device_type === "phone" ? "폰" : row.device_type === "tablet" ? "태블릿" : "데스크탑"}</span></td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600 dark:text-gray-300">{fmtDuration(row.duration_ms)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right"><span className="rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">▶ 보기</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {playerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={closePlayer}>
          <div className="max-h-[94vh] overflow-auto rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold dark:text-gray-100">
                  {playerMeta ? `${siteNames[playerMeta.site_id] || playerMeta.site_id} · ${playerMeta.path || "/"}` : "리플레이"}
                </p>
                <p className="text-[11px] text-gray-400">
                  {playerMeta ? `${new Date(playerMeta.created_at).toLocaleString("ko-KR")} · ${fmtDuration(playerMeta.duration_ms)} · 이벤트 ${playerMeta.event_count ?? 0}개` : ""}
                </p>
              </div>
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
