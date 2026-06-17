"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Megaphone,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  FileDown,
  Sparkles,
  X,
  Pencil,
  Trash2,
  Power,
  Plus,
  Loader2,
} from "lucide-react";

type Target = {
  id: string;
  label: string;
  category: string | null;
  type: "page" | "keyword";
  page_id: string | null;
  query: string | null;
  country: string;
  enabled: boolean;
};

type Ad = {
  library_id: string;
  target_id: string | null;
  page_name: string | null;
  started_on: string | null;
  ad_text: string | null;
  media_type: string | null;
  media_url: string | null;
  first_seen_at: string;
};

const PAGE_SIZE = 12;

function parsePageId(input: string): string {
  const m = input.match(/view_all_page_id=(\d+)/);
  if (m) return m[1];
  const onlyDigits = input.trim();
  return /^\d+$/.test(onlyDigits) ? onlyDigits : input.trim();
}

function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 3600 * 1000;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
}

function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  if (current > 4) items.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++)
    items.push(p);
  if (current < total - 3) items.push("…");
  items.push(total);
  return items;
}

export default function MetaAdCrawlerPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [page, setPage] = useState(1);

  // AI 요약
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // 설정 모달
  const [showSettings, setShowSettings] = useState(false);

  // 추가 폼
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState<"page" | "keyword">("page");
  const [pageInput, setPageInput] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("KR");

  // 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Target> & { pageInput?: string }>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [tRes, sRes, aRes] = await Promise.all([
      fetch("/api/meta-ad/targets"),
      fetch("/api/meta-ad/stats"),
      fetch("/api/meta-ad/ads?limit=500"),
    ]);
    if (tRes.ok) setTargets(await tRes.json());
    if (sRes.ok) setCounts((await sRes.json()).counts ?? {});
    if (aRes.ok) setAds(await aRes.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // 매핑
  const targetCategory = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of targets) m[t.id] = (t.category || "").trim() || "미분류";
    return m;
  }, [targets]);
  const targetLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of targets) m[t.id] = t.label;
    return m;
  }, [targets]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of targets) set.add((t.category || "").trim() || "미분류");
    return Array.from(set).sort();
  }, [targets]);

  // 현재 카테고리에 속한 브랜드 (드롭다운용)
  const brandsInCategory = useMemo(() => {
    return targets.filter(
      (t) => activeCategory === "all" || targetCategory[t.id] === activeCategory
    );
  }, [targets, activeCategory, targetCategory]);

  function brandNameOfAd(ad: Ad): string {
    return ad.page_name || (ad.target_id ? targetLabel[ad.target_id] : "") || "—";
  }

  // 필터링된 광고
  const filteredAds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((ad) => {
      if (activeCategory !== "all") {
        if (!ad.target_id || targetCategory[ad.target_id] !== activeCategory)
          return false;
      }
      if (selectedBrand !== "all" && ad.target_id !== selectedBrand) return false;
      if (q && !brandNameOfAd(ad).toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, search, activeCategory, selectedBrand, targetCategory, targetLabel]);

  const pageCount = Math.max(1, Math.ceil(filteredAds.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageAds = filteredAds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetToFirst() {
    setPage(1);
    setSummary(null);
  }

  // ── 관리(설정) 동작 ──
  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    const body =
      type === "page"
        ? { label, category, type, page_id: parsePageId(pageInput), country }
        : { label, category, type, query, country };
    const res = await fetch("/api/meta-ad/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert("추가 실패: " + (j.error ?? res.status));
      return;
    }
    setLabel("");
    setCategory("");
    setPageInput("");
    setQuery("");
    loadAll();
  }

  async function patchTarget(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/meta-ad/targets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    loadAll();
  }

  function startEdit(t: Target) {
    setEditingId(t.id);
    setEdit({
      label: t.label,
      category: t.category ?? "",
      type: t.type,
      pageInput: t.page_id ?? "",
      query: t.query ?? "",
      country: t.country,
    });
  }

  async function saveEdit(id: string) {
    const patch: Record<string, unknown> = {
      label: edit.label,
      category: edit.category,
      type: edit.type,
      country: edit.country,
    };
    if (edit.type === "page") patch.page_id = parsePageId(edit.pageInput ?? "");
    else patch.query = edit.query;
    await patchTarget(id, patch);
    setEditingId(null);
  }

  async function remove(t: Target) {
    if (!confirm(`'${t.label}' 삭제할까요? (쌓인 광고는 유지됩니다)`)) return;
    await fetch(`/api/meta-ad/targets/${t.id}`, { method: "DELETE" });
    if (selectedBrand === t.id) setSelectedBrand("all");
    loadAll();
  }

  async function summarize() {
    setSummarizing(true);
    setSummary(null);
    const res = await fetch("/api/meta-ad/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: selectedBrand === "all" ? null : selectedBrand }),
    });
    const j = await res.json().catch(() => ({}));
    setSummary(res.ok ? j.summary : "요약 실패: " + (j.error ?? res.status));
    setSummarizing(false);
  }

  function exportCsv() {
    const header = [
      "library_id",
      "page_name",
      "started_on",
      "media_type",
      "media_url",
      "first_seen_at",
      "ad_text",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filteredAds.map((a) =>
      [
        a.library_id,
        brandNameOfAd(a),
        a.started_on,
        a.media_type,
        a.media_url,
        a.first_seen_at,
        a.ad_text,
      ]
        .map(esc)
        .join(",")
    );
    const blob = new Blob(["﻿" + [header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 설정 모달용 카테고리 그룹
  const groups: Record<string, Target[]> = {};
  for (const t of targets) {
    const key = (t.category || "").trim() || "미분류";
    (groups[key] ||= []).push(t);
  }

  return (
    <div className="max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold dark:text-white">
            <Megaphone className="h-6 w-6 text-primary" />
            메타 광고 크롤러
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            매일 자동 수집된 경쟁사 광고를 한눈에. 대분류로 묶어 분석합니다.
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Settings className="h-4 w-4" />
          설정
        </button>
      </div>

      {/* 검색 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            resetToFirst();
          }}
          placeholder="업체명을 입력해 주세요"
          className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-2.5 pl-10 pr-4 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {/* 카테고리 칩 + 브랜드 드롭다운 */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex flex-wrap gap-2">
          <Chip
            active={activeCategory === "all"}
            onClick={() => {
              setActiveCategory("all");
              setSelectedBrand("all");
              resetToFirst();
            }}
          >
            모든 광고
          </Chip>
          {categories.map((c) => (
            <Chip
              key={c}
              active={activeCategory === c}
              onClick={() => {
                setActiveCategory(c);
                setSelectedBrand("all");
                resetToFirst();
              }}
            >
              {c}
            </Chip>
          ))}
        </div>

        <select
          value={selectedBrand}
          onChange={(e) => {
            setSelectedBrand(e.target.value);
            resetToFirst();
          }}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm dark:text-gray-200"
        >
          <option value="all">전체 브랜드</option>
          {brandsInCategory.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label} ({counts[t.id] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {/* 툴바 */}
      <div className="flex items-center justify-between mb-3">
        <strong className="text-sm dark:text-gray-200">
          {loading ? "불러오는 중..." : `광고 ${filteredAds.length}건`}
        </strong>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            disabled={filteredAds.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" />
            CSV
          </button>
          <button
            onClick={summarize}
            disabled={summarizing || filteredAds.length === 0}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {summarizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            AI 요약
          </button>
        </div>
      </div>

      {summary && (
        <div className="mb-4 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 text-sm whitespace-pre-wrap leading-relaxed dark:text-gray-200">
          {summary}
        </div>
      )}

      {/* 광고 그리드 */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
        </div>
      ) : pageAds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Megaphone className="h-12 w-12 text-gray-200 dark:text-gray-700 mb-3" />
          <p className="text-gray-400 dark:text-gray-500">
            {ads.length === 0
              ? "아직 수집된 광고가 없습니다. 크롤러가 한 번 실행되면 채워집니다."
              : "조건에 맞는 광고가 없습니다."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {pageAds.map((ad) => {
              const brand = brandNameOfAd(ad);
              return (
                <div
                  key={ad.library_id}
                  className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col"
                >
                  <div className="p-2.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ backgroundColor: colorFromString(brand) }}
                      >
                        {brand.slice(0, 1).toUpperCase()}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-xs font-bold dark:text-gray-100">
                        {brand}
                      </span>
                      {ad.media_type && (
                        <span
                          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                            ad.media_type === "video"
                              ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {ad.media_type === "video" ? "영상" : "이미지"}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] leading-tight text-gray-400">
                      확인일시: {fmtDate(ad.first_seen_at)}
                      <br />
                      ID: {ad.library_id}
                    </div>
                  </div>

                  <div className="relative aspect-square bg-gray-100 dark:bg-gray-800">
                    {isNew(ad.first_seen_at) && (
                      <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">
                        신규
                      </span>
                    )}
                    {ad.media_type === "video" && ad.media_url ? (
                      <video src={ad.media_url} muted className="h-full w-full object-cover" />
                    ) : ad.media_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ad.media_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
                        <Megaphone className="h-7 w-7" />
                      </div>
                    )}
                  </div>

                  {ad.ad_text && (
                    <div className="p-2.5 text-[11px] leading-snug text-gray-600 dark:text-gray-400 line-clamp-3">
                      {ad.ad_text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 페이지네이션 */}
          {pageCount > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageItems(safePage, pageCount).map((it, i) =>
                it === "…" ? (
                  <span key={`e${i}`} className="px-2 text-gray-400">
                    …
                  </span>
                ) : (
                  <button
                    key={it}
                    onClick={() => setPage(it)}
                    className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium ${
                      it === safePage
                        ? "bg-primary text-white"
                        : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {it}
                  </button>
                )
              )}
              <button
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage === pageCount}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* 설정 모달 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 shadow-xl">
            <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3.5">
              <h2 className="text-base font-bold dark:text-white">브랜드 관리 · 설정</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-5">
              {/* 추가 폼 */}
              <form onSubmit={addTarget} className="rounded-xl border dark:border-gray-800 p-4">
                <div className="mb-2 text-sm font-bold dark:text-gray-200 flex items-center gap-1.5">
                  <Plus className="h-4 w-4" /> 브랜드 추가
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    placeholder="브랜드 이름"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="flex-1 min-w-[140px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                  />
                  <input
                    placeholder="대분류 (예: 화장품)"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-36 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                  />
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as "page" | "keyword")}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm dark:text-gray-200"
                  >
                    <option value="page">페이지</option>
                    <option value="keyword">키워드</option>
                  </select>
                  {type === "page" ? (
                    <input
                      placeholder="광고 라이브러리 URL 또는 page_id"
                      value={pageInput}
                      onChange={(e) => setPageInput(e.target.value)}
                      className="flex-[2] min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                    />
                  ) : (
                    <input
                      placeholder="검색어"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      className="flex-[2] min-w-[200px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                    />
                  )}
                  <input
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    title="국가코드"
                    className="w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm dark:text-gray-200"
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                  >
                    추가
                  </button>
                </div>
              </form>

              {/* 브랜드 목록 (대분류별) */}
              <div>
                <div className="mb-2 text-sm font-bold dark:text-gray-200">
                  추적 중인 브랜드 {targets.length > 0 && `(${targets.length})`}
                </div>
                {targets.length === 0 && (
                  <p className="text-sm text-gray-400">아직 없음 — 위에서 추가하세요.</p>
                )}
                {Object.keys(groups)
                  .sort()
                  .map((cat) => (
                    <div key={cat} className="mb-3">
                      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">
                        {cat}
                      </div>
                      {groups[cat].map((t) =>
                        editingId === t.id ? (
                          <div
                            key={t.id}
                            className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-primary/5 p-2"
                          >
                            <input
                              value={edit.label ?? ""}
                              onChange={(e) => setEdit({ ...edit, label: e.target.value })}
                              placeholder="이름"
                              className="flex-1 min-w-[110px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                            />
                            <input
                              value={edit.category ?? ""}
                              onChange={(e) => setEdit({ ...edit, category: e.target.value })}
                              placeholder="대분류"
                              className="w-28 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                            />
                            <select
                              value={edit.type}
                              onChange={(e) =>
                                setEdit({ ...edit, type: e.target.value as "page" | "keyword" })
                              }
                              className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                            >
                              <option value="page">페이지</option>
                              <option value="keyword">키워드</option>
                            </select>
                            {edit.type === "page" ? (
                              <input
                                value={edit.pageInput ?? ""}
                                onChange={(e) => setEdit({ ...edit, pageInput: e.target.value })}
                                placeholder="URL 또는 page_id"
                                className="flex-1 min-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                              />
                            ) : (
                              <input
                                value={edit.query ?? ""}
                                onChange={(e) => setEdit({ ...edit, query: e.target.value })}
                                placeholder="검색어"
                                className="flex-1 min-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                              />
                            )}
                            <input
                              value={edit.country ?? "KR"}
                              onChange={(e) => setEdit({ ...edit, country: e.target.value })}
                              className="w-14 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200"
                            />
                            <button
                              onClick={() => saveEdit(t.id)}
                              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white"
                            >
                              저장
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300"
                            >
                              취소
                            </button>
                          </div>
                        ) : (
                          <div
                            key={t.id}
                            className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 p-2"
                          >
                            <span className="flex-1 min-w-0 truncate text-sm dark:text-gray-200">
                              {t.enabled ? "🟢" : "⚪"} {t.label}
                            </span>
                            <span className="rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">
                              {counts[t.id] ?? 0}건
                            </span>
                            <button
                              onClick={() => startEdit(t)}
                              className="rounded p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800"
                              title="편집"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => patchTarget(t.id, { enabled: !t.enabled })}
                              className={`rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${
                                t.enabled ? "text-green-600" : "text-gray-400"
                              }`}
                              title={t.enabled ? "끄기" : "켜기"}
                            >
                              <Power className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => remove(t)}
                              className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                              title="삭제"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-white"
          : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      {children}
    </button>
  );
}
