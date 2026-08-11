"use client";

/* '글 수집 현황'의 하위 목록 페이지 — 하나의 엔진으로 3가지 화면을 그린다.
     good     : ✅ 좋은 원고 모음(평가 통과 = 실제로 원고 소재가 되는 글)
     all      : 전체 수집 로그(모든 판정, 판정 필터 제공)
     filtered : 🚫 걸러진 글(광고·잡글) — 지우지 않고 왜 걸러졌는지 확인하는 곳
   검색·카페 필터·정렬·페이지네이션은 서버에서 처리(/api/naver-cafe/observe/posts). */

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";

export type PostsMode = "good" | "all" | "filtered";

type Item = {
  cafe_id: string; cafe_name: string; url: string | null; title: string; verdict: string; verdict_reason: string | null;
  views: number | null; comments: number | null; views_delta: number | null; comments_delta: number | null;
  score: number | null; is_popular: boolean; first_seen: string; last_seen: string; evaluated_at: string | null;
};

const VERDICT: Record<string, { label: string; icon: string; chip: string }> = {
  keep: { label: "좋은 글", icon: "✅", chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  pending: { label: "측정 중", icon: "⏳", chip: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300" },
  drop: { label: "반응 낮음", icon: "💤", chip: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400" },
  ad: { label: "광고", icon: "🚫", chip: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300" },
  noise: { label: "잡글", icon: "🧹", chip: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300" },
  unrated: { label: "측정 불가", icon: "❔", chip: "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500" },
};
const VERDICT_KEYS = ["keep", "pending", "drop", "ad", "noise", "unrated"] as const;

const MODE_CFG: Record<PostsMode, { verdict: string; sort: string; title: string; desc: string }> = {
  good: {
    verdict: "keep",
    sort: "score",
    title: "좋은 원고 모음",
    desc: "24시간 반응 측정을 통과한 글들입니다. 원고를 만들 때 이 글들의 '주제'만 참고해 완전히 새로 씁니다(문장·구성 복제 금지).",
  },
  all: {
    verdict: "all",
    sort: "recent",
    title: "전체 수집 로그",
    desc: "지금까지 모은 모든 글입니다. 판정·카페·검색어로 걸러 보세요.",
  },
  filtered: {
    verdict: "ad,noise",
    sort: "recent",
    title: "걸러진 글 (광고·잡글)",
    desc: "원고 소재에서 자동 제외된 글입니다. 지우지 않고 그대로 보관해 무엇이 왜 걸러졌는지 확인할 수 있어요.",
  },
};

function fmtDate(iso: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function ObservePosts({ mode, cafes }: { mode: PostsMode; cafes: { id: string; name: string }[] }) {
  const cfg = MODE_CFG[mode];
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [cafe, setCafe] = useState("all");
  const [verdict, setVerdict] = useState(cfg.verdict);
  const [sort, setSort] = useState(cfg.sort);
  const [q, setQ] = useState("");
  const [qLive, setQLive] = useState(""); // 입력 즉시 반영되는 값(디바운스 전)
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [tableMissing, setTableMissing] = useState(false);
  const [copied, setCopied] = useState(false);
  const alive = useRef(true);
  const LIMIT = 50;

  // 모드가 바뀌면(탭 이동) 조건 초기화
  useEffect(() => {
    setVerdict(cfg.verdict); setSort(cfg.sort); setPage(1); setCafe("all"); setQ(""); setQLive("");
  }, [mode, cfg.verdict, cfg.sort]);

  // 검색어 디바운스 — 타이핑마다 서버를 때리지 않게 400ms 뒤에 반영
  useEffect(() => {
    const t = setTimeout(() => { setQ(qLive); setPage(1); }, 400);
    return () => clearTimeout(t);
  }, [qLive]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ verdict, cafe, sort, page: String(page), limit: String(LIMIT) });
      if (q) p.set("q", q);
      const r = await fetch(`/api/naver-cafe/observe/posts?${p.toString()}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || "목록을 불러오지 못했어요.");
      if (!alive.current) return;
      const rows = (j.items as Item[]) || [];
      // 필터/자동갱신으로 결과가 줄어 현재 페이지가 범위를 벗어나면 1페이지로 되돌린다(빈 화면 방지)
      if (rows.length === 0 && page > 1) { setPage(1); return; }
      setItems(rows);
      setTotal(Number(j.total) || 0);
      setTableMissing(!!j.tableMissing);
      setErr("");
    } catch (e) {
      if (alive.current) setErr(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [verdict, cafe, sort, page, q]);

  useEffect(() => {
    alive.current = true;
    void load();
    // 목록은 60초 주기(현황 화면보다 길게) — 갱신은 계속하되 서버 부담을 줄인다
    const t = setInterval(() => void load(), 60_000);
    return () => { alive.current = false; clearInterval(t); };
  }, [load]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const card = "rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900";
  const ctl = "rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";

  async function copyAll() {
    const text = items.map((i) => `${i.title}\t${i.cafe_name}`).join("\n");
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { alert("복사에 실패했어요. 브라우저 권한을 확인해 주세요."); }
  }

  return (
    <section className={card}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold dark:text-gray-100">
            {cfg.title} <span className="ml-1 text-xs font-normal text-gray-400">— 총 {total.toLocaleString()}건</span>
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-gray-500 dark:text-gray-400">{cfg.desc}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {mode === "good" && items.length > 0 && (
            <button onClick={() => void copyAll()} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <Copy className="h-3.5 w-3.5" /> {copied ? "복사됨" : "이 페이지 복사"}
            </button>
          )}
          <button onClick={() => void load()} disabled={loading} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} 새로고침
          </button>
        </div>
      </div>

      {/* 조건 바 */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="제목 검색" className={`${ctl} w-44 pl-7`} />
        </div>
        <select value={cafe} onChange={(e) => { setCafe(e.target.value); setPage(1); }} className={ctl}>
          <option value="all">카페 전체</option>
          {cafes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {mode === "all" && (
          <select value={verdict} onChange={(e) => { setVerdict(e.target.value); setPage(1); }} className={ctl}>
            <option value="all">판정 전체</option>
            {VERDICT_KEYS.map((k) => <option key={k} value={k}>{VERDICT[k].icon} {VERDICT[k].label}</option>)}
          </select>
        )}
        <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }} className={ctl}>
          <option value="recent">최신순</option>
          <option value="score">반응 점수순</option>
          <option value="views">조회 증가순</option>
          <option value="old">오래된순</option>
        </select>
      </div>

      {tableMissing ? (
        <p className="py-8 text-center text-xs text-amber-600 dark:text-amber-300">Supabase 에서 db/naver-cafe-observe.sql 을 실행하면 데이터가 쌓이기 시작합니다.</p>
      ) : err ? (
        <p className="py-8 text-center text-xs text-red-500">{err}</p>
      ) : loading && items.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-xs text-gray-400">
          {mode === "good"
            ? "아직 평가를 통과한 글이 없어요. 수집 후 24시간이 지나면 판정이 시작됩니다."
            : q || cafe !== "all"
              ? "조건에 맞는 글이 없어요."
              : "아직 수집된 글이 없어요."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
                <th className="px-2 py-2 font-medium">판정</th>
                <th className="px-2 py-2 font-medium">제목</th>
                <th className="px-2 py-2 font-medium">카페</th>
                <th className="px-2 py-2 font-medium">조회</th>
                <th className="px-2 py-2 font-medium">댓글</th>
                <th className="px-2 py-2 font-medium">24h 증가</th>
                <th className="px-2 py-2 font-medium">점수</th>
                <th className="px-2 py-2 font-medium">최근 확인</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => {
                const v = VERDICT[it.verdict] ?? VERDICT.pending;
                const muted = it.verdict === "ad" || it.verdict === "noise";
                return (
                  <tr key={`${it.cafe_id}-${i}`} title={it.verdict_reason || undefined} className="border-b last:border-0 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/60">
                    <td className="whitespace-nowrap px-2 py-2.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${v.chip}`}>{v.icon} {v.label}</span>
                    </td>
                    <td className={`max-w-[380px] px-2 py-2.5 ${muted ? "text-gray-400" : "dark:text-gray-200"}`}>
                      {/* 원문 주소 — 눌러서 실제 카페 글을 새 탭에서 확인 */}
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noopener noreferrer" title="카페에서 원문 열기" className={`line-clamp-2 hover:text-primary hover:underline ${muted ? "line-through" : ""}`}>
                          {it.is_popular ? <span title="카페 인기글">🔥 </span> : null}{it.title}
                          <ExternalLink className="ml-1 inline h-3 w-3 align-[-1px] text-gray-300" />
                        </a>
                      ) : (
                        <span className={`line-clamp-2 ${muted ? "line-through" : ""}`} title="원문 주소를 알 수 없어요(글 번호 미수집)">
                          {it.is_popular ? <span title="카페 인기글">🔥 </span> : null}{it.title}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-gray-500 dark:text-gray-400">{it.cafe_name}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-gray-600 dark:text-gray-300">
                      {it.views !== null ? it.views.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-gray-600 dark:text-gray-300">
                      {it.comments !== null ? it.comments.toLocaleString() : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-gray-600 dark:text-gray-300">
                      {it.views_delta !== null || it.comments_delta !== null ? (
                        <>조회 <b className="text-primary">+{it.views_delta ?? 0}</b>{it.comments_delta ? <> · 댓글 <b className="text-primary">+{it.comments_delta}</b></> : null}</>
                      ) : (
                        <span className="text-gray-400">측정 전</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-semibold dark:text-gray-200">{it.score !== null ? it.score.toLocaleString() : <span className="font-normal text-gray-400">—</span>}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-[11px] text-gray-400">{fmtDate(it.last_seen)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">{page} / {pages}</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <p className="mt-2 text-right text-[11px] text-gray-400">제목을 누르면 카페 원문이 새 탭에서 열려요 · 각 줄에 마우스를 올리면 판정 이유 표시 · 60초마다 자동 갱신</p>
    </section>
  );
}
