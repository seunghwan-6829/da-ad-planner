"use client";

/* 네이버 카페 자동화 > '글 수집 현황' 전용 페이지.
   무엇을 보여주나 — "지금 어느 카페에서, 무엇을, 어떻게 주고받으며 모으고 있는지"를 한 화면에.
     ① 파이프라인 요약(수집 → 24h 측정 → 판정)과 총계
     ② 데이터 흐름: 워커(노트북) ↔ 서버 ↔ 평가 크론의 실시간 상태
     ③ 카페별 수집 현황 — 마지막/다음 수집, 진행바, 판정 분포 막대
     ④ 최근 수집·판정된 글 피드(필터)
   15초마다 자동 갱신하며, 갱신 중에도 화면이 깜빡이지 않게 이전 데이터를 유지한다. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, Database, Loader2, RefreshCw, Radar, ServerCog } from "lucide-react";

type Counts = { total: number; today: number; keep: number; drop: number; ad: number; noise: number; unrated: number; pending: number; dueEval: number };
type CafeRow = {
  id: string; name: string; cafe_url: string | null; enabled: boolean;
  paused_reason: string | null; collectable: boolean; blocked_reason: string | null;
  observed_at: string | null; next_observe_at: string | null; last_collected_at: string | null;
  counts: Counts;
};
type FeedRow = {
  cafe_id: string; cafe_name: string; title: string; verdict: string; verdict_reason: string | null;
  views: number | null; comments: number | null; views_delta: number | null; comments_delta: number | null;
  is_popular: boolean; first_seen: string; last_seen: string; evaluated_at: string | null; is_new_today: boolean;
};
type Overview = {
  ok: boolean; tableMissing: boolean; truncated?: boolean; now: string;
  rules: { observe_gap_hours: number; global_gap_min: number; eval_after_hours: number };
  agent: { online: boolean; last_seen: string | null; halted: boolean; halt_reason: string | null; last_event: string | null; last_event_at: string | null };
  next_slot_at: string | null;
  totals: Counts & { cafes: number; collectable: number };
  cafes: CafeRow[];
  recent: FeedRow[];
};

const VERDICT: Record<string, { label: string; icon: string; chip: string; bar: string }> = {
  keep: { label: "좋은 글", icon: "✅", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300", bar: "bg-emerald-500" },
  pending: { label: "측정 중", icon: "⏳", chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300", bar: "bg-blue-400" },
  drop: { label: "반응 낮음", icon: "💤", chip: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400", bar: "bg-gray-300 dark:bg-gray-600" },
  ad: { label: "광고", icon: "🚫", chip: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300", bar: "bg-red-400" },
  noise: { label: "잡글", icon: "🧹", chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", bar: "bg-amber-400" },
  unrated: { label: "측정 불가", icon: "❔", chip: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500", bar: "bg-gray-200 dark:bg-gray-700" },
};
const ORDER = ["keep", "pending", "drop", "ad", "noise", "unrated"] as const;

/** 상대 시각 — "3분 전" / "2시간 뒤". 초 단위 흔들림 없이 읽히게 분 단위로 자른다. */
function rel(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = t - nowMs;
  const future = diff > 0;
  const min = Math.floor(Math.abs(diff) / 60000);
  if (min < 1) return future ? "곧" : "방금";
  if (min < 60) return future ? `${min}분 뒤` : `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return future ? `${h}시간 뒤` : `${h}시간 전`;
  const d = Math.floor(h / 24);
  return future ? `${d}일 뒤` : `${d}일 전`;
}
const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

export function ObserveDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | keyof typeof VERDICT>("all");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const alive = useRef(true);

  const load = useCallback(async (manual = false) => {
    if (manual) setBusy(true);
    try {
      const r = await fetch("/api/naver-cafe/observe/overview", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "수집 현황을 불러오지 못했어요.");
      if (!alive.current) return;
      setData(j as Overview);
      setErr("");
    } catch (e) {
      // 갱신 실패해도 기존 화면은 유지 — 첫 로드일 때만 오류를 표시한다.
      if (alive.current) setErr(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      if (alive.current && manual) setBusy(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => void load(), 15_000); // 계속 갱신
    const tick = setInterval(() => setNowMs(Date.now()), 30_000); // 상대 시각 갱신
    return () => { alive.current = false; clearInterval(t); clearInterval(tick); };
  }, [load]);

  const card = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900";

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-gray-400">
        {err ? <span className="text-sm text-red-500">{err}</span> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
    );
  }

  const t = data.totals;
  const collected = t.keep + t.drop + t.ad + t.noise + t.unrated; // 판정이 끝난 글
  const feed = data.recent.filter((r) => filter === "all" || r.verdict === filter);
  const nextCafe = [...data.cafes]
    .filter((c) => c.collectable && c.next_observe_at)
    .sort((a, b) => (a.next_observe_at || "") < (b.next_observe_at || "") ? -1 : 1)[0];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100">
            <Radar className="h-6 w-6 text-primary" /> 글 수집 현황
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            각 카페를 하루 {Math.max(1, Math.round(24 / data.rules.observe_gap_hours))}번 돌며 글을 모으고,
            {" "}{data.rules.eval_after_hours}시간 뒤 반응을 다시 재서 잘 나온 글만 원고 소재로 남깁니다. (광고는 자동 제외·데이터는 보존)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            자동 갱신 중 · {clock(data.now)} 기준
          </span>
          <button onClick={() => void load(true)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 새로고침
          </button>
        </div>
      </div>

      {data.tableMissing && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>수집 테이블이 아직 없어요. Supabase SQL Editor 에서 <b>db/naver-cafe-observe.sql</b> 을 실행하면 이 화면에 데이터가 쌓이기 시작합니다.</span>
        </div>
      )}
      {!data.agent.online && !data.tableMissing && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            노트북 수집 에이전트가 <b>꺼져 있어요</b> — 수집이 멈춘 상태입니다. (마지막 신호 {rel(data.agent.last_seen, nowMs)})
            {data.agent.halted ? ` · 자동 중단됨: ${data.agent.halt_reason ?? ""}` : ""}
          </span>
        </div>
      )}
      {err && <div className="mb-4 rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800/60">갱신 실패(이전 데이터 표시 중) — {err}</div>}

      {/* ① 파이프라인 요약 */}
      <section className={`${card} mb-4`}>
        <div className="mb-3 flex items-center gap-2 text-sm font-bold dark:text-gray-100">
          <Database className="h-4 w-4 text-primary" /> 수집 파이프라인
        </div>
        <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <div className="rounded-xl border border-gray-200 p-3 text-center dark:border-gray-700">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">① 수집</p>
            <p className="mt-1 text-2xl font-bold dark:text-gray-100">{t.total.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              누적 글 · 오늘 <b className="text-primary">+{t.today}</b>
              {data.truncated ? <span title="집계는 최근 5,000건까지만 셉니다(그 이전 글은 숫자에 미포함)" className="ml-1 text-amber-500">*</span> : null}
            </p>
          </div>
          <div className="hidden items-center justify-center text-gray-300 md:flex">→</div>
          <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3 text-center dark:border-blue-900 dark:bg-blue-950/20">
            <p className="text-[11px] text-blue-600 dark:text-blue-300">② {data.rules.eval_after_hours}시간 뒤 재측정</p>
            <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-300">{t.pending.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-blue-500/80 dark:text-blue-300/70">측정 중 · 판정 대기 <b>{t.dueEval}</b></p>
          </div>
          <div className="hidden items-center justify-center text-gray-300 md:flex">→</div>
          <div className="rounded-xl border border-gray-200 p-3 text-center dark:border-gray-700">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">③ 판정 완료</p>
            <p className="mt-1 text-2xl font-bold dark:text-gray-100">{collected.toLocaleString()}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">✅ {t.keep} · 🚫 {t.ad} · 💤 {t.drop}</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
          {ORDER.map((k) => (
            <div key={k} className="rounded-lg border border-gray-100 p-2 text-center dark:border-gray-800">
              <p className="text-[10px] text-gray-400">{VERDICT[k].icon} {VERDICT[k].label}</p>
              <p className="text-sm font-bold dark:text-gray-200">{t[k].toLocaleString()}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ② 데이터 흐름(워커 ↔ 서버 ↔ 평가) */}
      <section className={`${card} mb-4`}>
        <div className="mb-3 flex items-center gap-2 text-sm font-bold dark:text-gray-100">
          <ServerCog className="h-4 w-4 text-primary" /> 데이터 흐름 <span className="text-[11px] font-normal text-gray-400">— 노트북 에이전트와 서버가 주고받는 내용</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <p className="flex items-center gap-1.5 text-xs font-bold dark:text-gray-200"><Bot className="h-3.5 w-3.5" /> 노트북 에이전트</p>
            <p className={`mt-1 text-sm font-bold ${data.agent.online ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}>
              {data.agent.online ? "동작 중" : "오프라인"}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">마지막 신호 {rel(data.agent.last_seen, nowMs)}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              서버에 20초마다 <b>&quot;다음에 볼 카페 있어?&quot;</b> 물어보고, 배정받으면 그 카페 게시판·인기글을 열어 제목·조회·댓글을 읽어 서버로 보냅니다.
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs font-bold dark:text-gray-200">🗓 서버의 방문 배정 규칙</p>
            <p className="mt-1 text-sm font-bold dark:text-gray-100">
              {nextCafe ? <>다음 <span className="text-primary">{nextCafe.name}</span></> : "대기 중"}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              {nextCafe ? `${rel(nextCafe.next_observe_at, nowMs)} (${clock(nextCafe.next_observe_at)})` : "배정 가능한 카페 없음"}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              카페당 <b>{data.rules.observe_gap_hours}시간에 1번(하루 2회)</b>, 카페 사이엔 최소 <b>{data.rules.global_gap_min}분</b>을 띄웁니다
              — 여러 카페를 연달아 방문하면 그 자체가 봇 패턴이라서요.
              {data.next_slot_at && Date.parse(data.next_slot_at) > nowMs ? <> 지금은 간격 대기 중({rel(data.next_slot_at, nowMs)} 해제).</> : null}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
            <p className="text-xs font-bold dark:text-gray-200">⚖️ 평가(서버 크론)</p>
            <p className="mt-1 text-sm font-bold dark:text-gray-100">매시각 자동</p>
            <p className="mt-0.5 text-[11px] text-gray-400">지금 판정 대기 {t.dueEval}건</p>
            <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
              첫 수집 {data.rules.eval_after_hours}시간 뒤 조회·댓글 <b>증가폭</b>을 재고, 광고·잡글을 걸러낸 뒤
              그 카페 평소 수준과 비교해 <b>좋은 글만</b> 남깁니다.
            </p>
          </div>
        </div>
        {data.agent.last_event && (
          <p className="mt-2 truncate text-[11px] text-gray-400">최근 동작: {data.agent.last_event} <span className="text-gray-300">({rel(data.agent.last_event_at, nowMs)})</span></p>
        )}
      </section>

      {/* ③ 카페별 수집 현황 */}
      <section className={`${card} mb-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold dark:text-gray-100">카페별 수집 현황 <span className="ml-1 text-[11px] font-normal text-gray-400">— 수집 대상 {t.collectable}/{t.cafes}곳</span></h2>
        </div>
        {data.cafes.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">등록된 발행처가 없어요.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400">
                  <th className="px-2 py-2 font-medium">카페</th>
                  <th className="px-2 py-2 font-medium">상태</th>
                  <th className="px-2 py-2 font-medium">마지막 수집</th>
                  <th className="px-2 py-2 font-medium">다음 수집</th>
                  <th className="px-2 py-2 font-medium">수집 글</th>
                  <th className="px-2 py-2 font-medium">판정 분포</th>
                </tr>
              </thead>
              <tbody>
                {data.cafes.map((c) => {
                  const nextMs = c.next_observe_at ? Date.parse(c.next_observe_at) : NaN;
                  const obsMs = c.observed_at ? Date.parse(c.observed_at) : NaN;
                  // 진행바: 지난 수집 → 다음 수집까지 얼마나 왔는지
                  const progress = !Number.isNaN(nextMs) && !Number.isNaN(obsMs)
                    ? Math.max(0, Math.min(100, ((nowMs - obsMs) / (nextMs - obsMs)) * 100))
                    : 0;
                  const due = !Number.isNaN(nextMs) && nextMs <= nowMs;
                  const cc = c.counts;
                  const seg = ORDER.map((k) => ({ k, n: cc[k] })).filter((s) => s.n > 0);
                  return (
                    <tr key={c.id} className="border-b last:border-0 dark:border-gray-800">
                      <td className="px-2 py-2.5">
                        <p className="font-semibold dark:text-gray-200">{c.name}</p>
                        {c.cafe_url && <p className="max-w-[220px] truncate text-[10px] text-gray-400">{c.cafe_url.replace(/^https?:\/\//, "")}</p>}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {c.collectable ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">수집 중</span>
                        ) : (
                          <span title={c.paused_reason || undefined} className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                            {c.blocked_reason ?? "중지"}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap text-gray-600 dark:text-gray-300">
                        {c.last_collected_at ? <>{rel(c.last_collected_at, nowMs)}<span className="ml-1 text-[10px] text-gray-400">{clock(c.last_collected_at)}</span></> : <span className="text-gray-400">아직 없음</span>}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        {!c.collectable ? (
                          <span className="text-gray-400">—</span>
                        ) : Number.isNaN(nextMs) ? (
                          <span className="font-medium text-primary">곧 (첫 방문)</span>
                        ) : (
                          <div className="min-w-[110px]">
                            <p className={due ? "font-bold text-primary" : "text-gray-600 dark:text-gray-300"}>{due ? "지금 대기 중" : rel(c.next_observe_at, nowMs)}</p>
                            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              <div className={`h-full rounded-full ${due ? "bg-primary" : "bg-primary/50"}`} style={{ width: `${progress}%` }} />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2.5 whitespace-nowrap">
                        <b className="dark:text-gray-200">{cc.total.toLocaleString()}</b>
                        {cc.today > 0 && <span className="ml-1 text-[10px] font-bold text-primary">+{cc.today}</span>}
                      </td>
                      <td className="px-2 py-2.5">
                        {cc.total === 0 ? (
                          <span className="text-[10px] text-gray-400">—</span>
                        ) : (
                          <div className="min-w-[150px]">
                            <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                              {seg.map((s) => (
                                <div key={s.k} className={VERDICT[s.k].bar} style={{ width: `${(s.n / cc.total) * 100}%` }} title={`${VERDICT[s.k].label} ${s.n}건`} />
                              ))}
                            </div>
                            <p className="mt-1 text-[10px] text-gray-400">
                              ✅{cc.keep} ⏳{cc.pending} 💤{cc.drop} 🚫{cc.ad} 🧹{cc.noise}
                            </p>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ④ 최근 수집·판정 피드 */}
      <section className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold dark:text-gray-100">최근 수집된 글 <span className="ml-1 text-[11px] font-normal text-gray-400">— 전체 카페 통합 · 최신순</span></h2>
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setFilter("all")} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${filter === "all" ? "border-primary bg-primary/10 text-primary" : "border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"}`}>전체 {data.recent.length}</button>
            {ORDER.filter((k) => data.recent.some((r) => r.verdict === k)).map((k) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${filter === k ? "border-primary bg-primary/10 text-primary" : "border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400"}`}>
                {VERDICT[k].icon} {VERDICT[k].label} {data.recent.filter((r) => r.verdict === k).length}
              </button>
            ))}
          </div>
        </div>
        {feed.length === 0 ? (
          <p className="py-6 text-center text-xs text-gray-400">
            {data.recent.length === 0 ? "아직 수집된 글이 없어요. 에이전트가 켜져 있으면 곧 첫 수집이 시작됩니다." : "이 분류에 해당하는 글이 없어요."}
          </p>
        ) : (
          <div className="max-h-[420px] space-y-1 overflow-y-auto">
            {feed.map((r, i) => {
              const v = VERDICT[r.verdict] ?? VERDICT.pending;
              const hasDelta = r.views_delta !== null || r.comments_delta !== null;
              return (
                <div key={`${r.cafe_id}-${i}`} title={r.verdict_reason || undefined} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60">
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${v.chip}`}>{v.icon} {v.label}</span>
                  {r.is_new_today
                    ? <span title="오늘 처음 발견한 글" className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-bold text-primary">NEW</span>
                    : <span title="이전에 봤던 글을 다시 확인(지표 갱신)" className="shrink-0 text-[9px] text-gray-300">재확인</span>}
                  <span className="w-24 shrink-0 truncate text-[10px] text-gray-400">{r.cafe_name}</span>
                  <span className={`min-w-0 flex-1 truncate ${r.verdict === "ad" || r.verdict === "noise" ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-300"}`}>
                    {r.is_popular ? <span title="카페 인기글">🔥 </span> : null}{r.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {hasDelta
                      ? `24h 조회 +${r.views_delta ?? 0}${r.comments_delta ? ` · 댓글 +${r.comments_delta}` : ""}`
                      : (r.views ?? 0) > 0 ? `조회 ${Number(r.views).toLocaleString()}` : ""}
                  </span>
                  <span className="w-16 shrink-0 text-right text-[10px] text-gray-400">{rel(r.last_seen, nowMs)}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-right text-[10px] text-gray-400">각 줄에 마우스를 올리면 판정 이유가 보여요 · 광고로 걸러진 글도 지우지 않고 그대로 보관합니다</p>
      </section>
    </>
  );
}
