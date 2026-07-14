"use client";

/* 쓰레드(Threads) 자동화
   [모델] 브랜드(페르소나) → 카테고리(수집 소스) → 스크랩(수집글, viral 스코어) → 초안 큐 → Threads API 발행 → 내 글 성과
   [수집] 로컬 워커(Playwright 로그인)가 수집 → 서버 적재    [발행] 서버 크론이 Threads API(2-step)로 발행(브랜드별 토큰)
   [UI]  좌측 브랜드 패널 + 우측 워크스페이스 탭(스크랩 보드 / 발행하기 / 내 글 성과 / 설정) */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign, BarChart3, Bot, CheckCircle2, ExternalLink, Eye, Flame, Heart, KeyRound, Loader2,
  MessageCircle, PenLine, Plus, RefreshCw, Repeat2, Send, Settings2, Sparkles, Trash2, X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

type Brand = {
  id: string; name: string; persona: string; mode: "collect" | "publish"; timezone: string;
  publish_slots: string[]; max_posts_per_day: number; enabled: boolean;
  category_count?: number; token_env?: string; token_ready?: boolean;
};
type Category = { id: string; brand_id: string; name: string; type: "threads_topic" | "css"; keyword: string; topic_tag: string; url: string; preset: string };
type Scrap = {
  key: string; brand_id: string; category_id: string | null; source_type: string; title: string; url: string; author: string; first_seen: string;
  age_hours: number; judgeable: boolean; snapshots: number; hot: boolean; score: number; signal: string;
  best_rank?: number | null; top_appearances?: number; views?: number | null; likes?: number | null; comments?: number | null; views_per_hour?: number | null;
};
type QueueItem = { id: string; brand_id: string; category_id: string | null; topic_tag: string; text: string; status: "queued" | "publishing" | "published" | "failed"; scheduled_at: string | null; media_id: string | null; error: string | null; created_at: string; th_categories?: { id: string; name: string } | null };
type Insight = { media_id: string; text: string; views: number | null; likes: number | null; replies: number | null; reposts: number | null; quotes: number | null; shares: number | null; permalink: string; posted_at: string; ts: string };

const inputCls = "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";
const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const QSTATUS: Record<QueueItem["status"], { label: string; cls: string }> = {
  queued: { label: "대기", cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  publishing: { label: "발행 중", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  published: { label: "발행됨", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  failed: { label: "실패", cls: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300" },
};

async function api(path: string, method: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // generate/analyze 는 서버에서 관리자 검증 → 세션 access_token 을 Bearer 로 전달.
  try { const { data } = await supabase.auth.getSession(); const t = data?.session?.access_token; if (t) headers["Authorization"] = `Bearer ${t}`; } catch {}
  const r = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "요청 실패");
  return j;
}

let thMem: { brands: Brand[]; agentOnline: boolean | null } | null = null;

export default function ThreadsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [brands, setBrands] = useState<Brand[]>(() => thMem?.brands ?? []);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(() => thMem?.agentOnline ?? null);
  const [sel, setSel] = useState<string | "dash">("dash");
  const [tab, setTab] = useState<"scraps" | "compose" | "insights" | "settings">("scraps");
  const [loadErr, setLoadErr] = useState("");

  // 브랜드별 데이터
  const [categories, setCategories] = useState<Category[]>([]);
  const [scraps, setScraps] = useState<Scrap[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [styleGuide, setStyleGuide] = useState<string | null>(null);
  const [scrapFilter, setScrapFilter] = useState<"all" | "hot">("hot");
  const [scrapSearch, setScrapSearch] = useState("");

  // compose
  const [cCat, setCCat] = useState("");
  const [cTopic, setCTopic] = useState("");
  const [cText, setCText] = useState("");
  const [cSchedMode, setCSchedMode] = useState<"slot" | "scheduled">("slot");
  const [cSchedAt, setCSchedAt] = useState("");
  const [cBusy, setCBusy] = useState(false);
  const [genKey, setGenKey] = useState<string | null>(null);

  // modals
  const [brandModal, setBrandModal] = useState<null | Partial<Brand>>(null);
  const [catModal, setCatModal] = useState<null | Partial<Category>>(null);
  const [analyzeBusy, setAnalyzeBusy] = useState(false);

  const brand = sel !== "dash" ? brands.find((b) => b.id === sel) || null : null;

  const loadTop = useCallback(() => {
    fetch("/api/threads/brands").then((r) => (r.ok ? r.json() : [])).then((j) => { setBrands(j as Brand[]); setLoadErr(""); }).catch(() => setLoadErr("데이터를 불러오지 못했어요. db/threads.sql 이 실행됐는지 확인해 주세요."));
    fetch("/api/threads/agent").then((r) => (r.ok ? r.json() : null)).then((j) => j && setAgentOnline(!!j.online)).catch(() => {});
  }, []);
  useEffect(() => { loadTop(); const t = setInterval(loadTop, 20_000); return () => clearInterval(t); }, [loadTop]);
  useEffect(() => { thMem = { brands, agentOnline }; }, [brands, agentOnline]);

  const loadBrand = useCallback((bid: string) => {
    fetch(`/api/threads/categories?brand_id=${bid}`).then((r) => (r.ok ? r.json() : [])).then((j) => setCategories(j as Category[])).catch(() => {});
    fetch(`/api/threads/scraps?brand_id=${bid}`).then((r) => (r.ok ? r.json() : [])).then((j) => setScraps(j as Scrap[])).catch(() => {});
    fetch(`/api/threads/queue?brand_id=${bid}`).then((r) => (r.ok ? r.json() : [])).then((j) => setQueue(j as QueueItem[])).catch(() => {});
    fetch(`/api/threads/insights?brand_id=${bid}`).then((r) => (r.ok ? r.json() : [])).then((j) => setInsights(j as Insight[])).catch(() => {});
    fetch(`/api/threads/style-guide?brand_id=${bid}`).then((r) => (r.ok ? r.json() : null)).then((j) => setStyleGuide(j?.content || null)).catch(() => {});
  }, []);
  useEffect(() => { if (brand) { loadBrand(brand.id); setTab("scraps"); setCText(""); setCCat(""); setCTopic(""); setCSchedAt(""); setCSchedMode("slot"); } }, [brand?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // 워크스페이스 폴링(큐 상태 변화 반영)
  useEffect(() => {
    if (!brand) return;
    const t = setInterval(() => { fetch(`/api/threads/queue?brand_id=${brand.id}`).then((r) => (r.ok ? r.json() : [])).then((j) => setQueue(j as QueueItem[])).catch(() => {}); }, 20_000);
    return () => clearInterval(t);
  }, [brand?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 액션 ──
  async function saveBrand() {
    if (!brandModal?.name?.trim()) { alert("브랜드 이름을 입력해 주세요."); return; }
    try {
      const payload = {
        id: brandModal.id, name: brandModal.name, persona: brandModal.persona || "", mode: brandModal.mode || "collect",
        timezone: brandModal.timezone || "Asia/Seoul", publish_slots: brandModal.publish_slots || [], max_posts_per_day: brandModal.max_posts_per_day || 3, enabled: brandModal.enabled !== false,
      };
      const j = await api("/api/threads/brands", brandModal.id ? "PATCH" : "POST", payload);
      setBrandModal(null); loadTop();
      if (!brandModal.id && j.brand?.id) setSel(j.brand.id);
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  }
  async function removeBrand(id: string) {
    if (!confirm("이 브랜드와 모든 데이터(카테고리·스크랩·큐)를 삭제할까요?")) return;
    await fetch(`/api/threads/brands?id=${id}`, { method: "DELETE" });
    setBrandModal(null); setSel("dash"); loadTop();
  }
  async function saveCat() {
    if (!catModal?.name?.trim() || !brand) { alert("카테고리 이름이 필요해요."); return; }
    try {
      await api("/api/threads/categories", catModal.id ? "PATCH" : "POST", { ...catModal, brand_id: brand.id });
      setCatModal(null); loadBrand(brand.id);
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  }
  async function removeCat(id: string) {
    if (!brand || !confirm("이 카테고리를 삭제할까요?")) return;
    await fetch(`/api/threads/categories?id=${id}`, { method: "DELETE" });
    loadBrand(brand.id);
  }
  async function seedFromScrap(s: Scrap) {
    if (!brand) return;
    setGenKey(s.key);
    try {
      const j = await api("/api/threads/generate", "POST", { brand_id: brand.id, source_key: s.key });
      setCText(j.text || ""); setCTopic(j.topic_tag || ""); if (s.category_id) setCCat(s.category_id);
      setTab("compose");
    } catch (e) { alert(e instanceof Error ? e.message : "생성 실패"); } finally { setGenKey(null); }
  }
  async function autoGenerate() {
    if (!brand) return;
    setCBusy(true);
    try {
      const j = await api("/api/threads/generate", "POST", { brand_id: brand.id, auto: true });
      if (!j.made) alert(j.reason || "생성할 hot 소재가 없어요.");
      loadBrand(brand.id);
    } catch (e) { alert(e instanceof Error ? e.message : "생성 실패"); } finally { setCBusy(false); }
  }
  async function addToQueue() {
    if (!brand) return;
    if (!cText.trim()) { alert("내용을 입력해 주세요."); return; }
    setCBusy(true);
    try {
      await api("/api/threads/queue", "POST", {
        brand_id: brand.id, text: cText, category_id: cCat || null, topic_tag: cTopic,
        // datetime-local(브라우저 로컬 KST) → 정확한 순간(ISO)으로 변환해 전송(서버 UTC 오해석 방지).
        scheduled_at: cSchedMode === "scheduled" && cSchedAt ? new Date(cSchedAt).toISOString() : null, meta: { manual: true },
      });
      setCText(""); setCTopic(""); setCSchedAt("");
      loadBrand(brand.id);
    } catch (e) { alert(e instanceof Error ? e.message : "추가 실패"); } finally { setCBusy(false); }
  }
  async function removeQueue(id: string) {
    await fetch(`/api/threads/queue?id=${id}`, { method: "DELETE" });
    if (brand) loadBrand(brand.id);
  }
  async function requeue(id: string) {
    await api("/api/threads/queue", "PATCH", { id, status: "queued" });
    if (brand) loadBrand(brand.id);
  }
  async function runAnalyze() {
    if (!brand) return;
    setAnalyzeBusy(true);
    try { const j = await api("/api/threads/analyze", "POST", { brand_id: brand.id }); if (j.guides?.[0]?.ok) { loadBrand(brand.id); alert("스타일 가이드를 갱신했어요."); } else alert(j.guides?.[0]?.error || "분석 완료(가이드 갱신 조건 미충족)"); }
    catch (e) { alert(e instanceof Error ? e.message : "분석 실패"); } finally { setAnalyzeBusy(false); }
  }
  async function resetScraps() {
    if (!brand || !confirm("이 브랜드의 수집 스크랩을 모두 지울까요?")) return;
    await fetch(`/api/threads/scraps?brand_id=${brand.id}`, { method: "DELETE" });
    loadBrand(brand.id);
  }

  // ── 파생 ──
  const shownScraps = useMemo(() => {
    let arr = scraps;
    if (scrapFilter === "hot") arr = arr.filter((s) => s.hot);
    if (scrapSearch.trim()) { const q = scrapSearch.toLowerCase(); arr = arr.filter((s) => s.title.toLowerCase().includes(q)); }
    return arr;
  }, [scraps, scrapFilter, scrapSearch]);
  const hotCount = useMemo(() => scraps.filter((s) => s.hot).length, [scraps]);
  const catTag = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.topic_tag])), [categories]);

  // 관리자 전용
  if (!authLoading && !isAdmin) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"><AtSign className="h-7 w-7 text-gray-400" /></div>
        <p className="text-sm font-semibold dark:text-gray-200">쓰레드 자동화는 관리자 전용 기능이에요</p>
        <p className="text-xs text-gray-400">필요하면 관리자에게 요청해 주세요.</p>
      </div>
    );
  }

  const agentBadge = (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${agentOnline ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"}`}
      title={agentOnline ? "수집 워커가 Threads/게시판을 크롤링해 소재를 수집 중" : "내 PC에서 threads-agent 를 실행하면 수집이 자동으로 돌아요(발행은 서버가 담당)"}>
      <Bot className="h-4 w-4" /> 수집 워커 {agentOnline == null ? "확인 중…" : agentOnline ? "온라인" : "오프라인"}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-0px)]">
      {/* 좌측 브랜드 패널 */}
      <div className="flex w-56 shrink-0 flex-col border-r bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="border-b p-3 dark:border-gray-800">
          <p className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><AtSign className="h-4 w-4 text-primary" /> 쓰레드 자동화</p>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          <button onClick={() => setSel("dash")} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${sel === "dash" ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
            <BarChart3 className="h-4 w-4" /> 대시보드
          </button>
          <p className="px-2.5 pt-2 text-[10px] font-bold uppercase text-gray-400">브랜드</p>
          {brands.map((b) => (
            <button key={b.id} onClick={() => setSel(b.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium ${sel === b.id ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
              <span className="truncate">{b.name}</span>
              {b.mode === "publish" ? <Send className="ml-auto h-3 w-3 shrink-0 text-violet-400" aria-label="발행 모드" /> : null}
            </button>
          ))}
          <button onClick={() => setBrandModal({ name: "", persona: "", mode: "collect", timezone: "Asia/Seoul", publish_slots: [], max_posts_per_day: 3, enabled: true })} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
            <Plus className="h-4 w-4" /> 브랜드 추가
          </button>
        </div>
      </div>

      {/* 우측 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loadErr && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>}

        {sel === "dash" ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100"><AtSign className="h-6 w-6 text-primary" /> 쓰레드 자동화</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">브랜드별로 화제(소재)를 수집·판정하고, 내 목소리로 초안을 만들어 Threads에 자동 발행해요.</p>
              </div>
              {agentBadge}
            </div>
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "브랜드", value: brands.length },
                { label: "발행 모드", value: brands.filter((b) => b.mode === "publish").length },
                { label: "토큰 등록", value: brands.filter((b) => b.token_ready).length },
                { label: "수집 워커", value: agentOnline ? "온라인" : "오프라인" },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="mt-1 text-2xl font-bold dark:text-gray-100">{s.value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-bold dark:text-gray-100">브랜드</h2>
              {brands.length === 0 ? (
                <p className="py-6 text-center text-xs text-gray-400">브랜드를 추가하고 카테고리(수집 소스)를 등록해 시작하세요.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {brands.map((b) => (
                    <button key={b.id} onClick={() => setSel(b.id)} className="rounded-xl border border-gray-200 p-4 text-left hover:border-primary/50 hover:shadow-sm dark:border-gray-800">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold dark:text-gray-100">{b.name}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${b.mode === "publish" ? "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300" : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>{b.mode === "publish" ? "발행" : "수집"}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-gray-400">{b.persona || "페르소나 미설정"}</p>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-gray-500">
                        <span>카테고리 {b.category_count ?? 0}</span>
                        <span className={b.token_ready ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>{b.token_ready ? "토큰 등록됨" : "토큰 미등록"}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : brand ? (
          <>
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold dark:text-gray-100">{brand.name}</h1>
                <p className="mt-0.5 text-xs text-gray-400">{brand.persona || "페르소나 미설정"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {agentBadge}
                <span className={`flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-medium ${brand.token_ready ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                  <KeyRound className="h-3.5 w-3.5" /> {brand.token_ready ? "토큰 등록됨" : "토큰 미등록"}
                </span>
              </div>
            </div>

            {/* 탭 */}
            <div className="mb-4 flex gap-1 border-b dark:border-gray-800">
              {([["scraps", "스크랩 보드"], ["compose", "발행하기"], ["insights", "내 글 성과"], ["settings", "설정"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${tab === k ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"}`}>{label}</button>
              ))}
            </div>

            {tab === "scraps" && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="flex gap-1">
                    {(["hot", "all"] as const).map((f) => (
                      <button key={f} onClick={() => setScrapFilter(f)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${scrapFilter === f ? "bg-primary text-white" : "border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300"}`}>{f === "hot" ? `🔥 hot (${hotCount})` : `전체 (${scraps.length})`}</button>
                    ))}
                  </div>
                  <input value={scrapSearch} onChange={(e) => setScrapSearch(e.target.value)} placeholder="제목 검색" className="w-48 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />
                  <button onClick={autoGenerate} disabled={cBusy} className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50" title="hot 소재로 초안을 자동 생성해 큐에 담아요">
                    {cBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} hot 소재로 초안 자동생성
                  </button>
                  <button onClick={() => loadBrand(brand.id)} className="rounded-lg border border-gray-200 p-1.5 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800" title="새로고침"><RefreshCw className="h-4 w-4" /></button>
                  <button onClick={resetScraps} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">초기화</button>
                </div>
                {shownScraps.length === 0 ? (
                  <p className="py-10 text-center text-xs text-gray-400">
                    {scraps.length === 0 ? "수집된 소재가 없어요. 설정 탭에서 카테고리(수집 소스)를 등록하고 수집 워커를 실행하세요." : "조건에 맞는 소재가 없어요. (hot 은 12시간 경과 + 반복 노출/조회 급증 소재)"}
                  </p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {shownScraps.map((s) => (
                      <div key={s.key} className="flex flex-col rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                        <div className="mb-1 flex items-center gap-1.5">
                          {s.hot && <span className="flex items-center gap-0.5 rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-bold text-orange-600 dark:bg-orange-900/40 dark:text-orange-300"><Flame className="h-3 w-3" /> HOT</span>}
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">{s.source_type === "css" ? "게시판" : "쓰레드"}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{Math.round(s.age_hours)}h</span>
                        </div>
                        <p className="line-clamp-3 flex-1 text-sm dark:text-gray-200">{s.title}</p>
                        <p className="mt-1.5 text-[11px] text-gray-400">{s.signal}{s.author ? ` · @${s.author}` : ""}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => seedFromScrap(s)} disabled={genKey === s.key} className="flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20 disabled:opacity-50">
                            {genKey === s.key ? <Loader2 className="h-3 w-3 animate-spin" /> : <PenLine className="h-3 w-3" />} 소재로 글쓰기
                          </button>
                          {s.url && <a href={s.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"><ExternalLink className="h-3 w-3" /> 원문</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "compose" && (
              <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-3 text-sm font-bold dark:text-gray-100">글 작성 → 큐에 추가</h2>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select value={cCat} onChange={(e) => { setCCat(e.target.value); if (e.target.value && catTag[e.target.value]) setCTopic(catTag[e.target.value]); }} className={inputCls}>
                        <option value="">카테고리(선택)</option>
                        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <input value={cTopic} onChange={(e) => setCTopic(e.target.value)} placeholder="토픽 태그(선택)" className={inputCls} />
                    </div>
                    <div>
                      <textarea value={cText} onChange={(e) => setCText(e.target.value.slice(0, 500))} rows={7} placeholder="Threads 글 내용(최대 500자)" className={inputCls} />
                      <p className="mt-1 text-right text-[11px] text-gray-400">{cText.length}/500</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex gap-1">
                        {(["slot", "scheduled"] as const).map((m) => (
                          <button key={m} onClick={() => setCSchedMode(m)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${cSchedMode === m ? "bg-primary text-white" : "border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300"}`}>{m === "slot" ? "다음 슬롯" : "예약"}</button>
                        ))}
                      </div>
                      {cSchedMode === "scheduled" && <input type="datetime-local" value={cSchedAt} onChange={(e) => setCSchedAt(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800" />}
                      <button onClick={addToQueue} disabled={cBusy} className="ml-auto flex items-center gap-1 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{cBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} 큐에 추가</button>
                    </div>
                    <p className="rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      {brand.mode === "publish" ? "발행 모드: 슬롯/예약 시간이 되면 서버가 자동으로 Threads에 발행해요." : "이 브랜드는 수집 모드예요. 자동 발행하려면 설정에서 '발행 모드'로 바꾸고 토큰을 등록하세요."}
                      {!brand.token_ready && " (Threads 토큰 미등록 — 설정 탭 참고)"}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <h3 className="mb-2 text-sm font-bold dark:text-gray-100">발행 큐 ({queue.filter((q) => q.status === "queued" || q.status === "publishing").length})</h3>
                    {queue.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">큐가 비어 있어요.</p> : (
                      <div className="max-h-[520px] space-y-2 overflow-y-auto">
                        {queue.map((q) => (
                          <div key={q.id} className="rounded-lg border border-gray-100 p-2.5 dark:border-gray-800">
                            <div className="mb-1 flex items-center gap-1.5">
                              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${QSTATUS[q.status].cls}`}>{QSTATUS[q.status].label}</span>
                              {q.scheduled_at && <span className="text-[10px] text-gray-400">예약 {new Date(q.scheduled_at).toLocaleString("ko-KR")}</span>}
                              {q.status === "failed" && <button onClick={() => requeue(q.id)} className="text-[10px] text-blue-500 hover:underline">재시도</button>}
                              <button onClick={() => removeQueue(q.id)} className="ml-auto text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                            <p className="line-clamp-2 text-xs dark:text-gray-300">{q.text}</p>
                            {q.error && <p className="mt-1 text-[10px] text-red-500">{q.error.slice(0, 80)}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {tab === "insights" && (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-sm font-bold dark:text-gray-100">내 글 성과 <span className="ml-1 text-[11px] font-normal text-gray-400">— 최근 14일 발행 글(6시간마다 스냅샷)</span></h2>
                </div>
                {insights.length === 0 ? (
                  <p className="py-8 text-center text-xs text-gray-400">아직 성과 데이터가 없어요. 토큰을 등록하고 발행하면 자동으로 수집돼요.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead><tr className="border-b text-left text-[11px] text-gray-400 dark:border-gray-800">
                        <th className="py-1.5 pr-2 font-medium">글</th><th className="py-1.5 pr-2 font-medium">조회</th><th className="py-1.5 pr-2 font-medium">좋아요</th><th className="py-1.5 pr-2 font-medium">답글</th><th className="py-1.5 pr-2 font-medium">리포스트</th><th className="py-1.5 font-medium">링크</th>
                      </tr></thead>
                      <tbody className="dark:text-gray-300">
                        {insights.map((p) => (
                          <tr key={p.media_id} className="border-b last:border-0 dark:border-gray-800">
                            <td className="max-w-[360px] truncate py-2 pr-2 dark:text-gray-200">{p.text || "(내용 없음)"}</td>
                            <td className="py-2 pr-2"><span className="flex items-center gap-1"><Eye className="h-3 w-3 text-sky-500" /> {fmtN(p.views)}</span></td>
                            <td className="py-2 pr-2"><span className="flex items-center gap-1"><Heart className="h-3 w-3 text-rose-500" /> {fmtN(p.likes)}</span></td>
                            <td className="py-2 pr-2"><span className="flex items-center gap-1"><MessageCircle className="h-3 w-3 text-amber-500" /> {fmtN(p.replies)}</span></td>
                            <td className="py-2 pr-2"><span className="flex items-center gap-1"><Repeat2 className="h-3 w-3 text-emerald-500" /> {fmtN(p.reposts)}</span></td>
                            <td className="py-2">{p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {tab === "settings" && (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                {/* 브랜드 설정 */}
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <div className="mb-3 flex items-center justify-between">
                      <h2 className="text-sm font-bold dark:text-gray-100">브랜드 설정</h2>
                      <button onClick={() => setBrandModal(brand)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Settings2 className="h-3.5 w-3.5" /> 편집</button>
                    </div>
                    <dl className="space-y-1.5 text-xs">
                      <div className="flex justify-between"><dt className="text-gray-400">모드</dt><dd className="font-medium dark:text-gray-200">{brand.mode === "publish" ? "발행" : "수집"}</dd></div>
                      <div className="flex justify-between"><dt className="text-gray-400">타임존</dt><dd className="dark:text-gray-200">{brand.timezone}</dd></div>
                      <div className="flex justify-between"><dt className="text-gray-400">발행 슬롯</dt><dd className="dark:text-gray-200">{(brand.publish_slots || []).join(", ") || "—"}</dd></div>
                      <div className="flex justify-between"><dt className="text-gray-400">하루 최대</dt><dd className="dark:text-gray-200">{brand.max_posts_per_day}개</dd></div>
                    </dl>
                  </div>

                  {/* 토큰 안내 */}
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <h2 className="mb-2 flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><KeyRound className="h-4 w-4 text-primary" /> Threads 토큰</h2>
                    {brand.token_ready ? (
                      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" /> 등록됨 — 서버에서 자동 발행/성과수집이 동작해요.</p>
                    ) : (
                      <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
                        <p>이 브랜드로 발행하려면 Vercel 환경변수에 아래 이름으로 장기 토큰(60일)을 등록하세요.</p>
                        <code className="block rounded bg-gray-100 px-2 py-1 font-mono text-[11px] dark:bg-gray-800 dark:text-gray-200">{brand.token_env || `THREADS_TOKEN_${brand.id.toUpperCase()}`}</code>
                        <p className="text-[11px]">토큰 발급: Meta 개발자 콘솔 → Threads API(권한: threads_basic, threads_content_publish, threads_manage_insights) → 장기 토큰 교환.</p>
                      </div>
                    )}
                  </div>

                  {/* 스타일 가이드 */}
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                    <div className="mb-2 flex items-center justify-between">
                      <h2 className="text-sm font-bold dark:text-gray-100">스타일 가이드 <span className="ml-1 text-[11px] font-normal text-gray-400">— 내 글 성과로 AI가 학습</span></h2>
                      <button onClick={runAnalyze} disabled={analyzeBusy} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">{analyzeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 분석 실행</button>
                    </div>
                    {styleGuide ? <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">{styleGuide}</pre> : <p className="py-3 text-center text-xs text-gray-400">아직 가이드가 없어요. 내 글이 3개 이상 쌓이면 [분석 실행]으로 생성돼요.</p>}
                  </div>

                  <button onClick={() => removeBrand(brand.id)} className="text-xs font-medium text-red-500 hover:underline">이 브랜드 삭제</button>
                </div>

                {/* 카테고리(수집 소스) */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-bold dark:text-gray-100">카테고리 <span className="ml-1 text-[11px] font-normal text-gray-400">— 수집 소스</span></h2>
                    <button onClick={() => setCatModal({ type: "threads_topic", name: "", keyword: "", topic_tag: "", url: "", preset: "" })} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white"><Plus className="h-3.5 w-3.5" /> 추가</button>
                  </div>
                  {categories.length === 0 ? <p className="py-4 text-center text-xs text-gray-400">카테고리를 추가하면 수집 워커가 해당 소스를 크롤링해요.</p> : (
                    <div className="divide-y dark:divide-gray-800">
                      {categories.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 py-2">
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${c.type === "css" ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300" : "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300"}`}>{c.type === "css" ? "게시판" : "쓰레드"}</span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium dark:text-gray-200">{c.name}</p>
                            <p className="truncate text-[11px] text-gray-400">{c.type === "css" ? c.url : c.keyword}{c.topic_tag ? ` · #${c.topic_tag}` : ""}</p>
                          </div>
                          <button onClick={() => setCatModal(c)} className="text-gray-400 hover:text-primary"><Settings2 className="h-3.5 w-3.5" /></button>
                          <button onClick={() => removeCat(c.id)} className="text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* 브랜드 모달 */}
      {brandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBrandModal(null)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold dark:text-gray-100">{brandModal.id ? "브랜드 설정" : "브랜드 추가"}</h3>
              <button onClick={() => setBrandModal(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">이름 *</label><input value={brandModal.name || ""} onChange={(e) => setBrandModal({ ...brandModal, name: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">ID(영문, 토큰명){brandModal.id ? "" : " · 자동"}</label><input value={brandModal.id || ""} disabled={!!brandModal.id} onChange={(e) => setBrandModal({ ...brandModal, id: e.target.value })} placeholder="main" className={`${inputCls} disabled:opacity-60`} /></div>
              </div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">페르소나</label><textarea value={brandModal.persona || ""} onChange={(e) => setBrandModal({ ...brandModal, persona: e.target.value })} rows={3} placeholder="이 브랜드가 Threads에서 활동하는 톤/인물상" className={inputCls} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">모드</label>
                  <select value={brandModal.mode || "collect"} onChange={(e) => setBrandModal({ ...brandModal, mode: e.target.value as "collect" | "publish" })} className={inputCls}><option value="collect">수집만</option><option value="publish">발행</option></select>
                </div>
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">타임존</label><input value={brandModal.timezone || "Asia/Seoul"} onChange={(e) => setBrandModal({ ...brandModal, timezone: e.target.value })} className={inputCls} /></div>
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">발행 슬롯(쉼표, HH:MM)</label><input value={(brandModal.publish_slots || []).join(", ")} onChange={(e) => setBrandModal({ ...brandModal, publish_slots: e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) })} placeholder="08:00, 12:30, 20:00" className={inputCls} /></div>
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">하루 최대 발행</label><input type="number" min={1} max={50} value={brandModal.max_posts_per_day ?? 3} onChange={(e) => setBrandModal({ ...brandModal, max_posts_per_day: Number(e.target.value) })} className={inputCls} /></div>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={brandModal.enabled !== false} onChange={(e) => setBrandModal({ ...brandModal, enabled: e.target.checked })} /> 활성화</label>
            </div>
            <div className="flex items-center justify-between border-t p-4 dark:border-gray-800">
              {brandModal.id ? <button onClick={() => removeBrand(brandModal.id!)} className="text-xs font-medium text-red-500 hover:underline">삭제</button> : <span />}
              <button onClick={saveBrand} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">{brandModal.id ? "저장" : "추가"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 카테고리 모달 */}
      {catModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCatModal(null)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold dark:text-gray-100">{catModal.id ? "카테고리 설정" : "카테고리 추가"}</h3>
              <button onClick={() => setCatModal(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">이름 *</label><input value={catModal.name || ""} onChange={(e) => setCatModal({ ...catModal, name: e.target.value })} className={inputCls} /></div>
              <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">타입</label>
                <select value={catModal.type || "threads_topic"} onChange={(e) => setCatModal({ ...catModal, type: e.target.value as "threads_topic" | "css" })} className={inputCls}><option value="threads_topic">쓰레드 토픽(키워드)</option><option value="css">외부 게시판(css)</option></select>
              </div>
              {catModal.type === "css" ? (
                <>
                  <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">게시판 URL</label><input value={catModal.url || ""} onChange={(e) => setCatModal({ ...catModal, url: e.target.value })} placeholder="https://..." className={inputCls} /></div>
                  <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">프리셋(선택)</label><input value={catModal.preset || ""} onChange={(e) => setCatModal({ ...catModal, preset: e.target.value })} placeholder="예: dcinside" className={inputCls} /></div>
                </>
              ) : (
                <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">검색 키워드</label><input value={catModal.keyword || ""} onChange={(e) => setCatModal({ ...catModal, keyword: e.target.value })} placeholder="예: 마케팅" className={inputCls} /></div>
              )}
              <div><label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">토픽 태그(발행 시 붙임)</label><input value={catModal.topic_tag || ""} onChange={(e) => setCatModal({ ...catModal, topic_tag: e.target.value })} placeholder="예: 마케팅" className={inputCls} /></div>
            </div>
            <div className="flex items-center justify-between border-t p-4 dark:border-gray-800">
              {catModal.id ? <button onClick={() => removeCat(catModal.id!)} className="text-xs font-medium text-red-500 hover:underline">삭제</button> : <span />}
              <button onClick={saveCat} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">{catModal.id ? "저장" : "추가"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
