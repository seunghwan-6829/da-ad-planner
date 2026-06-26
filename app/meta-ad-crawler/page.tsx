"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { aiFetch } from "@/lib/ai-fetch";
import { getClients, type Client } from "@/lib/api/clients";
import {
  Megaphone,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Star,
  Activity,
  Layers,
  Camera,
  ArrowUpRight,
  Play,
  MapPin,
  ClipboardList,
  Move,
  Filter,
  ChevronDown,
  FileText,
  Users,
  Link2,
  Lock,
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
  client_ids?: string[] | null;
  created_at?: string | null;
};

// 대분류 표준 목록(관리자 카테고리 수정용). AI 판정과 동일 세트 + 미분류.
const CATEGORY_OPTIONS = [
  "미분류",
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

type Ad = {
  library_id: string;
  target_id: string | null;
  page_name: string | null;
  started_on: string | null;
  ad_text: string | null;
  media_type: string | null;
  media_url: string | null;
  media_urls?: string[] | null;
  poster_url?: string | null;
  frames?: string[] | null;
  landing_url?: string | null;
  status?: string | null;
  ended_at?: string | null;
  memo?: string | null;
  saved?: boolean | null;
  ai_analysis?: string | null;
  has_analysis?: boolean;
  transcript?: string | null;
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
  const s = input.trim();
  const m = s.match(/view_all_page_id=(\d+)/);
  if (m) return m[1];
  if (/^\d+$/.test(s)) return s;
  // 잘못된 형태(전체 URL 등)는 숫자열만 추출해 폴백(없으면 원문). 단일 광고 링크는 addTarget 검증에서 거른다.
  const any = s.match(/(\d{6,})/);
  return any ? any[1] : s;
}

// "광고 1개" 상세 링크인지(id=만 있고 view_all_page_id 없음) — 이걸로는 페이지 전체를 못 가져온다.
function isSingleAdUrl(input: string): boolean {
  const s = input.trim();
  return /[?&]id=\d+/.test(s) && !/view_all_page_id=\d+/.test(s);
}
const SINGLE_AD_WARN =
  "이 링크는 '광고 1개' 상세 링크예요(주소에 id=…).\n\n브랜드 전체 광고를 가져오려면:\n메타 광고 라이브러리에서 그 광고를 연 뒤 → 광고주(페이지) 이름을 클릭 → '모든 광고 보기' 화면으로 이동 → 그 주소(view_all_page_id=… 가 들어간 URL)를 복사해 붙여넣어 주세요.\n\n(또는 유형을 '키워드'로 바꿔 브랜드명으로 검색해도 됩니다.)";

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

// 클릭 가능한 작은 썸네일용 정적 이미지 URL(영상은 poster). 비디오/캐러셀 컨트롤이 클릭을 가로채지 않게.
function posterThumb(ad: Ad): string | null {
  return ad.poster_url || (Array.isArray(ad.media_urls) && ad.media_urls[0]) || ad.media_url || null;
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

// 현재 페이지 주변으로 최대 10개의 연속 페이지 번호를 보여준다(끝쪽이면 끝에 맞춰 정렬).
function pageItems(current: number, total: number): number[] {
  const WINDOW = 10;
  if (total <= WINDOW) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(WINDOW / 2));
  const end = Math.min(total, start + WINDOW - 1);
  start = Math.max(1, end - WINDOW + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/* ── 미디어 뷰: 영상 재생 / 캐러셀 슬라이드 / 이미지 ──
   card=true(그리드 카드): 영상은 컨트롤 없는 '미리보기'로 렌더하고 클릭이 카드로 전달되게(=클릭하면 모달 열림). */
function MediaView({
  ad,
  rounded,
  card,
  videoRef,
}: {
  ad: Ad;
  rounded?: string;
  card?: boolean;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const urls = mediaListOf(ad);
  const [idx, setIdx] = useState(0);
  const r = rounded ?? "";

  if (ad.media_type === "video" && ad.media_url) {
    if (card) {
      // 카드: 클릭을 가로채지 않도록 컨트롤 없는 프리뷰(포스터/첫 프레임) + 가운데 ▶
      return (
        <div className="pointer-events-none relative h-full w-full bg-black">
          <video
            src={ad.media_url}
            poster={ad.poster_url || undefined}
            muted
            playsInline
            preload="metadata"
            className={`h-full w-full object-cover ${r}`}
          />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45">
              <Play className="h-4 w-4 fill-white text-white" />
            </div>
          </div>
        </div>
      );
    }
    return (
      <video
        ref={videoRef}
        src={ad.media_url}
        poster={ad.poster_url || undefined}
        controls
        playsInline
        preload="metadata"
        onClick={(e) => e.stopPropagation()}
        className={`h-full w-full bg-black object-contain ${r}`}
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
      <img src={urls[idx]} alt="" loading="lazy" decoding="async" className={`h-full w-full ${card ? "object-cover" : "object-contain"}`} />
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
  const router = useRouter();
  const { canMetaAd, isAdmin, loading: authLoading } = useAuth();
  const [targets, setTargets] = useState<Target[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ads, setAds] = useState<Ad[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false); // 백그라운드 전체 로드 진행 중 여부

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedBrands, setSelectedBrands] = useState<string[]>([]); // 비어있으면 전체 브랜드
  const [showBrandPicker, setShowBrandPicker] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<string>("all"); // "all" = 전체
  const [showClientPicker, setShowClientPicker] = useState(false); // 클라이언트 필터 플로팅
  const [showClientMap, setShowClientMap] = useState(false); // 클라이언트↔브랜드 매핑 편집 플로팅
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "carousel" | "video">("all");
  const [savedOnly, setSavedOnly] = useState(false);
  const [workedOnly, setWorkedOnly] = useState(false);
  const [showFeed, setShowFeed] = useState(false);
  const [page, setPage] = useState(1);
  const [jumpPage, setJumpPage] = useState(""); // 페이지 직접 입력
  const [detail, setDetail] = useState<Ad | null>(null);

  // 브랜드 관리 모달
  const [showSettings, setShowSettings] = useState(false);
  const [brandMgmtSearch, setBrandMgmtSearch] = useState("");
  const [addNotice, setAddNotice] = useState<string | null>(null);

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
  const bgLoadedRef = useRef(false); // 백그라운드 전체 로드 1회만
  const loadedBrandsRef = useRef<Set<string>>(new Set()); // 브랜드별 on-demand 로드 추적

  // 새로 받은 광고들을 기존 ads 에 병합(중복 제거, 기존 항목 우선 — bootstrap 의 ad_text/has_analysis 보존)
  const mergeAds = useCallback((rows: Ad[]) => {
    if (!rows?.length) return;
    setAds((prev) => {
      const map = new Map(prev.map((a) => [a.library_id, a]));
      for (const row of rows) if (!map.has(row.library_id)) map.set(row.library_id, row);
      return Array.from(map.values());
    });
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/meta-ad/bootstrap");
      if (res.ok) {
        const j = await res.json();
        setTargets(j.targets ?? []);
        setAds(j.ads ?? []);
        setCounts(j.counts ?? {});
        try {
          sessionStorage.setItem("meta-ad-cache", JSON.stringify(j));
        } catch {}
      }
    } finally {
      setLoading(false);
    }
    // 첫 화면(최근 300)을 띄운 뒤, 나머지 광고를 백그라운드로 이어 받아 병합(화면 안 멈춤). 진입당 1회.
    // 속도: 페이지를 한 번에 1000개씩, 6개를 동시(병렬)로 받아 합친다 → 순차 대비 수 배 빠름.
    if (!bgLoadedRef.current) {
      bgLoadedRef.current = true;
      (async () => {
        setSyncing(true);
        const PAGE = 1000; // PostgREST 한 요청 최대치
        const CONCURRENCY = 6;
        let nextOffset = 300; // bootstrap 이 최근 300 줬으니 그다음부터
        let done = false;
        const worker = async () => {
          while (!done) {
            const offset = nextOffset; // 동기적으로 고유 오프셋 선점(겹침/누락 없음)
            nextOffset += PAGE;
            try {
              const r = await fetch(`/api/meta-ad/ads?light=1&limit=${PAGE}&offset=${offset}`);
              if (!r.ok) {
                done = true;
                break;
              }
              const rows: Ad[] = await r.json();
              if (rows.length) mergeAds(rows);
              if (rows.length < PAGE) {
                done = true; // 마지막 페이지 도달
                break;
              }
            } catch {
              done = true;
              break;
            }
          }
        };
        try {
          await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
        } finally {
          setSyncing(false);
        }
      })();
    }
  }, [mergeAds]);

  useEffect(() => {
    // 재진입 시 세션 캐시를 즉시 표시(진입 순간 기다림 제거) → 뒤에서 최신으로 갱신
    try {
      const c = sessionStorage.getItem("meta-ad-cache");
      if (c) {
        const j = JSON.parse(c);
        setTargets(j.targets ?? []);
        setAds(j.ads ?? []);
        setCounts(j.counts ?? {});
        setLoading(false);
      }
    } catch {}
    loadAll();
  }, [loadAll]);

  // 기획안 제작의 클라이언트 목록(클라이언트별 브랜드 매핑/필터용)
  useEffect(() => {
    getClients()
      .then((cs) => setClients(cs || []))
      .catch(() => {});
  }, []);

  // 백엔드 자동 대분류 + 한 줄 요약: 광고가 쌓였는데 아직 '미분류'인 브랜드만 처리.
  // (대분류가 이미 정해진 브랜드는 건드리지 않음 → 관리자가 수동으로 고친 카테고리가 덮어써지지 않음.)
  // 비용/부하 방지를 위해 방문당 최대 12개씩만 채우고, 다음 방문에 이어서 채운다.
  useEffect(() => {
    if (categorizedRef.current || loading) return;
    const todo = targets
      .filter(
        (t) => (counts[t.id] || 0) > 0 && (!(t.category || "").trim() || t.category === "미분류")
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

  // 브랜드를 선택하면 그 브랜드 광고를 서버에서 완전히 받아 병합(백그라운드 로드가 아직 안 끝났거나
  // 그 브랜드가 최근 300 밖이어도 브랜드 뷰는 항상 완전하게). 이미 다 들고 있으면 스킵.
  useEffect(() => {
    if (selectedBrands.length === 0) return;
    for (const bid of selectedBrands) {
      if (loadedBrandsRef.current.has(bid)) continue;
      const have = ads.filter((a) => a.target_id === bid).length;
      if ((counts[bid] || 0) > 0 && have >= (counts[bid] || 0)) {
        loadedBrandsRef.current.add(bid);
        continue;
      }
      loadedBrandsRef.current.add(bid);
      (async () => {
        try {
          const r = await fetch(`/api/meta-ad/ads?light=1&limit=1000&target_id=${bid}`);
          if (!r.ok) {
            loadedBrandsRef.current.delete(bid);
            return;
          }
          mergeAds(await r.json());
        } catch {
          loadedBrandsRef.current.delete(bid);
        }
      })();
    }
  }, [selectedBrands, ads, counts, mergeAds]);

  const targetMap = useMemo(() => {
    const m: Record<string, Target> = {};
    for (const t of targets) m[t.id] = t;
    return m;
  }, [targets]);

  // 중복되는 광고주 이름은 자동으로 뒤에 번호(1,2,...)를 붙여 구분(생성순). 고유 이름은 그대로.
  const brandDisplayName = useMemo(() => {
    const groups: Record<string, Target[]> = {};
    for (const t of targets) {
      const base = (t.profile_name || t.label || "—").trim();
      (groups[base] ||= []).push(t);
    }
    const m: Record<string, string> = {};
    for (const base of Object.keys(groups)) {
      const list = groups[base];
      if (list.length <= 1) {
        if (list[0]) m[list[0].id] = base;
        continue;
      }
      const sorted = [...list].sort((a, b) =>
        String(a.created_at || "").localeCompare(String(b.created_at || "")) || String(a.id).localeCompare(String(b.id))
      );
      sorted.forEach((t, i) => {
        m[t.id] = `${base} ${i + 1}`;
      });
    }
    return m;
  }, [targets]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of targets) set.add((t.category || "").trim() || "미분류");
    // '기타'는 항상 맨 끝으로, 나머지는 가나다순.
    return Array.from(set).sort((a, b) => {
      if (a === "기타") return 1;
      if (b === "기타") return -1;
      return a.localeCompare(b, "ko");
    });
  }, [targets]);

  function brandNameOfAd(ad: Ad): string {
    const t = ad.target_id ? targetMap[ad.target_id] : undefined;
    return (t && brandDisplayName[t.id]) || t?.profile_name || t?.label || ad.page_name || "—";
  }
  function brandImageOfAd(ad: Ad): string | null {
    const t = ad.target_id ? targetMap[ad.target_id] : undefined;
    return t?.profile_image || null;
  }

  const filteredAds = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = ads.filter((ad) => {
      if (savedOnly && !ad.saved) return false;
      if (workedOnly && !((ad.memo && ad.memo.trim()) || ad.has_analysis)) return false;
      const cat = ad.target_id ? (targetMap[ad.target_id]?.category || "").trim() || "미분류" : "미분류";
      if (activeCategory !== "all" && cat !== activeCategory) return false;
      if (selectedClient !== "all") {
        const cids = ad.target_id ? targetMap[ad.target_id]?.client_ids : null;
        if (!cids || !cids.includes(selectedClient)) return false;
      }
      if (selectedBrands.length > 0 && (!ad.target_id || !selectedBrands.includes(ad.target_id))) return false;
      if (q && !brandNameOfAd(ad).toLowerCase().includes(q)) return false;
      if (mediaFilter !== "all") {
        const carousel = ad.media_type === "carousel" || (Array.isArray(ad.media_urls) && ad.media_urls.length > 1);
        if (mediaFilter === "video" && ad.media_type !== "video") return false;
        if (mediaFilter === "carousel" && !carousel) return false;
        if (mediaFilter === "image" && (ad.media_type === "video" || carousel)) return false;
      }
      return true;
    });
    // 최신순 정렬(브랜드별 병합 fetch로 순서가 섞일 수 있어 명시적으로 first_seen_at desc).
    list.sort((a, b) => {
      const ta = a.first_seen_at ? new Date(a.first_seen_at).getTime() : 0;
      const tb = b.first_seen_at ? new Date(b.first_seen_at).getTime() : 0;
      return tb - ta;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ads, search, activeCategory, selectedClient, selectedBrands, mediaFilter, savedOnly, workedOnly, targetMap]);

  const savedCount = useMemo(() => ads.filter((a) => a.saved).length, [ads]);
  const workedCount = useMemo(() => ads.filter((a) => (a.memo && a.memo.trim()) || a.has_analysis).length, [ads]);

  // #4 변주 그룹핑(추정): 같은 브랜드 + (같은 랜딩 URL 또는 카피 토큰 유사도 높음)
  function tokensOf(s: string | null | undefined): Set<string> {
    return new Set(
      (s || "")
        .toLowerCase()
        .replace(/[^0-9a-z가-힣\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
    );
  }
  function variationsOf(ad: Ad): Ad[] {
    if (!ad.target_id) return [];
    const myTokens = tokensOf(ad.ad_text);
    const sims = ads.filter((o) => {
      if (o.library_id === ad.library_id) return false;
      if (o.target_id !== ad.target_id) return false;
      if (ad.landing_url && o.landing_url && ad.landing_url === o.landing_url) return true;
      if (myTokens.size < 3) return false;
      const ot = tokensOf(o.ad_text);
      if (ot.size < 3) return false;
      let inter = 0;
      for (const t of myTokens) if (ot.has(t)) inter++;
      const jac = inter / (myTokens.size + ot.size - inter);
      return jac >= 0.35;
    });
    return sims.slice(0, 8);
  }

  // #9 시드: 경쟁 소재 → 기획안 아이디어 / 촬영 가이드 입력값으로 넘김
  function seedTo(ad: Ad, dest: "plan" | "guide") {
    const brand = brandNameOfAd(ad);
    const caption = cleanCaption(ad.ad_text, brand).replace(/\n+/g, " ").slice(0, 240);
    const parsed = parseAnalysis(ad.ai_analysis ?? null);
    const offer = parsed?.offer || "";
    const strengths = parsed?.strengths || [];
    const phases = parsed?.phases || [];

    if (dest === "plan") {
      const lines = [
        `경쟁사 "${brand}" 광고를 참고해, 우리 브랜드에 맞는 새 숏폼/릴스 대본 아이디어를 만들어줘.`,
        ``,
        `[참고 광고 핵심]`,
        offer ? `- 소구점/오퍼: ${offer}` : "",
        caption && caption !== "—" ? `- 카피: ${caption}` : "",
        ...strengths.slice(0, 4).map((s) => `- 잘된 점: ${s}`),
        ``,
        `위 장점은 살리되 그대로 베끼지 말고 우리만의 차별화 포인트로 변주해줘.`,
      ].filter(Boolean);
      try {
        sessionStorage.setItem("plan-idea-seed", lines.join("\n"));
      } catch {}
      router.push("/plan-ideas");
      return;
    }

    // guide: 컷 칩 시드 (구간이 있으면 구간별 컷, 없으면 카피 기반 1컷)
    const cuts =
      phases.length > 0
        ? phases.map((p) => `${p.name}${p.desc ? ` — ${p.desc}` : ""}`)
        : caption && caption !== "—"
        ? [`${brand} 레퍼런스 컷: ${caption.slice(0, 80)}`]
        : [`${brand} 스타일 레퍼런스 컷`];
    try {
      sessionStorage.setItem("shooting-guide-seed", JSON.stringify(cuts));
    } catch {}
    router.push("/shooting-guide");
  }

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
    if (type === "page" && isSingleAdUrl(pageInput)) {
      alert(SINGLE_AD_WARN);
      return;
    }
    const bodyData =
      type === "page"
        ? { label, category, type, page_id: parsePageId(pageInput), country }
        : { label, category, type, query, country };
    const res = await fetch("/api/meta-ad/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert("추가 실패: " + (j.error ?? res.status));
      return;
    }
    setLabel("");
    setCategory("");
    setPageInput("");
    setQuery("");
    setPreviewFocus(null);
    loadAll();
    if (j.crawl_triggered) {
      setAddNotice("✅ 브랜드 추가됨 · 방금 이 브랜드 크롤링을 시작했어요. 1~2분 뒤 소재가 자동으로 채워집니다.");
      // 크롤 완료 즈음 자동 반영
      setTimeout(() => loadAll(), 90000);
      setTimeout(() => loadAll(), 150000);
    } else {
      setAddNotice("브랜드 추가됨 · 즉시 크롤은 미설정 상태라 다음 자동 크롤링(최대 5일) 때 수집됩니다. (관리자: Vercel에 GH_DISPATCH_TOKEN 설정 시 즉시 크롤)");
    }
    setTimeout(() => setAddNotice(null), 15000);
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
    if (edit.type === "page" && isSingleAdUrl(edit.pageInput ?? "")) {
      alert(SINGLE_AD_WARN);
      return;
    }
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
    setSelectedBrands((prev) => prev.filter((id) => id !== t.id));
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
    setAds((prev) => prev.map((a) => (a.library_id === libraryId ? { ...a, ai_analysis, has_analysis: true } : a)));
    setDetail((d) => (d && d.library_id === libraryId ? { ...d, ai_analysis, has_analysis: true } : d));
  }

  // 대본(transcript)은 생성 즉시 자동 저장(서버가 DB에 기록) → 앱 상태에도 바로 반영해 다시 열어도 유지.
  function onTranscribed(libraryId: string, transcript: string) {
    setAds((prev) => prev.map((a) => (a.library_id === libraryId ? { ...a, transcript } : a)));
    setDetail((d) => (d && d.library_id === libraryId ? { ...d, transcript } : d));
  }

  // 브랜드 카테고리(대분류) 수정 — 관리자 전용. 낙관적 갱신 후 PATCH(바로 반영).
  async function setBrandCategory(targetId: string, category: string) {
    if (!isAdmin) return;
    const prevCat = targetMap[targetId]?.category ?? null;
    setTargets((prev) => prev.map((x) => (x.id === targetId ? { ...x, category } : x)));
    try {
      const r = await fetch(`/api/meta-ad/targets/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setTargets((prev) => prev.map((x) => (x.id === targetId ? { ...x, category: prevCat } : x))); // 롤백
    }
  }

  // 브랜드 ↔ 클라이언트 매핑 토글(여러 클라이언트 허용). 낙관적 갱신 후 PATCH.
  async function setBrandClient(targetId: string, clientId: string, on: boolean) {
    const t = targetMap[targetId];
    if (!t) return;
    const cur = Array.isArray(t.client_ids) ? t.client_ids : [];
    const next = on ? Array.from(new Set([...cur, clientId])) : cur.filter((x) => x !== clientId);
    setTargets((prev) => prev.map((x) => (x.id === targetId ? { ...x, client_ids: next } : x)));
    try {
      const r = await fetch(`/api/meta-ad/targets/${targetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_ids: next }),
      });
      if (!r.ok) throw new Error();
    } catch {
      setTargets((prev) => prev.map((x) => (x.id === targetId ? { ...x, client_ids: cur } : x))); // 롤백
    }
  }

  // #7 스와이프 파일: 즐겨찾기 토글(낙관적 갱신 후 PATCH)
  async function toggleSaved(ad: Ad) {
    const next = !ad.saved;
    setAds((prev) => prev.map((a) => (a.library_id === ad.library_id ? { ...a, saved: next } : a)));
    setDetail((d) => (d && d.library_id === ad.library_id ? { ...d, saved: next } : d));
    try {
      const res = await fetch(`/api/meta-ad/ads/${ad.library_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saved: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // 실패 시 롤백
      setAds((prev) => prev.map((a) => (a.library_id === ad.library_id ? { ...a, saved: !next } : a)));
      setDetail((d) => (d && d.library_id === ad.library_id ? { ...d, saved: !next } : d));
    }
  }

  // 카드 클릭: 모달을 즉시 열고(목록 데이터), 무거운 상세(본문/메모/AI분석/랜딩)는 그 광고만 따로 받아 채움
  async function openDetail(ad: Ad) {
    setDetail(ad);
    try {
      const res = await fetch(`/api/meta-ad/ads/${ad.library_id}`);
      if (res.ok) {
        const full = await res.json();
        setDetail((d) => (d && d.library_id === ad.library_id ? { ...d, ...full } : d));
      }
    } catch {}
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

  // 접근 권한 가드: 관리자 또는 can_meta_ad 권한이 있는 사용자만
  if (!authLoading && !canMetaAd) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <Megaphone className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          메타 광고 크롤러는 관리자가 권한을 부여한 사용자만 볼 수 있어요.
          <br />
          관리자에게 접근 권한을 요청해 주세요.
        </p>
      </div>
    );
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
          <Chip active={activeCategory === "all"} onClick={() => { setActiveCategory("all"); setSelectedBrands([]); setSelectedClient("all"); resetToFirst(); }}>
            모든 광고
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={activeCategory === c} onClick={() => { setActiveCategory(c); setSelectedBrands([]); setSelectedClient("all"); resetToFirst(); }}>
              {c}
            </Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {selectedBrands.length > 0 && (
            <button
              onClick={() => { setSelectedBrands([]); resetToFirst(); }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline underline-offset-2"
            >
              선택 해제
            </button>
          )}
          <button
            onClick={() => setShowClientPicker(true)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
              selectedClient !== "all"
                ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Users className="h-4 w-4" />
            {selectedClient === "all" ? "클라이언트" : (clients.find((c) => c.id === selectedClient)?.name || "클라이언트")}
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>
          <button
            onClick={() => setShowBrandPicker(true)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
              selectedBrands.length > 0
                ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Filter className="h-4 w-4" />
            {selectedBrands.length === 0
              ? "전체 브랜드"
              : selectedBrands.length === 1
                ? (brandDisplayName[selectedBrands[0]] || targetMap[selectedBrands[0]]?.profile_name || targetMap[selectedBrands[0]]?.label || "브랜드 1개")
                : `브랜드 ${selectedBrands.length}개 선택`}
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>
        </div>
      </div>

      {/* 툴바 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <strong className="text-sm dark:text-gray-200">{loading ? "불러오는 중..." : `광고 ${filteredAds.length.toLocaleString()}건`}</strong>
            <span className="text-xs text-gray-400">최신순</span>
          </div>
          {/* 백그라운드 전체 로드 진행률(첫 화면은 최근 300건만, 나머지는 동기화 중) */}
          {!loading && syncing && (() => {
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            if (total <= ads.length) return null;
            const pct = total > 0 ? Math.min(99, Math.round((ads.length / total) * 100)) : 0;
            return (
              <div className="flex items-center gap-2" title="전체 광고를 백그라운드로 불러오는 중입니다">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
                <span className="whitespace-nowrap text-xs text-gray-400">
                  동기화 {pct}% ({ads.length.toLocaleString()}/{total.toLocaleString()})
                </span>
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {/* 보기 형식 */}
          <div className="flex items-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
            {([
              ["all", "전체"],
              ["image", "이미지"],
              ["carousel", "캐러셀"],
              ["video", "동영상"],
            ] as const).map(([v, label], i) => (
              <button
                key={v}
                onClick={() => {
                  setMediaFilter(v);
                  resetToFirst();
                }}
                className={`px-2.5 py-1.5 font-medium ${i > 0 ? "border-l border-gray-200 dark:border-gray-700" : ""} ${
                  mediaFilter === v
                    ? "bg-primary text-white"
                    : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {/* #5 변화 피드 */}
          <button
            onClick={() => setShowFeed(true)}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Activity className="h-4 w-4" />
            변화 피드
          </button>
          {/* #7 스와이프 파일 */}
          <button
            onClick={() => {
              setSavedOnly((v) => !v);
              resetToFirst();
            }}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              savedOnly
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <Star className={`h-4 w-4 ${savedOnly ? "fill-amber-400 text-amber-400" : ""}`} />
            스와이프 {savedCount > 0 && `(${savedCount})`}
          </button>
          {/* 메모·분석 작업한 소재만 */}
          <button
            onClick={() => {
              setWorkedOnly((v) => !v);
              resetToFirst();
            }}
            title="메모를 적었거나 AI 분석을 저장한 소재만 보기"
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${
              workedOnly
                ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
                : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            <ClipboardList className="h-4 w-4" />
            메모·분석 {workedCount > 0 && `(${workedCount})`}
          </button>
          <button
            onClick={exportCsv}
            disabled={filteredAds.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40"
          >
            <FileDown className="h-4 w-4" />
            CSV
          </button>
        </div>
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
              const hasMemo = !!(ad.memo && ad.memo.trim());
              const hasAnalysis = !!ad.has_analysis;
              const typeLabel = ad.media_type === "video" ? "영상" : ad.media_type === "carousel" || (ad.media_urls && ad.media_urls.length > 1) ? "슬라이드" : "이미지";
              return (
                <div
                  key={ad.library_id}
                  onClick={() => openDetail(ad)}
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
                    <MediaView ad={ad} card />
                    {!ended && isNew(ad.first_seen_at) && (
                      <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">신규</span>
                    )}
                    {/* 우상단: 상태 + 작업(메모/AI분석) 표시 */}
                    <div className="absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1">
                      {ended && (
                        <span className="rounded-full bg-gray-700/90 px-2 py-0.5 text-[10px] font-bold text-white">종료</span>
                      )}
                      {hasAnalysis && (
                        <span className="flex items-center gap-0.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" title="AI 분석 저장됨">
                          <Sparkles className="h-3 w-3" /> AI
                        </span>
                      )}
                      {hasMemo && (
                        <span className="flex items-center gap-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" title="메모 있음">
                          <Pencil className="h-3 w-3" /> 메모
                        </span>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSaved(ad);
                      }}
                      title={ad.saved ? "스와이프 파일에서 제거" : "스와이프 파일에 저장"}
                      className="absolute bottom-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65"
                    >
                      <Star className={`h-3.5 w-3.5 ${ad.saved ? "fill-amber-400 text-amber-400" : "text-white"}`} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-1">
              {/* 맨 앞 */}
              <button onClick={() => setPage(1)} disabled={safePage === 1} title="처음으로" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronsLeft className="h-4 w-4" />
              </button>
              {/* 이전 */}
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} title="이전" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronLeft className="h-4 w-4" />
              </button>
              {/* 번호(최대 10개) */}
              {pageItems(safePage, pageCount).map((it) => (
                <button key={it} onClick={() => setPage(it)} className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium ${it === safePage ? "bg-primary text-white" : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                  {it}
                </button>
              ))}
              {/* 다음 */}
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount} title="다음" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronRight className="h-4 w-4" />
              </button>
              {/* 맨 뒤 */}
              <button onClick={() => setPage(pageCount)} disabled={safePage === pageCount} title="끝으로" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800">
                <ChevronsRight className="h-4 w-4" />
              </button>

              {/* 페이지 직접 입력 */}
              <div className="ml-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={jumpPage}
                  onChange={(e) => setJumpPage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const n = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1));
                      setPage(n);
                      setJumpPage("");
                    }
                  }}
                  placeholder={String(safePage)}
                  className="h-8 w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-center text-sm dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary/40"
                />
                <span className="whitespace-nowrap">/ {pageCount}</span>
                <button
                  onClick={() => {
                    const n = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1));
                    setPage(n);
                    setJumpPage("");
                  }}
                  className="h-8 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  이동
                </button>
              </div>
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
          variations={variationsOf(detail)}
          brandNameOf={brandNameOfAd}
          onClose={() => setDetail(null)}
          onMemoSaved={onMemoSaved}
          onAnalyzed={onAdAnalyzed}
          onTranscribed={onTranscribed}
          onToggleSaved={toggleSaved}
          onOpenVariation={openDetail}
          onSeed={seedTo}
        />
      )}

      {/* 브랜드 선택 플로팅(다중 선택 + 카테고리/광고수) */}
      {showBrandPicker && (
        <BrandPickerModal
          targets={targets}
          counts={counts}
          selected={selectedBrands}
          displayNames={brandDisplayName}
          isAdmin={isAdmin}
          onSetCategory={setBrandCategory}
          onToggle={(id) => {
            setSelectedBrands((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
            setActiveCategory("all"); // 브랜드 선택은 카테고리/클라이언트보다 우선(AND로 빈 화면 방지)
            setSelectedClient("all");
            resetToFirst();
          }}
          onSelectMany={(ids) => {
            setSelectedBrands(ids);
            setActiveCategory("all");
            setSelectedClient("all");
            resetToFirst();
          }}
          onClear={() => {
            setSelectedBrands([]);
            resetToFirst();
          }}
          onClose={() => setShowBrandPicker(false)}
        />
      )}

      {/* 클라이언트 필터 플로팅(고르기) */}
      {showClientPicker && (
        <ClientPickerModal
          clients={clients}
          targets={targets}
          selected={selectedClient}
          onSelect={(id) => {
            setSelectedClient(id);
            if (id !== "all") {
              setSelectedBrands([]);
              setActiveCategory("all");
            }
            resetToFirst();
            setShowClientPicker(false);
          }}
          onEditMapping={() => {
            setShowClientPicker(false);
            setShowClientMap(true);
          }}
          onClose={() => setShowClientPicker(false)}
        />
      )}

      {/* 클라이언트별 브랜드 매핑 플로팅(편집) */}
      {showClientMap && (
        <ClientMapModal
          clients={clients}
          targets={targets}
          counts={counts}
          displayNames={brandDisplayName}
          onToggle={setBrandClient}
          onClose={() => setShowClientMap(false)}
        />
      )}

      {/* #5 변화 피드 모달 */}
      {showFeed && (
        <ChangeFeedModal
          ads={ads}
          brandNameOf={brandNameOfAd}
          onClose={() => setShowFeed(false)}
          onOpen={(ad) => {
            setShowFeed(false);
            openDetail(ad);
          }}
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
                  {addNotice && (
                    <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 p-2.5 text-xs text-green-800 dark:text-green-300">
                      {addNotice}
                    </div>
                  )}
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

type AnalysisData = {
  summary?: string;
  phases?: { name: string; weight: number; desc?: string }[];
  engagement?: { t: number; v: number }[];
  markers?: { t: number; label: string; note?: string }[];
  segments?: { name: string; t?: number; good?: string; bad?: string }[];
  userMarkers?: { t: number; note: string }[];
  target?: string;
  offer?: string;
  strengths?: string[];
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function parseAnalysis(raw: string | null): AnalysisData | null {
  if (!raw) return null;
  const ok = (o: any): AnalysisData | null =>
    o && typeof o === "object" && (Array.isArray(o.phases) || Array.isArray(o.engagement)) ? o : null;
  try {
    const o = ok(JSON.parse(raw));
    if (o) return o;
  } catch {}
  // 앞뒤에 텍스트가 섞인 경우: 첫 '{' 부터 균형 맞는 '}' 까지만 추출해 파싱
  const s = raw.indexOf("{");
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return ok(JSON.parse(raw.slice(s, i + 1)));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const PHASE_COLORS = ["#3b82f6", "#0ea5e9", "#6366f1", "#22c55e", "#a855f7", "#14b8a6", "#ec4899"];
const SEG_COLORS = PHASE_COLORS;
const CURVE = "#2563eb"; // 몰입 곡선 색(파랑)

function fmtClock(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// 구간 프레임: 영상의 t(0~100) 지점 정지화면. 클릭하면 메인 영상이 그 지점으로 이동+재생.
function SegFrame({ src, t, onSeek }: { src: string; t: number; onSeek?: (t: number) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSeek?.(t)}
      title="이 지점부터 재생"
      className="group relative block overflow-hidden rounded"
    >
      <video
        src={src}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d) && d > 0) {
            try {
              e.currentTarget.currentTime = Math.min(d - 0.05, (t / 100) * d);
            } catch {}
          }
        }}
        className="h-16 w-12 object-cover bg-black"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30">
        <Play className="h-4 w-4 fill-white text-white opacity-0 group-hover:opacity-100" />
      </span>
    </button>
  );
}

function AnalysisViz({
  data,
  videoUrl,
  onMarkersChange,
  videoRef,
}: {
  data: AnalysisData;
  videoUrl?: string | null;
  onMarkersChange?: (markers: { t: number; note: string }[]) => void;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
}) {
  const phases = (data.phases || []).filter((p) => p && p.name);
  const totalWeight = phases.reduce((s, p) => s + (Number(p.weight) || 0), 0) || 1;
  const pts = (data.engagement || [])
    .map((p) => ({ t: clamp(Number(p.t) || 0, 0, 100), v: clamp(Number(p.v) || 0, 0, 100) }))
    .sort((a, b) => a.t - b.t);
  const markers = (data.markers || []).map((m) => ({
    t: clamp(Number(m.t) || 0, 0, 100),
    label: m.label || "",
    note: m.note || "",
  }));
  const segments = (data.segments || []).filter((s) => s && s.name);
  const userMarkers = (data.userMarkers || []).map((m) => ({ t: clamp(Number(m.t) || 0, 0, 100), note: m.note || "" }));

  // 호버 위치(0~100) — 구간 흐름 툴팁용
  const [hover, setHover] = useState<number | null>(null);
  const [vidDur, setVidDur] = useState(0);
  const [playPct, setPlayPct] = useState<number | null>(null); // 메인 영상 재생 위치(인디케이터)
  const draggingRef = useRef(false);

  // 메인 영상과 동기화: 길이 + 재생 위치(인디케이터가 재생/스크럽 따라 움직이게)
  useEffect(() => {
    const v = videoRef?.current;
    if (!v) return;
    const onMeta = () => {
      if (isFinite(v.duration) && v.duration > 0) setVidDur(v.duration);
    };
    const onTime = () => {
      if (v.duration > 0) setPlayPct((v.currentTime / v.duration) * 100);
    };
    onMeta();
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("timeupdate", onTime);
    return () => {
      v.removeEventListener("loadedmetadata", onMeta);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [videoRef]);

  // 그래프 위치 t(0~100)로 메인 영상 이동. play=true면 재생까지.
  function seek(t: number, play: boolean) {
    setPlayPct(t); // 인디케이터 즉시 반영(낙관적)
    const v = videoRef?.current;
    if (!v) return;
    const apply = () => {
      const d = v.duration;
      if (isFinite(d) && d > 0) {
        try {
          v.currentTime = Math.min(d - 0.05, (t / 100) * d);
        } catch {}
      }
    };
    if (isFinite(v.duration) && v.duration > 0) apply();
    else v.addEventListener("loadedmetadata", apply, { once: true });
    if (play) v.play?.().catch(() => {});
  }

  const pctFromX = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * 100, 0, 100);
  };

  // 진행률 t(0~100)가 속한 구간(phase)
  function phaseAt(t: number): { phase: { name: string; weight: number; desc?: string }; idx: number } | null {
    let acc = 0;
    for (let i = 0; i < phases.length; i++) {
      const w = ((Number(phases[i].weight) || 0) / totalWeight) * 100;
      if (t <= acc + w || i === phases.length - 1) return { phase: phases[i], idx: i };
      acc += w;
    }
    return null;
  }

  // 영상이면 t(0~100) → 시:분 표기
  const timeLabel = (t: number) => (videoUrl && vidDur > 0 ? fmtClock((t / 100) * vidDur) : `${Math.round(t)}%`);

  // 사용자 마커(메모) — 부모가 분석 JSON(userMarkers)에 합쳐 '저장' 버튼으로 영구화
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<number | null>(null); // 위치 이동(드래그) 편집 중인 마커
  const graphRef = useRef<HTMLDivElement>(null);
  const markerDragRef = useRef<number | null>(null);
  function addMarker(t: number) {
    const next = [...userMarkers, { t: Math.round(t), note: "" }];
    onMarkersChange?.(next);
    setEditingIdx(next.length - 1); // 새 마커 입력에 바로 포커스
  }
  function updateMarker(i: number, note: string) {
    onMarkersChange?.(userMarkers.map((m, j) => (j === i ? { ...m, note } : m)));
  }
  function updateMarkerT(i: number, t: number) {
    onMarkersChange?.(userMarkers.map((m, j) => (j === i ? { ...m, t: Math.round(clamp(t, 0, 100)) } : m)));
  }
  function removeMarker(i: number) {
    if (editTarget === i) setEditTarget(null);
    onMarkersChange?.(userMarkers.filter((_, j) => j !== i));
  }

  const yTop = (v: number) => 88 - (v / 100) * 76; // v 0~100 → top% 88..12
  function interpV(t: number) {
    if (!pts.length) return 50;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.t && t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / ((b.t - a.t) || 1);
    }
    return 50;
  }
  const linePath = pts.length ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.t} ${yTop(p.v)}`).join(" ") : "";
  const areaPath = pts.length ? `${linePath} L ${pts[pts.length - 1].t} 100 L ${pts[0].t} 100 Z` : "";

  return (
    <div className="space-y-3">
      {data.summary && <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{data.summary}</p>}

      {phases.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold text-gray-400">구간 흐름</div>
          <div className="flex h-7 w-full overflow-hidden rounded-lg">
            {phases.map((p, i) => (
              <div
                key={i}
                title={p.desc || p.name}
                style={{ width: `${((Number(p.weight) || 0) / totalWeight) * 100}%`, backgroundColor: PHASE_COLORS[i % PHASE_COLORS.length] }}
                className="flex items-center justify-center truncate px-1 text-[10px] font-bold text-white"
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {pts.length > 0 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] font-bold text-gray-400">시청자 몰입 흐름 (추정){videoUrl ? " · 클릭/드래그로 영상 이동" : ""}</span>
            {onMarkersChange && (
              <button
                onClick={() => addMarker(hover ?? playPct ?? 50)}
                className="flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
              >
                <MapPin className="h-3 w-3" /> 마커 추가
              </button>
            )}
          </div>
          <div
            ref={graphRef}
            className={`relative h-28 w-full touch-none select-none rounded-lg border border-gray-100 dark:border-gray-800 bg-gradient-to-b from-blue-50/70 to-transparent dark:from-blue-950/20 ${videoUrl ? "cursor-pointer" : ""}`}
            onPointerDown={(e) => {
              if (!videoUrl) return;
              if (markerDragRef.current != null) return; // 마커 드래그 중이면 스크럽 안 함
              (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
              draggingRef.current = true;
              seek(pctFromX(e.clientX, e.currentTarget), false);
            }}
            onPointerMove={(e) => {
              const x = pctFromX(e.clientX, e.currentTarget);
              setHover(x);
              if (draggingRef.current && videoUrl) seek(x, false); // 드래그 스크럽
            }}
            onPointerUp={(e) => {
              if (draggingRef.current) {
                draggingRef.current = false;
                if (videoUrl) seek(pctFromX(e.clientX, e.currentTarget), true); // 놓으면 그 지점부터 재생
              }
            }}
            onPointerLeave={() => {
              if (!draggingRef.current) setHover(null);
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <path d={areaPath} fill="rgba(37,99,235,0.15)" />
              <path d={linePath} fill="none" stroke={CURVE} strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            {/* AI 마커(파랑 점) */}
            {markers.map((m, i) => (
              <div
                key={i}
                style={{ left: `${m.t}%`, top: `${yTop(interpV(m.t))}%` }}
                title={m.label + (m.note ? ` · ${m.note}` : "")}
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-gray-900"
              />
            ))}
            {/* 사용자 마커(주황 깃발) — 편집 중인 마커는 그래프에서 드래그로 위치 이동 */}
            {userMarkers.map((m, i) => {
              const isEdit = editTarget === i;
              const dim = editTarget != null && !isEdit;
              return (
                <div
                  key={`u${i}`}
                  style={{ left: `${m.t}%` }}
                  className={`absolute bottom-0 top-0 w-px ${isEdit ? "bg-amber-600" : "bg-amber-400"} ${isEdit ? "" : "pointer-events-none"} ${dim ? "opacity-30" : ""}`}
                  title={m.note}
                >
                  <div
                    onPointerDown={
                      isEdit
                        ? (e) => {
                            e.stopPropagation();
                            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                            markerDragRef.current = i;
                          }
                        : undefined
                    }
                    onPointerMove={
                      isEdit
                        ? (e) => {
                            if (markerDragRef.current === i && graphRef.current) {
                              e.stopPropagation();
                              updateMarkerT(i, pctFromX(e.clientX, graphRef.current));
                            }
                          }
                        : undefined
                    }
                    onPointerUp={
                      isEdit
                        ? (e) => {
                            e.stopPropagation();
                            markerDragRef.current = null;
                          }
                        : undefined
                    }
                    className={`absolute -top-1 left-0 flex -translate-x-1/2 items-center justify-center rounded-sm font-bold text-white ${
                      isEdit ? "h-5 w-5 animate-pulse cursor-ew-resize bg-amber-600 text-[10px] ring-2 ring-amber-300" : "h-4 w-4 bg-amber-500 text-[9px]"
                    }`}
                  >
                    {i + 1}
                  </div>
                </div>
              );
            })}
            {/* 재생 위치 인디게이터 — 영상 재생/스크럽에 따라 이동 */}
            {playPct != null && (
              <div style={{ left: `${clamp(playPct, 0, 100)}%` }} className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 -translate-x-1/2 bg-blue-600">
                <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-blue-600 shadow ring-2 ring-white dark:ring-gray-900" />
              </div>
            )}
            {/* 호버 시 구간 흐름 툴팁(프리뷰 이미지 없음) */}
            {hover != null &&
              (() => {
                const pa = phaseAt(hover);
                return (
                  <>
                    <div style={{ left: `${hover}%` }} className="pointer-events-none absolute bottom-0 top-0 w-px bg-blue-400/50" />
                    <div
                      style={{ left: `${clamp(hover, 15, 85)}%` }}
                      className="pointer-events-none absolute bottom-[104%] z-20 w-44 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
                    >
                      <div className="flex items-center gap-1.5">
                        {pa && (
                          <span className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: PHASE_COLORS[pa.idx % PHASE_COLORS.length] }}>
                            {pa.phase.name}
                          </span>
                        )}
                        <span className="text-[10px] text-gray-400">
                          {timeLabel(hover)} · 몰입 {Math.round(interpV(hover))}
                        </span>
                      </div>
                      {pa?.phase.desc && <p className="mt-1 text-[11px] leading-snug text-gray-600 dark:text-gray-300">{pa.phase.desc}</p>}
                    </div>
                  </>
                );
              })()}
          </div>

          {/* 내 마커 메모 편집 */}
          {onMarkersChange && userMarkers.length > 0 && (
            <div className="mt-2 space-y-1">
              {editTarget != null && (
                <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  ✋ 그래프에서 {editTarget + 1}번 마커를 좌우로 드래그해 위치를 옮기세요. (완료 버튼으로 종료)
                </p>
              )}
              {userMarkers.map((m, i) => {
                const isEdit = editTarget === i;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-1.5 rounded px-1 py-0.5 ${isEdit ? "bg-amber-50 ring-1 ring-amber-300 dark:bg-amber-900/20 dark:ring-amber-700" : ""}`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm bg-amber-500 text-[9px] font-bold text-white">{i + 1}</span>
                    <button onClick={() => seek(m.t, true)} title="이 지점부터 재생" className="w-10 shrink-0 text-left text-[10px] text-blue-600 hover:underline">
                      {timeLabel(m.t)}
                    </button>
                    <input
                      autoFocus={editingIdx === i}
                      value={m.note}
                      onChange={(e) => updateMarker(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          setEditingIdx(null);
                          (e.target as HTMLInputElement).blur(); // 엔터 → 마커 확정
                        }
                      }}
                      placeholder="이 지점 메모 후 Enter"
                      className="flex-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-[11px] dark:text-gray-200"
                    />
                    <button
                      onClick={() => {
                        const next = isEdit ? null : i;
                        setEditTarget(next);
                        if (next != null) seek(m.t, false); // 편집 시작 시 그 지점으로 영상 이동(집중)
                      }}
                      title={isEdit ? "위치 편집 완료" : "위치 이동(그래프에서 드래그)"}
                      className={`shrink-0 rounded p-0.5 ${isEdit ? "bg-amber-500 text-white" : "text-gray-400 hover:text-amber-600"}`}
                    >
                      {isEdit ? <Check className="h-3.5 w-3.5" /> : <Move className="h-3.5 w-3.5" />}
                    </button>
                    <button onClick={() => removeMarker(i)} title="마커 삭제" className="shrink-0 rounded p-0.5 text-gray-400 hover:text-red-500">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {markers.length > 0 && (
        <div className="space-y-1">
          {markers.map((m, i) => (
            <div key={i} className="text-[12px] leading-snug">
              <span className="font-bold text-blue-600 dark:text-blue-400">✦ {m.label}</span>
              {m.note && <span className="text-gray-500 dark:text-gray-400"> — {m.note}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 구간별 잘한 점 · 아쉬운 점 표: 숫자 | 시간 | 프레임 | 잘한 점 | 아쉬운 점 */}
      {segments.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-gray-400">구간별 잘한 점 · 아쉬운 점</div>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-400 dark:bg-gray-800/60">
              <span className="w-4 text-center">#</span>
              <span className="w-10">시간</span>
              {videoUrl && <span className="w-12">프레임</span>}
              <span className="flex-1">잘한 점</span>
              <span className="flex-1">아쉬운 점</span>
            </div>
            {segments.map((s, i) => {
              const t = typeof s.t === "number" ? s.t : (i / Math.max(1, segments.length - 1)) * 100;
              return (
                <div key={i} className="flex items-start gap-2 border-t border-gray-100 px-2 py-2 text-[12px] dark:border-gray-800">
                  <span
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                    style={{ backgroundColor: SEG_COLORS[i % SEG_COLORS.length] }}
                  >
                    {i + 1}
                  </span>
                  <span className="w-10 shrink-0 leading-tight">
                    <span className="block text-[11px] font-medium text-gray-700 dark:text-gray-200">{timeLabel(t)}</span>
                    <span className="block truncate text-[9px] text-gray-400" title={s.name}>{s.name}</span>
                  </span>
                  {videoUrl && (
                    <div className="w-12 shrink-0">
                      <SegFrame src={videoUrl} t={t} onSeek={(tt) => seek(tt, true)} />
                    </div>
                  )}
                  <div className="flex-1 leading-snug text-green-700 dark:text-green-400">{s.good || "—"}</div>
                  <div className="flex-1 leading-snug text-amber-700 dark:text-amber-500">{s.bad || "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(data.target || data.offer) && (
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {data.target && (
            <div>
              <div className="text-gray-400">타겟</div>
              <div className="font-medium dark:text-gray-200">{data.target}</div>
            </div>
          )}
          {data.offer && (
            <div>
              <div className="text-gray-400">오퍼</div>
              <div className="font-medium dark:text-gray-200">{data.offer}</div>
            </div>
          )}
        </div>
      )}

      {segments.length === 0 && data.strengths && data.strengths.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold text-gray-400">잘된 점</div>
          <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-gray-600 dark:text-gray-300">
            {data.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ── 브랜드 선택 플로팅: 카테고리 필터 + 검색 + 다중 선택 ── */
function BrandPickerModal({
  targets,
  counts,
  selected,
  displayNames,
  isAdmin,
  onSetCategory,
  onToggle,
  onSelectMany,
  onClear,
  onClose,
}: {
  targets: Target[];
  counts: Record<string, number>;
  selected: string[];
  displayNames: Record<string, string>;
  isAdmin: boolean;
  onSetCategory: (targetId: string, category: string) => void;
  onToggle: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");

  const cats = useMemo(() => {
    const set = new Set<string>();
    for (const t of targets) set.add((t.category || "").trim() || "미분류");
    return Array.from(set).sort((a, b) => {
      if (a === "기타") return 1;
      if (b === "기타") return -1;
      return a.localeCompare(b, "ko");
    });
  }, [targets]);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return targets
      .map((t) => ({ t, n: counts[t.id] || 0, c: (t.category || "").trim() || "미분류" }))
      .filter(({ t, c }) => {
        if (cat !== "all" && c !== cat) return false;
        if (kw && !((t.profile_name || t.label || "").toLowerCase().includes(kw))) return false;
        return true;
      })
      .sort((a, b) => b.n - a.n); // 광고 많은 순
  }, [targets, counts, q, cat]);

  const selectedSet = new Set(selected);
  const visibleIds = rows.map((r) => r.t.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="mt-[6vh] w-full max-w-4xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl flex max-h-[82vh] flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold dark:text-gray-100">브랜드 선택</h3>
            {selected.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {selected.length}개 선택됨
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 검색 + 카테고리 필터 */}
        <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="브랜드명 검색"
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCat("all")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                cat === "all" ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              전체
            </button>
            {cats.map((c) => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  cat === c ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {/* 일괄 동작 */}
        <div className="flex items-center justify-between px-5 py-2 text-xs">
          <span className="text-gray-400">{rows.length}개 브랜드</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSelectMany(allVisibleSelected ? selected.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selected, ...visibleIds])))}
              className="font-medium text-primary hover:underline"
            >
              {allVisibleSelected ? "보이는 항목 해제" : "보이는 항목 전체 선택"}
            </button>
            {selected.length > 0 && (
              <button onClick={onClear} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                전체 해제
              </button>
            )}
          </div>
        </div>

        {/* 브랜드 목록 */}
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">검색 결과가 없습니다.</p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map(({ t, n, c }) => {
                const on = selectedSet.has(t.id);
                const catOpts = CATEGORY_OPTIONS.includes(c) ? CATEGORY_OPTIONS : [c, ...CATEGORY_OPTIONS];
                return (
                  <li
                    key={t.id}
                    className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${
                      on ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    <button onClick={() => onToggle(t.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span
                        className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${
                          on ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-gray-600"
                        }`}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                      {t.profile_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.profile_image} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-500">
                          {(t.profile_name || t.label || "?").slice(0, 1)}
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium dark:text-gray-200">{displayNames[t.id] || t.profile_name || t.label}</span>
                        {t.summary && <p className="truncate text-xs text-gray-400">{t.summary}</p>}
                      </div>
                    </button>
                    {/* 카테고리: 관리자만 수정 가능(즉시 반영), 그 외엔 읽기전용 태그 */}
                    {isAdmin ? (
                      <select
                        value={c}
                        onChange={(e) => onSetCategory(t.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        title="대분류 수정 (관리자 전용)"
                        className="max-w-[130px] flex-shrink-0 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-[11px] text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary/40"
                      >
                        {catOpts.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="flex-shrink-0 rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">{c}</span>
                    )}
                    <span className="flex-shrink-0 text-xs font-semibold text-gray-400">{n}건</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 푸터 */}
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3">
          <button
            onClick={onClose}
            className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90"
          >
            {selected.length > 0 ? `${selected.length}개 브랜드 보기` : "전체 브랜드 보기"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 클라이언트 필터 플로팅: 클라이언트 1개 선택(전체/개별) + 매핑 편집 진입 ── */
function ClientPickerModal({
  clients,
  targets,
  selected,
  onSelect,
  onEditMapping,
  onClose,
}: {
  clients: Client[];
  targets: Target[];
  selected: string;
  onSelect: (id: string) => void;
  onEditMapping: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const mappedCount = (clientId: string) =>
    targets.filter((t) => Array.isArray(t.client_ids) && t.client_ids.includes(clientId)).length;

  const kw = q.trim().toLowerCase();
  const list = clients.filter((c) => !kw || c.name.toLowerCase().includes(kw));

  const Row = ({ id, name, count, active }: { id: string; name: string; count?: number; active: boolean }) => (
    <button
      onClick={() => onSelect(id)}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${
        active ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${active ? "border-primary" : "border-gray-300 dark:border-gray-600"}`}>
        {active && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="flex-1 truncate text-sm font-medium dark:text-gray-200">{name}</span>
      {typeof count === "number" && <span className="flex-shrink-0 text-xs text-gray-400">{count}개 브랜드</span>}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-[8vh] flex max-h-[78vh] w-full max-w-md flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold dark:text-gray-100">클라이언트 선택</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {clients.length > 6 && (
          <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="클라이언트 검색"
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-3 py-2">
          {clients.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              클라이언트가 없습니다.<br />
              <span className="text-xs">&apos;기획안 제작&apos;에서 먼저 추가하세요.</span>
            </p>
          ) : (
            <ul className="space-y-0.5">
              <li><Row id="all" name="전체" active={selected === "all"} /></li>
              {list.map((c) => (
                <li key={c.id}><Row id={c.id} name={c.name} count={mappedCount(c.id)} active={selected === c.id} /></li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3">
          <button
            onClick={onEditMapping}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 py-2.5 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <Pencil className="h-4 w-4" /> 브랜드 매핑 편집
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 클라이언트별 브랜드 매핑: 클라이언트 1개 선택 → 브랜드 체크(중복 허용) ── */
function ClientMapModal({
  clients,
  targets,
  counts,
  displayNames,
  onToggle,
  onClose,
}: {
  clients: Client[];
  targets: Target[];
  counts: Record<string, number>;
  displayNames: Record<string, string>;
  onToggle: (targetId: string, clientId: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [editClient, setEditClient] = useState<string>(clients[0]?.id ?? "");
  const [q, setQ] = useState("");

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "(삭제된 클라이언트)";

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return targets
      .map((t) => ({ t, n: counts[t.id] || 0 }))
      .filter(({ t }) => !kw || (t.profile_name || t.label || "").toLowerCase().includes(kw))
      .sort((a, b) => b.n - a.n);
  }, [targets, counts, q]);

  const mappedCount = editClient
    ? targets.filter((t) => Array.isArray(t.client_ids) && t.client_ids.includes(editClient)).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-[6vh] flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold dark:text-gray-100">클라이언트별 브랜드 매핑</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>

        {clients.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            클라이언트가 없습니다.<br />
            <span className="text-xs">먼저 &apos;기획안 제작&apos;에서 클라이언트를 추가해 주세요.</span>
          </div>
        ) : (
          <>
            {/* 클라이언트 선택(편집 대상) */}
            <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3">
              <div className="mb-2 text-xs font-semibold text-gray-400">편집할 클라이언트 선택</div>
              <div className="flex flex-wrap gap-1.5">
                {clients.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setEditClient(c.id)}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      editClient === c.id ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 검색 + 안내 */}
            <div className="flex items-center gap-3 border-b border-gray-100 dark:border-gray-800 px-5 py-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="브랜드명 검색"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <span className="whitespace-nowrap text-xs text-gray-400">
                <b className="text-primary">{clientName(editClient)}</b> · {mappedCount}개 매핑됨
              </span>
            </div>

            {/* 브랜드 목록(체크 = 이 클라이언트에 속함) */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <ul className="space-y-0.5">
                {rows.map(({ t, n }) => {
                  const cids = Array.isArray(t.client_ids) ? t.client_ids : [];
                  const on = cids.includes(editClient);
                  const others = cids.filter((id) => id !== editClient);
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => onToggle(t.id, editClient, !on)}
                        className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${
                          on ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                        }`}
                      >
                        <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-gray-600"}`}>
                          {on && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="truncate text-sm font-medium dark:text-gray-200">{displayNames[t.id] || t.profile_name || t.label}</span>
                          {others.length > 0 && (
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              {others.map((id) => (
                                <span key={id} className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                                  {clientName(id)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="flex-shrink-0 text-xs font-semibold text-gray-400">{n}건</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* 푸터 */}
            <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3">
              <button onClick={onClose} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90">
                완료
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── #5 변화 피드: 최근 신규 / 종료 소재 타임라인 ── */
function ChangeFeedModal({
  ads,
  brandNameOf,
  onClose,
  onOpen,
}: {
  ads: Ad[];
  brandNameOf: (ad: Ad) => string;
  onClose: () => void;
  onOpen: (ad: Ad) => void;
}) {
  const WINDOW_MS = 14 * 24 * 3600 * 1000;
  const now = Date.now();
  const fresh = [...ads]
    .filter((a) => a.first_seen_at && now - new Date(a.first_seen_at).getTime() < WINDOW_MS)
    .sort((a, b) => new Date(b.first_seen_at).getTime() - new Date(a.first_seen_at).getTime())
    .slice(0, 60);
  const ended = ads
    .filter((a) => a.status === "ended" && a.ended_at)
    .sort((a, b) => new Date(b.ended_at!).getTime() - new Date(a.ended_at!).getTime())
    .slice(0, 60);

  const typeLabel = (ad: Ad) =>
    ad.media_type === "video" ? "영상" : ad.media_type === "carousel" || (ad.media_urls && ad.media_urls.length > 1) ? "슬라이드" : "이미지";

  const Row = ({ ad, when }: { ad: Ad; when: string | null | undefined }) => (
    <button
      onClick={() => onOpen(ad)}
      className="flex w-full items-center gap-2.5 rounded-lg border border-gray-100 dark:border-gray-800 p-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
        {posterThumb(ad) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={posterThumb(ad)!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Megaphone className="h-4 w-4 text-gray-300 dark:text-gray-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold dark:text-gray-100">{brandNameOf(ad)}</div>
        <div className="truncate text-[11px] text-gray-400">
          {typeLabel(ad)} · {fmtDate(when)}
        </div>
      </div>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="my-8 w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-base font-bold dark:text-white">
            <Activity className="h-4 w-4 text-primary" /> 변화 피드 <span className="text-xs font-normal text-gray-400">최근 14일</span>
          </h2>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid max-h-[75vh] gap-4 overflow-y-auto p-5 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-green-600">
              <span className="h-2 w-2 rounded-full bg-green-500" /> 신규 등장 ({fresh.length})
            </div>
            <div className="space-y-1.5">
              {fresh.length === 0 ? (
                <p className="text-sm text-gray-400">최근 신규 소재가 없습니다.</p>
              ) : (
                fresh.map((ad) => <Row key={ad.library_id} ad={ad} when={ad.first_seen_at} />)
              )}
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-sm font-bold text-gray-500">
              <span className="h-2 w-2 rounded-full bg-gray-400" /> 내려간 소재 ({ended.length})
            </div>
            <div className="space-y-1.5">
              {ended.length === 0 ? (
                <p className="text-sm text-gray-400">최근 종료된 소재가 없습니다.</p>
              ) : (
                ended.map((ad) => <Row key={ad.library_id} ad={ad} when={ad.ended_at} />)
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdDetailModal({
  ad,
  brandName,
  brandImage,
  country,
  variations,
  brandNameOf,
  onClose,
  onMemoSaved,
  onAnalyzed,
  onTranscribed,
  onToggleSaved,
  onOpenVariation,
  onSeed,
}: {
  ad: Ad;
  brandName: string;
  brandImage: string | null;
  country: string | null;
  variations: Ad[];
  brandNameOf: (ad: Ad) => string;
  onClose: () => void;
  onMemoSaved: (libraryId: string, memo: string) => void;
  onAnalyzed: (libraryId: string, analysis: string) => void;
  onTranscribed: (libraryId: string, transcript: string) => void;
  onToggleSaved: (ad: Ad) => void;
  onOpenVariation: (ad: Ad) => void;
  onSeed: (ad: Ad, dest: "plan" | "guide") => void;
}) {
  const [memo, setMemo] = useState(ad.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(ad.ai_analysis ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSaved, setAnalysisSaved] = useState<boolean>(!!ad.ai_analysis);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(ad.transcript ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptErr, setTranscriptErr] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false); // 미저장 변경 닫기 확인
  const [linkCopied, setLinkCopied] = useState(false); // 공유 링크 복사 피드백
  const ended = ad.status === "ended";

  // 메인 영상: 그래프 드래그/클릭·프레임 클릭으로 이동+재생(AnalysisViz가 ref로 직접 제어)
  const mainVideoRef = useRef<HTMLVideoElement | null>(null);

  // 스페이스바 → 영상 재생/정지 토글. 단, 입력란(메모 등) 작성 중이면 원래 띄어쓰기로 동작.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.code !== "Space" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      const tag = (t?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable) return;
      const v = mainVideoRef.current;
      if (!v) return; // 영상 광고가 아니면 무시(스크롤 등 기본동작 유지)
      e.preventDefault();
      if (v.paused) v.play().catch(() => {});
      else v.pause();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 상세 지연 로딩으로 ad.memo / ad.ai_analysis 가 나중에 채워지면 동기화
  useEffect(() => {
    setMemo(ad.memo ?? "");
  }, [ad.memo]);
  useEffect(() => {
    setAnalysis(ad.ai_analysis ?? null);
    setAnalysisSaved(!!ad.ai_analysis);
  }, [ad.ai_analysis]);
  useEffect(() => {
    setTranscript(ad.transcript ?? null);
    setTranscriptErr(null);
  }, [ad.transcript, ad.library_id]);

  async function runTranscript() {
    setTranscribing(true);
    setTranscriptErr(null);
    try {
      const res = await aiFetch("/api/meta-ad/transcript", {
        method: "POST",
        body: JSON.stringify({ library_id: ad.library_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTranscriptErr(j.error || "대본 추출에 실패했어요.");
        return;
      }
      if (j.empty) {
        setTranscript("");
        setTranscriptErr("나레이션(음성)이 감지되지 않았어요.");
        return;
      }
      setTranscript(j.transcript || "");
      // 대본은 자동 저장(서버가 DB 기록) — 앱 상태에도 즉시 반영해 다시 열어도 유지.
      if (j.transcript) onTranscribed(ad.library_id, j.transcript);
    } catch {
      setTranscriptErr("대본 추출 중 오류가 발생했어요.");
    } finally {
      setTranscribing(false);
    }
  }

  // 메모 세로 자동 확장 (내용 길어져도 잘리지 않게)
  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = memoRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [memo]);

  // AI 분석을 DB에 저장(공용). silent=true 면 실패해도 alert 안 띄움(자동저장/닫기저장용).
  async function persistAnalysis(value: string, silent = false): Promise<boolean> {
    try {
      const res = await fetch(`/api/meta-ad/ads/${ad.library_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ai_analysis: value }),
      });
      if (res.ok) {
        setAnalysisSaved(true);
        onAnalyzed(ad.library_id, value);
        return true;
      }
      if (!silent) alert("분석 저장 실패");
      return false;
    } catch {
      if (!silent) alert("분석 저장 실패");
      return false;
    }
  }

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
      const result = j.analysis || "분석 결과가 없습니다.";
      setAnalysis(result);
      // 생성 즉시 자동 저장 — 사용자가 따로 '저장'을 안 눌러도 보존됨.
      await persistAnalysis(result, true);
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveAnalysis() {
    if (!analysis) return;
    setSavingAnalysis(true);
    try {
      await persistAnalysis(analysis);
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

  // 미저장 변경 여부: 메모가 바뀌었거나, AI 분석/마커가 저장 안 됨
  const isDirty = () => memo !== (ad.memo ?? "") || (!!analysis && !analysisSaved);

  // X/바깥 클릭 시: 변경 없으면 바로 닫고, 있으면 안내(저장하여 닫기/닫기)
  function requestClose() {
    if (isDirty()) setConfirmClose(true);
    else onClose();
  }

  async function saveAndClose() {
    if (memo !== (ad.memo ?? "")) await saveMemo();
    if (analysis && !analysisSaved) await persistAnalysis(analysis, true);
    onClose();
  }

  // 외부 공개 링크(로그인 없이 클라이언트·프리랜서가 보는 페이지) 복사
  function copyShareLink() {
    const url = `${window.location.origin}/meta-ad/share/${ad.library_id}`;
    const ok = () => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1800);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(ok).catch(() => window.prompt("공유 링크 (복사하세요)", url));
    } else {
      window.prompt("공유 링크 (복사하세요)", url);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={requestClose}>
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
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onToggleSaved(ad)}
              title={ad.saved ? "스와이프 파일에서 제거" : "스와이프 파일에 저장"}
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                ad.saved
                  ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <Star className={`h-3.5 w-3.5 ${ad.saved ? "fill-amber-400 text-amber-400" : ""}`} />
              {ad.saved ? "저장됨" : "스와이프"}
            </button>
            <button
              onClick={copyShareLink}
              title="외부 공개 링크 복사 (로그인 없이 클라이언트·프리랜서가 볼 수 있는 페이지)"
              className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                linkCopied
                  ? "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/30 dark:text-green-300"
                  : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              {linkCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
              {linkCopied ? "복사됨" : "공유 URL"}
            </button>
            <a href={sourceLink(ad)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">
              <ExternalLink className="h-3.5 w-3.5" /> 광고 라이브러리
            </a>
            <button onClick={requestClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="grid flex-1 overflow-hidden md:grid-cols-2">
          {/* 좌: 미디어 + T&D (소재 바로 밑) */}
          <div className="space-y-4 overflow-y-auto border-b p-4 dark:border-gray-800 md:border-b-0 md:border-r">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl bg-black dark:bg-black">
              <MediaView ad={ad} rounded="rounded-xl" videoRef={mainVideoRef} />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">제목 · 캡션 (T&D)</span>
                {ad.media_type === "video" && (
                  <button
                    onClick={runTranscript}
                    disabled={transcribing}
                    title="영상 나레이션을 텍스트로 받아쓰기 (리메이크용 대본)"
                    className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 dark:bg-primary/10"
                  >
                    {transcribing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
                    {transcribing ? "받아쓰는 중..." : transcript ? "대본 다시" : "대본"}
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3.5 text-sm leading-relaxed text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">
                {cleanCaption(ad.ad_text, brandName)}
              </p>

              {transcribing && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800/50">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 영상 음성에서 나레이션을 받아쓰는 중...
                </div>
              )}
              {transcriptErr && !transcribing && (
                <div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
                  {transcriptErr}
                </div>
              )}
              {transcript && !transcribing && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">🎙️ 나레이션 대본</span>
                    <button
                      onClick={() => navigator.clipboard?.writeText(transcript)}
                      className="text-[11px] font-medium text-primary hover:underline"
                    >
                      복사
                    </button>
                  </div>
                  <p className="whitespace-pre-wrap rounded-lg border border-primary/20 bg-primary/[0.03] p-3 text-sm leading-relaxed text-gray-700 dark:bg-primary/[0.06] dark:text-gray-200">
                    {transcript}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 우: 메타데이터 + 링크 + 메모 */}
          <div className="overflow-y-auto p-5 space-y-4">
            {/* 메타데이터 */}
            <div className="rounded-xl border dark:border-gray-800 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">메타데이터</div>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <Meta k="시작일" v={ad.started_on ?? "—"} />
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
              <div>
                <span className="text-xs font-bold text-gray-400">랜딩 페이지</span>
                {ad.landing_url ? (
                  <a href={ad.landing_url} target="_blank" rel="noopener noreferrer" className="block truncate text-primary underline">{ad.landing_url}</a>
                ) : (
                  <span className="block text-xs text-gray-400">수집되지 않음 (다음 크롤링에서 채워질 수 있어요)</span>
                )}
              </div>
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
                  {(() => {
                    const parsed = parseAnalysis(analysis);
                    return parsed ? (
                      <AnalysisViz
                        data={parsed}
                        videoUrl={ad.media_type === "video" ? ad.media_url : null}
                        videoRef={ad.media_type === "video" ? mainVideoRef : undefined}
                        onMarkersChange={(markers) => {
                          const base = parseAnalysis(analysis) || {};
                          setAnalysis(JSON.stringify({ ...base, userMarkers: markers }));
                          setAnalysisSaved(false);
                        }}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{analysis}</p>
                    );
                  })()}
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

            {/* #4 변주 추정 (같은 브랜드 · 유사 카피/같은 랜딩) */}
            {variations.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-gray-400">
                  <Layers className="h-3.5 w-3.5" /> 변주 추정 ({variations.length})
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {variations.map((v) => (
                    <button
                      key={v.library_id}
                      onClick={() => onOpenVariation(v)}
                      title={cleanCaption(v.ad_text, brandNameOf(v)).slice(0, 80)}
                      className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800"
                    >
                      {posterThumb(v) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={posterThumb(v)!} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        <Megaphone className="h-5 w-5 text-gray-300 dark:text-gray-600" />
                      )}
                      {v.media_type === "video" && (
                        <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[8px] font-bold text-white">▶</span>
                      )}
                      {v.status === "ended" && (
                        <span className="absolute bottom-0 left-0 right-0 bg-gray-900/70 py-0.5 text-center text-[9px] font-bold text-white">종료</span>
                      )}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">같은 브랜드에서 비슷한 카피·랜딩으로 돌리는 변주로 추정됩니다.</p>
              </div>
            )}

            {/* #9 이 소재로 제작 시드 */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">이 소재로 만들기</div>
              <div className="flex flex-wrap gap-2">
                <button
                  disabled
                  title="추후 디벨롭 예정"
                  className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800/50 px-3 py-2 text-sm font-medium text-gray-400 dark:text-gray-500"
                >
                  <Lock className="h-3.5 w-3.5" /> 기획안 아이디어
                </button>
                <button
                  onClick={() => onSeed(ad, "guide")}
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  <Camera className="h-4 w-4" /> 촬영 가이드 <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">이 광고의 소구점·카피(분석 시 구간)를 입력값으로 채워 해당 페이지로 이동합니다.</p>
            </div>
          </div>
        </div>
      </div>

      {confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { e.stopPropagation(); setConfirmClose(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">저장하지 않은 변경이 있어요</div>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              메모나 분석 마커가 아직 저장되지 않았어요. 저장하고 닫을까요?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => { setConfirmClose(false); onClose(); }}
                className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                닫기
              </button>
              <button
                onClick={async () => { setConfirmClose(false); await saveAndClose(); }}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
              >
                저장하여 닫기
              </button>
            </div>
          </div>
        </div>
      )}
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
