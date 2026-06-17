"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Megaphone,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  FileDown,
  X,
  Pencil,
  Trash2,
  Power,
  Plus,
  Loader2,
  Sparkles,
  ExternalLink,
  Save,
  Check,
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
  profile_image?: string | null;
  profile_name?: string | null;
  summary?: string | null;
};

type Ad = {
  library_id: string;
  target_id: string | null;
  page_name: string | null;
  started_on: string | null;
  ad_text: string | null;
  media_type: string | null;
  media_url: string | null;
  media_urls?: string[] | null;
  landing_url?: string | null;
  status?: string | null;
  ended_at?: string | null;
  memo?: string | null;
  ai_analysis?: string | null;
  first_seen_at: string;
  last_seen_at?: string | null;
};

const PAGE_SIZE = 15;

const CATEGORIES = [
  "뷰티 & 에어케어",
  "패션 & 의류",
  "음식 & 음료",
  "리빙 & 인테리어",
  "육아 & 동물",
  "의료 & 건강",
  "교육 & 강의",
  "IT & 전자기기",
  "기타",
];

function parsePageId(input: string): string {
  const m = input.match(/view_all_page_id=(\d+)/);
  if (m) return m[1];
  const onlyDigits = input.trim();
  return /^\d+$/.test(onlyDigits) ? onlyDigits : input.trim();
}

function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 3600 * 1000;
}

function fmtDate(iso: string | null | undefined): string {
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

function mediaListOf(ad: Ad): string[] {
  if (Array.isArray(ad.media_urls) && ad.media_urls.length) return ad.media_urls.filter(Boolean) as string[];
  if (ad.media_url) return [ad.media_url];
  return [];
}

function activeDays(ad: Ad): number {
  const a = ad.first_seen_at ? new Date(ad.first_seen_at).getTime() : 0;
  const b = ad.last_seen_at ? new Date(ad.last_seen_at).getTime() : Date.now();
  if (!a) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function sourceLink(ad: Ad): string {
  return `https://www.facebook.com/ads/library/?id=${ad.library_id}`;
}

// 스크랩된 ad_text 에서 보일러플레이트(활성/라이브러리ID/게재시작/플랫폼/광고 라벨/CTA 등)를 제거하고
// 실제 제목·캡션만 남긴다. (우측 메타데이터와 중복되는 정보 제거)
const CAPTION_DROP = [
  /^활성$/, /^비활성$/, /게재\s*중단/,
  /^라이브러리\s*ID/i, /^library\s*id/i,
  /게재\s*시작(함|일)/, /^started running/i,
  /^플랫폼$/, /^platforms?$/i,
  /^드롭다운/, /드롭다운\s*열기/, /^see ad details$/i, /광고\s*상세\s*정보\s*보기/,
  /여러\s*버전이\s*있는\s*광고/i, /multiple versions/i,
  /^광고$/, /^sponsored$/i,
  /^(learn more|shop now|sign up|book now|order now|get offer|download|더\s*알아보기|자세히\s*알아보기|지금\s*구매하기|구매하기|신청하기|문의하기|예약하기|주문하기|앱\s*설치하기|지금\s*받기|쇼핑하기)$/i,
];

function cleanCaption(text: string | null | undefined, brandName: string): string {
  if (!text) return "—";
  const lines = text
    .replace(/[​-‍⁠﻿ ]/g, " ") // 제로폭/비가시 공백 → 일반 공백
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === brandName) continue;
    if (CAPTION_DROP.some((re) => re.test(l))) continue;
    // 광고주명 라인(바로 다음 줄이 '광고'/'Sponsored') 제거
    if (i + 1 < lines.length && /^(광고|sponsored)$/i.test(lines[i + 1])) continue;
    kept.push(l);
  }
  return kept.join("\n").trim() || "—";
}

function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  if (current > 4) items.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) items.push(p);
  if (current < total - 3) items.push("…");
  items.push(total);
  return items;
}

/* ── 미디어 뷰: 영상 재생 / 캐러셀 슬라이드 / 이미지 ── */
function MediaView({ ad, rounded }: { ad: Ad; rounded?: string }) {
  const urls = mediaListOf(ad);
  const [idx, setIdx] = useState(0);
  const r = rounded ?? "";

  if (ad.media_type === "video" && ad.media_url) {
    return (
      <video
        src={ad.media_url}
        controls
        playsInline
        onClick={(e) => e.stopPropagation()}
        className={`h-full w-full bg-black object-cover ${r}`}
      />
    );
  }
  if (urls.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800 ${r}`}>
        <Megaphone className="h-7 w-7 text-gray-300 dark:text-gray-600" />
      </div>
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden bg-gray-100 dark:bg-gray-800 ${r}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[idx]} alt="" className="h-full w-full object-cover" />
      {urls.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i - 1 + urls.length) % urls.length);
            }}
            className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIdx((i) => (i + 1) % urls.length);
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">
            {idx + 1} / {urls.length}
          </span>
        </>
      )}
    </div>
  );
}

export default function MetaAdCrawlerPage() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedBrand, setSelectedBrand] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Ad | null>(null);

  // 브랜드 관리 모달
  const [showSettings, setShowSettings] = useState(false);
  const [brandMgmtSearch, setBrandMgmtSearch] = useState("");

  // 추가 폼
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState<"page" | "keyword">("page");
  const [pageInput, setPageInput] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("KR");
  const [previewing, setPreviewing] = useState(false);
  const [previewFocus, setPreviewFocus] = useState<string | null>(null);

  // 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Target> & { pageInput?: string }>({});

  const categorizedRef = useRef(false);

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

  // 백엔드 자동 대분류 + 한 줄 요약: 광고가 쌓였는데 대분류가 '미분류'거나 요약이 없는 브랜드 처리.
  // 비용/부하 방지를 위해 방문당 최대 12개씩만 채우고, 다음 방문에 이어서 채운다.
  useEffect(() => {
    if (categorizedRef.current || loading) return;
    const todo = targets
      .filter(
        (t) =>
          (counts[t.id] || 0) > 0 &&
          (!(t.category || "").trim() || t.category === "미분류" || !(t.summary || "").trim())
      )
      .slice(0, 12);
    if (todo.length === 0) return;
    categorizedRef.current = true;
    (async () => {
      for (const t of todo) {
        try {
          await fetch("/api/meta-ad/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_id: t.id }),
          });
        } catch {}
      }
      const tRes = await fetch("/api/meta-ad/targets");
      if (tRes.ok) setTargets(await tRes.json());
    })();
  }, [loading, targets, counts]);

  const targetMap = useMemo(() => {
    const m: Record<string, Target> = {};
    for (const t of targets) m[t.id] = t;
    return m;
  }, [targets]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of targets) set.add((t.category || "").trim() || "미분류");
    return Array.from(set).sort();
  }, [targets]);

  const brandsInCategory = useMemo(
    () =>
      targets.filter(
        (t) => activeCategory === "all" || ((t.category || "").trim() || "미분류") === activeCategory
      ),
    [targets, activeCategory]
  );

  function brandNameOfAd(ad: Ad): string {
    const t = ad.target_id ? targetMap[ad.target_id] : undefined;
    return t?.profile_name || t?.label || ad.page_name || "—";
  }
  function brandImageOfAd(ad: Ad): string | null {
    const t = ad.target_id ? targetMap[ad.target_id] : undefined;
    return t?.profile_image || null;
  }

  const filteredAds = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ads.filter((ad) => {
      const cat = ad.target_id ? (targetMap[ad.target_id]?.category || "").trim() || "미분류" : "미분류";
      if (activeCategory !== "all" && cat !== activeCategory) return false;
      if (selectedBrand !== "all" && ad.target_id !== selectedBrand) return false;
      if (q && !brandNameOfAd(ad).toLowerCase().includes(q)) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, search, activeCategory, selectedBrand, targetMap]);

  const pageCount = Math.max(1, Math.ceil(filteredAds.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageAds = filteredAds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetToFirst() {
    setPage(1);
  }

  // ── 관리(설정) ──
  async function handlePreview() {
    const name = label.trim();
    const url = pageInput.trim();
    if (!name && !url) {
      alert("브랜드 이름이나 광고 라이브러리 URL을 입력해주세요.");
      return;
    }
    setPreviewing(true);
    setPreviewFocus(null);
    try {
      const res = await fetch("/api/meta-ad/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("분석 실패: " + (j.error ?? res.status));
        return;
      }
      setPreviewFocus(j.focus || "분석 결과가 없습니다.");
      if (j.category) setCategory(j.category);
    } finally {
      setPreviewing(false);
    }
  }

  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    const bodyData =
      type === "page"
        ? { label, category, type, page_id: parsePageId(pageInput), country }
        : { label, category, type, query, country };
    const res = await fetch("/api/meta-ad/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
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
    setPreviewFocus(null);
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

  function exportCsv() {
    const header = ["library_id", "page_name", "started_on", "status", "media_type", "media_url", "landing_url", "first_seen_at", "last_seen_at", "memo", "ad_text"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = filteredAds.map((a) =>
      [a.library_id, brandNameOfAd(a), a.started_on, a.status, a.media_type, a.media_url, a.landing_url, a.first_seen_at, a.last_seen_at, a.memo, a.ad_text]
        .map(esc)
        .join(",")
    );
    const blob = new Blob(["﻿" + [header.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onMemoSaved(libraryId: string, memo: string) {
    setAds((prev) => prev.map((a) => (a.library_id === libraryId ? { ...a, memo } : a)));
    setDetail((d) => (d && d.library_id === libraryId ? { ...d, memo } : d));
  }

  function onAdAnalyzed(libraryId: string, ai_analysis: string) {
    setAds((prev) => prev.map((a) => (a.library_id === libraryId ? { ...a, ai_analysis } : a)));
    setDetail((d) => (d && d.library_id === libraryId ? { ...d, ai_analysis } : d));
  }

  // 브랜드 관리 모달: 검색어로 거른 뒤 대분류별 그룹핑 (브랜드 50~100개 관리용)
  const mgmtQuery = brandMgmtSearch.trim().toLowerCase();
  const groups: Record<string, Target[]> = {};
  for (const t of targets) {
    const name = (t.profile_name || t.label || "").toLowerCase();
    if (mgmtQuery && !name.includes(mgmtQuery)) continue;
    const key = (t.category || "").trim() || "미분류";
    (groups[key] ||= []).push(t);
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* 헤더 */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold dark:text-white">
            <Megaphone className="h-6 w-6 text-primary" />
            메타 광고 크롤러
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            5일마다 자동 수집된 경쟁사 광고를 한눈에. 대분류로 묶어 분석합니다.
          </p>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
        >
          <Settings className="h-4 w-4" />
          브랜드 관리
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
          <Chip active={activeCategory === "all"} onClick={() => { setActiveCategory("all"); setSelectedBrand("all"); resetToFirst(); }}>
            모든 광고
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={activeCategory === c} onClick={() => { setActiveCategory(c); setSelectedBrand("all"); resetToFirst(); }}>
              {c}
            </Chip>
          ))}
        </div>
        <select
          value={selectedBrand}
          onChange={(e) => { setSelectedBrand(e.target.value); resetToFirst(); }}
          className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm dark:text-gray-200"
        >
          <option value="all">전체 브랜드</option>
          {brandsInCategory.map((t) => (
            <option key={t.id} value={t.id}>
              {t.profile_name || t.label} ({counts[t.id] ?? 0})
            </option>
          ))}
        </select>
      </div>

      {/* 툴바 */}
      <div className="flex items-center justify-between mb-3">
        <strong className="text-sm dark:text-gray-200">{loading ? "불러오는 중..." : `광고 ${filteredAds.length}건`}</strong>
        <button
          onClick={exportCsv}
          disabled={filteredAds.length === 0}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
        >
          <FileDown className="h-4 w-4" />
          CSV
        </button>
      </div>

      {/* 광고 그리드 (5열 / 15개) */}
      {loading ? (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-7 w-7 animate-spin text-gray-400" />
        </div>
      ) : pageAds.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Megaphone className="h-12 w-12 text-gray-200 dark:text-gray-700 mb-3" />
          <p className="text-gray-400 dark:text-gray-500">
            {ads.length === 0 ? "아직 수집된 광고가 없습니다. 크롤러가 한 번 실행되면 채워집니다." : "조건에 맞는 광고가 없습니다."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {pageAds.map((ad) => {
              const brand = brandNameOfAd(ad);
              const img = brandImageOfAd(ad);
              const ended = ad.status === "ended";
              const days = activeDays(ad);
              const typeLabel = ad.media_type === "video" ? "영상" : ad.media_type === "carousel" || (ad.media_urls && ad.media_urls.length > 1) ? "슬라이드" : "이미지";
              return (
                <div
                  key={ad.library_id}
                  onClick={() => setDetail(ad)}
                  className="cursor-pointer rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col hover:shadow-md transition-shadow"
                >
                  <div className="p-2.5">
                    <div className="flex items-center gap-2">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: colorFromString(brand) }}>
                          {brand.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-bold dark:text-gray-100">{brand}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${ad.media_type === "video" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : typeLabel === "슬라이드" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                        {typeLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px] leading-tight text-gray-400">
                      확인일시: {fmtDate(ad.first_seen_at)}
                      <br />
                      ID: {ad.library_id}
                    </div>
                  </div>

                  <div className="relative aspect-square">
                    <MediaView ad={ad} />
                    {!ended && isNew(ad.first_seen_at) && (
                      <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">신규</span>
                    )}
                    {ended ? (
                      <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-gray-700/90 px-2 py-0.5 text-[10px] font-bold text-white">종료</span>
                    ) : days >= 7 ? (
                      <span className="absolute right-1.5 top-1.5 z-10 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">🔥 {days}일</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="mt-6 flex items-center justify-center gap-1">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {pageItems(safePage, pageCount).map((it, i) =>
                it === "…" ? (
                  <span key={`e${i}`} className="px-2 text-gray-400">…</span>
                ) : (
                  <button key={it} onClick={() => setPage(it)} className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium ${it === safePage ? "bg-primary text-white" : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    {it}
                  </button>
                )
              )}
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount} className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </>
      )}

      {/* 상세 모달 */}
      {detail && (
        <AdDetailModal
          ad={detail}
          brandName={brandNameOfAd(detail)}
          brandImage={brandImageOfAd(detail)}
          country={detail.target_id ? targetMap[detail.target_id]?.country ?? null : null}
          onClose={() => setDetail(null)}
          onMemoSaved={onMemoSaved}
          onAnalyzed={onAdAnalyzed}
        />
      )}

      {/* 설정 모달 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-900 shadow-xl">
            <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3.5">
              <h2 className="text-base font-bold dark:text-white">브랜드 관리</h2>
              <button onClick={() => setShowSettings(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-5">
              <form onSubmit={addTarget} className="rounded-xl border dark:border-gray-800 p-5">
                <div className="mb-3 text-sm font-bold dark:text-gray-200 flex items-center gap-1.5">
                  <Plus className="h-4 w-4" /> 브랜드 추가
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">브랜드 이름</label>
                    <input placeholder="예: 미니드" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{type === "page" ? "광고 라이브러리 URL 또는 page_id" : "검색어"}</label>
                    {type === "page" ? (
                      <input placeholder="https://www.facebook.com/ads/library/?...view_all_page_id=..." value={pageInput} onChange={(e) => setPageInput(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                    ) : (
                      <input placeholder="검색어" value={query} onChange={(e) => setQuery(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={handlePreview} disabled={previewing} className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50">
                      {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      미리보기·분석
                    </button>
                    <span className="text-xs text-gray-400">유형</span>
                    <select value={type} onChange={(e) => setType(e.target.value as "page" | "keyword")} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm dark:text-gray-200">
                      <option value="page">페이지</option>
                      <option value="keyword">키워드</option>
                    </select>
                    <span className="text-xs text-gray-400">국가</span>
                    <input value={country} onChange={(e) => setCountry(e.target.value)} title="국가코드" className="w-14 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm dark:text-gray-200" />
                  </div>
                  {previewFocus && (
                    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50 dark:bg-indigo-950/30 p-3">
                      <div className="mb-1 flex items-center gap-1 text-xs font-bold text-indigo-700 dark:text-indigo-300">
                        <Sparkles className="h-3.5 w-3.5" /> 분석 미리보기
                      </div>
                      <p className="text-sm text-gray-700 dark:text-gray-200">{previewFocus}</p>
                    </div>
                  )}
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">대분류 {previewFocus && <span className="text-indigo-500">· AI 추천됨 (수정 가능)</span>}</label>
                    <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200">
                      <option value="">대분류 선택 (수집 후 자동 분류됨)</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end pt-1">
                    <button type="submit" disabled={!label.trim() || (type === "page" ? !pageInput.trim() : !query.trim())} className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">추가</button>
                  </div>
                </div>
              </form>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-bold dark:text-gray-200">추적 중인 브랜드 {targets.length > 0 && `(${targets.length})`}</div>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input
                      value={brandMgmtSearch}
                      onChange={(e) => setBrandMgmtSearch(e.target.value)}
                      placeholder="브랜드 검색"
                      className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-2 text-xs dark:text-gray-200"
                    />
                  </div>
                </div>
                {targets.length === 0 && <p className="text-sm text-gray-400">아직 없음 — 위에서 추가하세요.</p>}
                {targets.length > 0 && Object.keys(groups).length === 0 && (
                  <p className="text-sm text-gray-400">검색 결과가 없습니다.</p>
                )}
                {Object.keys(groups).sort().map((cat) => (
                  <div key={cat} className="mb-3">
                    <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">{cat}</div>
                    {groups[cat].map((t) =>
                      editingId === t.id ? (
                        <div key={t.id} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-primary/5 p-2">
                          <input value={edit.label ?? ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="이름" className="flex-1 min-w-[110px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          <select value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200">
                            <option value="">대분류</option>
                            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                          <select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value as "page" | "keyword" })} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200">
                            <option value="page">페이지</option>
                            <option value="keyword">키워드</option>
                          </select>
                          {edit.type === "page" ? (
                            <input value={edit.pageInput ?? ""} onChange={(e) => setEdit({ ...edit, pageInput: e.target.value })} placeholder="URL 또는 page_id" className="flex-1 min-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          ) : (
                            <input value={edit.query ?? ""} onChange={(e) => setEdit({ ...edit, query: e.target.value })} placeholder="검색어" className="flex-1 min-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          )}
                          <input value={edit.country ?? "KR"} onChange={(e) => setEdit({ ...edit, country: e.target.value })} className="w-14 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          <button onClick={() => saveEdit(t.id)} className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white">저장</button>
                          <button onClick={() => setEditingId(null)} className="rounded border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300">취소</button>
                        </div>
                      ) : (
                        <div key={t.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                          {t.profile_image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={t.profile_image} alt="" className="h-6 w-6 rounded-full object-cover" />
                          ) : null}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm dark:text-gray-200">{t.enabled ? "🟢" : "⚪"} {t.profile_name || t.label}</div>
                            {t.summary && <div className="truncate text-[11px] text-violet-600 dark:text-violet-300">✨ {t.summary}</div>}
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">{counts[t.id] ?? 0}건</span>
                          <button onClick={() => startEdit(t)} className="rounded p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800" title="편집"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => patchTarget(t.id, { enabled: !t.enabled })} className={`rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${t.enabled ? "text-green-600" : "text-gray-400"}`} title={t.enabled ? "끄기" : "켜기"}><Power className="h-4 w-4" /></button>
                          <button onClick={() => remove(t)} className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="삭제"><Trash2 className="h-4 w-4" /></button>
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-white" : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
      {children}
    </button>
  );
}

function AdDetailModal({
  ad,
  brandName,
  brandImage,
  country,
  onClose,
  onMemoSaved,
  onAnalyzed,
}: {
  ad: Ad;
  brandName: string;
  brandImage: string | null;
  country: string | null;
  onClose: () => void;
  onMemoSaved: (libraryId: string, memo: string) => void;
  onAnalyzed: (libraryId: string, analysis: string) => void;
}) {
  const [memo, setMemo] = useState(ad.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(ad.ai_analysis ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSaved, setAnalysisSaved] = useState<boolean>(!!ad.ai_analysis);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const ended = ad.status === "ended";
  const days = activeDays(ad);

  // 메모 세로 자동 확장 (내용 길어져도 잘리지 않게)
  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = memoRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [memo]);

  async function runAnalyze() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/meta-ad/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library_id: ad.library_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("AI 분석 실패: " + (j.error ?? res.status));
        return;
      }
      setAnalysis(j.analysis || "분석 결과가 없습니다.");
      setAnalysisSaved(false); // 저장 전 상태
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveAnalysis() {
    if (!analysis) return;
    setSavingAnalysis(true);
    try {
      const res = await fetch(`/api/meta-ad/ads/${ad.library_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_analysis: analysis }),
      });
      if (res.ok) {
        setAnalysisSaved(true);
        onAnalyzed(ad.library_id, analysis);
      } else {
        alert("분석 저장 실패");
      }
    } finally {
      setSavingAnalysis(false);
    }
  }

  async function saveMemo() {
    setSaving(true);
    try {
      const res = await fetch(`/api/meta-ad/ads/${ad.library_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo }),
      });
      if (res.ok) {
        onMemoSaved(ad.library_id, memo);
        setSaved(true);
        setTimeout(() => setSaved(false), 1800);
      } else {
        alert("메모 저장 실패");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={onClose}>
      <div className="my-4 flex max-h-[92vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {brandImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brandImage} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: colorFromString(brandName) }}>
                {brandName.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-bold dark:text-gray-100">{brandName}</div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className={`inline-flex items-center gap-1 ${ended ? "text-gray-400" : "text-green-600"}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-gray-400" : "bg-green-500"}`} />
                  {ended ? "종료됨" : "활성"}
                </span>
                <span className="text-gray-400">· 활성 {days}일</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={sourceLink(ad)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              <ExternalLink className="h-3.5 w-3.5" /> 광고 라이브러리
            </a>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="grid flex-1 overflow-hidden md:grid-cols-2">
          {/* 좌: 미디어 + T&D (소재 바로 밑) */}
          <div className="space-y-4 overflow-y-auto border-b p-4 dark:border-gray-800 md:border-b-0 md:border-r">
            <div className="relative mx-auto aspect-[4/5] w-full max-w-md overflow-hidden rounded-xl bg-black/[0.03] dark:bg-black/30">
              <MediaView ad={ad} rounded="rounded-xl" />
            </div>
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-gray-400">제목 · 캡션 (T&D)</div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{cleanCaption(ad.ad_text, brandName)}</p>
            </div>
          </div>

          {/* 우: 메타데이터 + 링크 + 메모 */}
          <div className="overflow-y-auto p-5 space-y-4">
            {/* 메타데이터 */}
            <div className="rounded-xl border dark:border-gray-800 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">메타데이터</div>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <Meta k="시작일" v={ad.started_on ?? "—"} />
                <Meta k="활성 일수" v={`${days}일`} />
                <Meta k="최초 수집" v={fmtDate(ad.first_seen_at)} />
                <Meta k="최근 확인" v={fmtDate(ad.last_seen_at)} />
                <Meta k="국가" v={country ?? "—"} />
                <Meta k="상태" v={ended ? "종료" : "활성"} />
                <Meta k="유형" v={ad.media_type === "video" ? "영상" : ad.media_type === "carousel" ? "슬라이드" : "이미지"} />
                <Meta k="Library ID" v={ad.library_id} />
              </dl>
            </div>

            {/* 링크 */}
            <div className="space-y-1.5 text-sm">
              <div>
                <span className="text-xs font-bold text-gray-400">Source</span>
                <a href={sourceLink(ad)} target="_blank" rel="noopener noreferrer" className="block truncate text-primary underline">{sourceLink(ad)}</a>
              </div>
              {ad.landing_url && (
                <div>
                  <span className="text-xs font-bold text-gray-400">랜딩 페이지</span>
                  <a href={ad.landing_url} target="_blank" rel="noopener noreferrer" className="block truncate text-primary underline">{ad.landing_url}</a>
                </div>
              )}
            </div>

            {/* 메모 */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">메모</span>
                <button onClick={saveMemo} disabled={saving} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? "저장됨" : <><Save className="h-3 w-3" /> 저장</>}
                </button>
              </div>
              <textarea
                ref={memoRef}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="이 소재에 대한 메모를 남기세요 (팀 공유 · Shift+Enter 줄바꿈)"
                className="min-h-[90px] w-full resize-none overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 text-sm leading-relaxed dark:text-gray-200"
              />
            </div>

            {/* AI 분석 (메모 아래) */}
            <div>
              {analysis ? (
                <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50 dark:bg-violet-950/20 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-xs font-bold text-violet-700 dark:text-violet-300">
                      <Sparkles className="h-3.5 w-3.5" /> AI 분석
                    </div>
                    <div className="flex items-center gap-1.5">
                      {analysisSaved ? (
                        <span className="flex items-center gap-0.5 text-[11px] font-medium text-green-600">
                          <Check className="h-3 w-3" /> 저장됨
                        </span>
                      ) : (
                        <button
                          onClick={saveAnalysis}
                          disabled={savingAnalysis}
                          className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                        >
                          {savingAnalysis ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3" /> 저장</>}
                        </button>
                      )}
                      <button
                        onClick={runAnalyze}
                        disabled={analyzing}
                        className="rounded-md border border-violet-300 dark:border-violet-800 px-2 py-1 text-[11px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-50"
                        title="다시 분석"
                      >
                        {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : "다시"}
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{analysis}</p>
                  {!analysisSaved && (
                    <p className="mt-2 text-[11px] text-gray-400">저장하지 않으면 이 분석은 창을 닫을 때 사라집니다.</p>
                  )}
                </div>
              ) : (
                <button
                  onClick={runAnalyze}
                  disabled={analyzing}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 px-3 py-2.5 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-50"
                >
                  {analyzing ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> 분석 중...</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> AI 분석</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11px] text-gray-400">{k}</dt>
      <dd className="font-medium text-gray-800 dark:text-gray-200 break-all">{v}</dd>
    </div>
  );
}
