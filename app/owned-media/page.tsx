"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { aiFetch } from "@/lib/ai-fetch";
import { getClients, type Client } from "@/lib/api/clients";
import { createMindmap } from "@/lib/api/mindmaps";
import { createContentGuide } from "@/lib/api/content-guides";
import {
  Activity,
  Settings,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
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
  Film,
  Play,
  ClipboardList,
  Filter,
  Users,
  ChevronDown,
  FileText,
  Network,
  ArrowUpRight,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Youtube,
  Instagram,
} from "lucide-react";

// ── 타입 ──
type Creator = {
  id: string;
  label: string;
  platform: "youtube" | "instagram";
  url: string | null;
  handle: string | null;
  profile_name: string | null;
  profile_image: string | null;
  category: string | null;
  client_ids?: string[] | null;
  summary?: string | null;
  enabled: boolean;
  created_at?: string | null;
};

type Post = {
  post_id: string;
  creator_id: string | null;
  creator_name: string | null;
  platform: "youtube" | "instagram";
  post_url: string | null;
  caption?: string | null;
  media_type: string | null; // 'video' | 'slide' | 'image'
  media_url: string | null;
  media_urls?: string[] | null;
  poster_url?: string | null;
  frames?: string[] | null;
  posted_at?: string | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  memo?: string | null;
  ai_analysis?: string | null;
  has_analysis?: boolean;
  transcript?: string | null;
  saved?: boolean | null;
  status?: string | null;
  ended_at?: string | null;
  first_seen_at: string;
  last_seen_at?: string | null;
};

const PAGE_SIZE = 15;

// 대분류 표준 목록 — 메타/구글 광고 크롤러와 동일 세트로 통일.
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

// ── 유틸 ──
function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 3600 * 1000;
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}
// 지표 표기: null/undefined ⇒ '—'(비공개), 그 외 천 단위 콤마.
function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(Number(n))) return "—";
  return Number(n).toLocaleString();
}
function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 55%)`;
}
function mediaListOf(p: Post): string[] {
  if (Array.isArray(p.media_urls) && p.media_urls.length) return p.media_urls.filter(Boolean) as string[];
  if (p.media_url) return [p.media_url];
  return [];
}
function posterThumb(p: Post): string | null {
  return p.poster_url || (Array.isArray(p.media_urls) && p.media_urls[0]) || p.media_url || null;
}
// post_id('yt_<id>') 또는 URL 에서 유튜브 videoId 추출 → 임베드 URL.
function youtubeEmbed(p: Post): string | null {
  let id = "";
  if (p.post_id?.startsWith("yt_")) id = p.post_id.slice(3);
  if (!id && p.post_url) {
    const m = p.post_url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{6,})/);
    if (m) id = m[1];
  }
  return id ? `https://www.youtube.com/embed/${id}` : null;
}
function platformLabel(pl: string): string {
  return pl === "instagram" ? "인스타그램" : "유튜브";
}
function typeLabelOf(p: Post): string {
  if (p.media_type === "video") return "영상";
  if (p.media_type === "slide" || (p.media_urls && p.media_urls.length > 1)) return "슬라이드";
  return "이미지";
}
function pageItems(current: number, total: number): number[] {
  const WINDOW = 10;
  if (total <= WINDOW) return Array.from({ length: total }, (_, i) => i + 1);
  let start = Math.max(1, current - Math.floor(WINDOW / 2));
  const end = Math.min(total, start + WINDOW - 1);
  start = Math.max(1, end - WINDOW + 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

/* ── 미디어 뷰 ── */
function MediaView({ post, card, rounded }: { post: Post; card?: boolean; rounded?: string }) {
  const urls = mediaListOf(post);
  const [idx, setIdx] = useState(0);
  const r = rounded ?? "";

  if (post.media_type === "video") {
    // media_url 이 우리 스토리지에 받아둔 mp4(유튜브 다운로드/인스타 릴스)면 직접 재생. 유튜브 watch URL 이면 임베드.
    const stored = !!post.media_url && !/youtube\.com|youtu\.be/i.test(post.media_url);
    const embed = !stored && post.platform === "youtube" ? youtubeEmbed(post) : null;
    // 카드: 항상 포스터 + ▶ (iframe/video 로딩으로 클릭 가로채기·성능저하 방지)
    if (card) {
      return (
        <div className="pointer-events-none relative h-full w-full bg-black">
          {posterThumb(post) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterThumb(post)!} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${r}`} />
          ) : (
            <div className="h-full w-full" />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45">
              <Play className="h-4 w-4 fill-white text-white" />
            </div>
          </div>
        </div>
      );
    }
    // 상세: 저장된 mp4=직접 재생 / (다운로드 실패한)유튜브=임베드 폴백
    if (stored) {
      return <video src={post.media_url!} poster={post.poster_url || undefined} controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} className={`h-full w-full bg-black object-contain ${r}`} />;
    }
    if (embed) {
      return <iframe src={embed} title="" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className={`h-full w-full bg-black ${r}`} />;
    }
    if (post.media_url) {
      return <video src={post.media_url} poster={post.poster_url || undefined} controls playsInline preload="metadata" onClick={(e) => e.stopPropagation()} className={`h-full w-full bg-black object-contain ${r}`} />;
    }
  }
  if (urls.length === 0) {
    return (
      <div className={`flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-800 ${r}`}>
        <Activity className="h-7 w-7 text-gray-300 dark:text-gray-600" />
      </div>
    );
  }
  return (
    <div className={`relative h-full w-full overflow-hidden bg-gray-100 dark:bg-gray-800 ${r}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={urls[idx]} alt="" loading="lazy" decoding="async" className={`h-full w-full ${card ? "object-cover" : "object-contain"}`} />
      {urls.length > 1 && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setIdx((i) => (i - 1 + urls.length) % urls.length); }} className="absolute left-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); setIdx((i) => (i + 1) % urls.length); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white hover:bg-black/75">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white">{idx + 1} / {urls.length}</span>
        </>
      )}
    </div>
  );
}

function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const ig = platform === "instagram";
  return (
    <span className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${ig ? "bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300" : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"} ${className || ""}`}>
      {ig ? <Instagram className="h-3 w-3" /> : <Youtube className="h-3 w-3" />}
      {ig ? "인스타" : "유튜브"}
    </span>
  );
}

// 모듈 메모리 캐시: 다른 탭 갔다가 재진입해도(SPA 이동) 재fetch 없이 그대로 유지.
// F5(전체 새로고침 → 모듈 초기화) 때만 null 이 되어 새로 로드됨.
let ownedMemCache: { creators: Creator[]; posts: Post[]; counts: Record<string, number> } | null = null;

export default function OwnedMediaPage() {
  const { canMetaAd, isAdmin, loading: authLoading } = useAuth();
  const [creators, setCreators] = useState<Creator[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [platformFilter, setPlatformFilter] = useState<"all" | "youtube" | "instagram">("all");
  const [mediaFilter, setMediaFilter] = useState<"all" | "image" | "slide" | "video">("all");
  const [selectedCreators, setSelectedCreators] = useState<string[]>([]);
  const [showCreatorPicker, setShowCreatorPicker] = useState(false);
  const [showClientMap, setShowClientMap] = useState(false); // 클라이언트↔크리에이터 매핑 편집
  const [savedOnly, setSavedOnly] = useState(false);
  const [workedOnly, setWorkedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [jumpPage, setJumpPage] = useState("");
  const [detail, setDetail] = useState<Post | null>(null);
  const [clients, setClients] = useState<Client[]>([]);

  // 크리에이터 관리 모달
  const [showSettings, setShowSettings] = useState(false);
  const [addNotice, setAddNotice] = useState<string | null>(null);
  const [cName, setCName] = useState("");
  const [cUrl, setCUrl] = useState("");
  const [cCategory, setCCategory] = useState("");
  const [creatorMgmtSearch, setCreatorMgmtSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Creator>>({});

  const bgLoadedRef = useRef(false);
  const loadedCreatorsRef = useRef<Set<string>>(new Set());

  const mergePosts = useCallback((rows: Post[]) => {
    if (!rows?.length) return;
    setPosts((prev) => {
      const map = new Map(prev.map((a) => [a.post_id, a]));
      for (const row of rows) if (!map.has(row.post_id)) map.set(row.post_id, row);
      return Array.from(map.values());
    });
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/owned-media/bootstrap");
      if (res.ok) {
        const j = await res.json();
        setCreators(j.creators ?? []);
        setPosts(j.posts ?? []);
        setCounts(j.counts ?? {});
        try { sessionStorage.setItem("owned-media-cache", JSON.stringify(j)); } catch {}
      }
    } finally {
      setLoading(false);
    }
    fetch("/api/owned-media/analyzed")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const ids: string[] = j?.ids ?? [];
        if (ids.length) {
          const set = new Set(ids);
          setPosts((prev) => prev.map((a) => (set.has(a.post_id) ? { ...a, has_analysis: true } : a)));
        }
      })
      .catch(() => {});
    if (!bgLoadedRef.current) {
      bgLoadedRef.current = true;
      (async () => {
        setSyncing(true);
        const PAGE = 1000;
        const CONCURRENCY = 4;
        let nextOffset = 300;
        let done = false;
        const worker = async () => {
          while (!done) {
            const offset = nextOffset;
            nextOffset += PAGE;
            try {
              const r = await fetch(`/api/owned-media/posts?light=1&limit=${PAGE}&offset=${offset}`);
              if (!r.ok) { done = true; break; }
              const rows: Post[] = await r.json();
              if (rows.length) mergePosts(rows);
              if (rows.length < PAGE) { done = true; break; }
            } catch { done = true; break; }
          }
        };
        try { await Promise.all(Array.from({ length: CONCURRENCY }, () => worker())); }
        finally { setSyncing(false); }
      })();
    }
  }, [mergePosts]);

  useEffect(() => {
    // 다른 탭 갔다가 재진입(SPA): 메모리 캐시가 있으면 그대로 복원하고 재fetch 안 함(F5 해야 새로고침).
    if (ownedMemCache) {
      setCreators(ownedMemCache.creators);
      setPosts(ownedMemCache.posts);
      setCounts(ownedMemCache.counts);
      setLoading(false);
      return;
    }
    try {
      const c = sessionStorage.getItem("owned-media-cache");
      if (c) {
        const j = JSON.parse(c);
        setCreators(j.creators ?? []);
        setPosts(j.posts ?? []);
        setCounts(j.counts ?? {});
        setLoading(false);
      }
    } catch {}
    loadAll();
  }, [loadAll]);

  // 최신 상태를 모듈 메모리 캐시에 보관 → 재진입 시 위에서 그대로 복원(재fetch 없음).
  useEffect(() => {
    if (!loading) ownedMemCache = { creators, posts, counts };
  }, [creators, posts, counts, loading]);

  useEffect(() => {
    getClients().then((cs) => setClients(cs || [])).catch(() => {});
  }, []);

  // 크리에이터 선택 시 그 크리에이터 콘텐츠를 완전히 받아 병합.
  useEffect(() => {
    if (selectedCreators.length === 0) return;
    for (const cid of selectedCreators) {
      if (loadedCreatorsRef.current.has(cid)) continue;
      const have = posts.filter((a) => a.creator_id === cid).length;
      if ((counts[cid] || 0) > 0 && have >= (counts[cid] || 0)) { loadedCreatorsRef.current.add(cid); continue; }
      loadedCreatorsRef.current.add(cid);
      (async () => {
        try {
          const r = await fetch(`/api/owned-media/posts?light=1&limit=1000&creator_id=${cid}`);
          if (!r.ok) { loadedCreatorsRef.current.delete(cid); return; }
          mergePosts(await r.json());
        } catch { loadedCreatorsRef.current.delete(cid); }
      })();
    }
  }, [selectedCreators, posts, counts, mergePosts]);

  const creatorMap = useMemo(() => {
    const m: Record<string, Creator> = {};
    for (const c of creators) m[c.id] = c;
    return m;
  }, [creators]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of creators) set.add((c.category || "").trim() || "미분류");
    return Array.from(set).sort((a, b) => {
      if (a === "기타") return 1;
      if (b === "기타") return -1;
      return a.localeCompare(b, "ko");
    });
  }, [creators]);

  function creatorNameOf(p: Post): string {
    const c = p.creator_id ? creatorMap[p.creator_id] : undefined;
    return c?.profile_name || c?.label || p.creator_name || "—";
  }
  function creatorImageOf(p: Post): string | null {
    const c = p.creator_id ? creatorMap[p.creator_id] : undefined;
    return c?.profile_image || null;
  }

  const filteredPosts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = posts.filter((p) => {
      if (savedOnly && !p.saved) return false;
      if (workedOnly && !((p.memo && p.memo.trim()) || p.has_analysis)) return false;
      if (platformFilter !== "all" && p.platform !== platformFilter) return false;
      const cat = p.creator_id ? (creatorMap[p.creator_id]?.category || "").trim() || "미분류" : "미분류";
      if (activeCategory !== "all" && cat !== activeCategory) return false;
      if (selectedCreators.length > 0 && (!p.creator_id || !selectedCreators.includes(p.creator_id))) return false;
      if (q && !creatorNameOf(p).toLowerCase().includes(q)) return false;
      if (mediaFilter !== "all") {
        const slide = p.media_type === "slide" || (Array.isArray(p.media_urls) && p.media_urls.length > 1);
        if (mediaFilter === "video" && p.media_type !== "video") return false;
        if (mediaFilter === "slide" && !slide) return false;
        if (mediaFilter === "image" && (p.media_type === "video" || slide)) return false;
      }
      return true;
    });
    list.sort((a, b) => {
      const ta = a.first_seen_at ? new Date(a.first_seen_at).getTime() : 0;
      const tb = b.first_seen_at ? new Date(b.first_seen_at).getTime() : 0;
      return tb - ta;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posts, search, activeCategory, platformFilter, selectedCreators, mediaFilter, savedOnly, workedOnly, creatorMap]);

  const savedCount = useMemo(() => posts.filter((a) => a.saved).length, [posts]);
  const workedCount = useMemo(() => posts.filter((a) => (a.memo && a.memo.trim()) || a.has_analysis).length, [posts]);

  const pageCount = Math.max(1, Math.ceil(filteredPosts.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagePosts = filteredPosts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetToFirst() { setPage(1); }

  // ── 크리에이터 관리 ──
  async function addCreator(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/owned-media/creators", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: cName, url: cUrl, category: cCategory }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert("추가 실패: " + (j.error ?? res.status)); return; }
    setCName(""); setCUrl(""); setCCategory("");
    loadAll();
    if (j.crawl_triggered) {
      setAddNotice("✅ 크리에이터 추가됨 · 방금 이 크리에이터 크롤링을 시작했어요. 1~2분 뒤 콘텐츠가 자동으로 채워집니다.");
      setTimeout(() => loadAll(), 90000);
      setTimeout(() => loadAll(), 150000);
    } else {
      setAddNotice("크리에이터 추가됨 · 다음 자동 크롤링(최대 5일) 때 수집됩니다. (관리자: Vercel에 GH_DISPATCH_TOKEN 설정 시 즉시 크롤)");
    }
    setTimeout(() => setAddNotice(null), 15000);
  }

  async function patchCreator(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/owned-media/creators/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    loadAll();
  }

  function startEdit(c: Creator) {
    setEditingId(c.id);
    setEdit({ label: c.label, category: c.category ?? "", url: c.url ?? "", platform: c.platform });
  }
  async function saveEdit(id: string) {
    await patchCreator(id, { label: edit.label, category: edit.category, url: edit.url, platform: edit.platform });
    setEditingId(null);
  }
  async function removeCreator(c: Creator) {
    if (!confirm(`'${c.profile_name || c.label}' 크리에이터를 삭제할까요? (쌓인 콘텐츠도 함께 삭제됩니다)`)) return;
    await fetch(`/api/owned-media/creators/${c.id}`, { method: "DELETE" });
    setSelectedCreators((prev) => prev.filter((id) => id !== c.id));
    loadAll();
  }

  async function setCreatorCategory(id: string, category: string) {
    if (!isAdmin) return;
    const prev = creatorMap[id]?.category ?? null;
    setCreators((p) => p.map((x) => (x.id === id ? { ...x, category } : x)));
    try {
      const r = await fetch(`/api/owned-media/creators/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category }) });
      if (!r.ok) throw new Error();
    } catch {
      setCreators((p) => p.map((x) => (x.id === id ? { ...x, category: prev } : x)));
    }
  }

  // 크리에이터 ↔ 클라이언트 매핑 토글(여러 클라이언트 허용). 낙관적 갱신 후 PATCH.
  async function setCreatorClient(creatorId: string, clientId: string, on: boolean) {
    const c = creatorMap[creatorId];
    if (!c) return;
    const cur = Array.isArray(c.client_ids) ? c.client_ids : [];
    const next = on ? Array.from(new Set([...cur, clientId])) : cur.filter((x) => x !== clientId);
    setCreators((prev) => prev.map((x) => (x.id === creatorId ? { ...x, client_ids: next } : x)));
    try {
      const r = await fetch(`/api/owned-media/creators/${creatorId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_ids: next }) });
      if (!r.ok) throw new Error();
    } catch {
      setCreators((prev) => prev.map((x) => (x.id === creatorId ? { ...x, client_ids: cur } : x))); // 롤백
    }
  }

  function onMemoSaved(postId: string, memo: string) {
    setPosts((prev) => prev.map((a) => (a.post_id === postId ? { ...a, memo } : a)));
    setDetail((d) => (d && d.post_id === postId ? { ...d, memo } : d));
  }
  function onAnalyzed(postId: string, ai_analysis: string) {
    setPosts((prev) => prev.map((a) => (a.post_id === postId ? { ...a, ai_analysis, has_analysis: true } : a)));
    setDetail((d) => (d && d.post_id === postId ? { ...d, ai_analysis, has_analysis: true } : d));
  }
  function onTranscribed(postId: string, transcript: string) {
    setPosts((prev) => prev.map((a) => (a.post_id === postId ? { ...a, transcript } : a)));
    setDetail((d) => (d && d.post_id === postId ? { ...d, transcript } : d));
  }

  async function toggleSaved(p: Post) {
    const next = !p.saved;
    setPosts((prev) => prev.map((a) => (a.post_id === p.post_id ? { ...a, saved: next } : a)));
    setDetail((d) => (d && d.post_id === p.post_id ? { ...d, saved: next } : d));
    try {
      const res = await fetch(`/api/owned-media/posts/${p.post_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saved: next }) });
      if (!res.ok) throw new Error();
    } catch {
      setPosts((prev) => prev.map((a) => (a.post_id === p.post_id ? { ...a, saved: !next } : a)));
      setDetail((d) => (d && d.post_id === p.post_id ? { ...d, saved: !next } : d));
    }
  }

  async function openDetail(p: Post) {
    setDetail(p);
    try {
      const res = await fetch(`/api/owned-media/posts/${p.post_id}`);
      if (res.ok) {
        const full = await res.json();
        setDetail((d) => (d && d.post_id === p.post_id ? { ...d, ...full } : d));
      }
    } catch {}
  }

  // 크리에이터 관리 모달: 검색 거른 뒤 대분류별 그룹핑
  const mgmtQuery = creatorMgmtSearch.trim().toLowerCase();
  const groups: Record<string, Creator[]> = {};
  for (const c of creators) {
    const name = (c.profile_name || c.label || "").toLowerCase();
    if (mgmtQuery && !name.includes(mgmtQuery)) continue;
    const key = (c.category || "").trim() || "미분류";
    (groups[key] ||= []).push(c);
  }

  // 접근 권한 가드 (메타광고와 동일 권한)
  if (!authLoading && !canMetaAd) {
    return (
      <div className="mx-auto max-w-md py-24 text-center">
        <Activity className="mx-auto mb-4 h-12 w-12 text-gray-300 dark:text-gray-600" />
        <h2 className="text-lg font-bold text-gray-700 dark:text-gray-200">접근 권한이 없습니다</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          온드미디어 크롤러는 관리자가 권한을 부여한 사용자만 볼 수 있어요.
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
            <Activity className="h-6 w-6 text-primary" />
            온드미디어 크롤러
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            5일마다 자동 수집된 크리에이터(유튜브·인스타) UGC 콘텐츠를 한눈에. 대분류로 묶어 분석합니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowClientMap(true)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Users className="h-4 w-4" />
            클라이언트 매핑
          </button>
          <button onClick={() => setShowSettings(true)} className="flex items-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
            <Settings className="h-4 w-4" />
            크리에이터 관리
          </button>
        </div>
      </div>

      {/* 검색 */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        <input value={search} onChange={(e) => { setSearch(e.target.value); resetToFirst(); }} placeholder="크리에이터명을 입력해 주세요" className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-2.5 pl-10 pr-4 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40" />
      </div>

      {/* 카테고리 칩 + 크리에이터 드롭다운 */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex flex-wrap gap-2">
          <Chip active={activeCategory === "all"} onClick={() => { setActiveCategory("all"); setSelectedCreators([]); resetToFirst(); }}>모든 콘텐츠</Chip>
          {categories.map((c) => (
            <Chip key={c} active={activeCategory === c} onClick={() => { setActiveCategory(c); setSelectedCreators([]); resetToFirst(); }}>{c}</Chip>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {selectedCreators.length > 0 && (
            <button onClick={() => { setSelectedCreators([]); resetToFirst(); }} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline underline-offset-2">선택 해제</button>
          )}
          <button onClick={() => setShowCreatorPicker(true)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${selectedCreators.length > 0 ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
            <Filter className="h-4 w-4" />
            {selectedCreators.length === 0 ? "전체 크리에이터" : selectedCreators.length === 1 ? (creatorMap[selectedCreators[0]]?.profile_name || creatorMap[selectedCreators[0]]?.label || "크리에이터 1") : `크리에이터 ${selectedCreators.length}명`}
            <ChevronDown className="h-4 w-4 opacity-60" />
          </button>
        </div>
      </div>

      {/* 툴바 */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <strong className="text-sm dark:text-gray-200">{loading ? "불러오는 중..." : `콘텐츠 ${filteredPosts.length.toLocaleString()}개`}</strong>
            <span className="text-xs text-gray-400">최신순</span>
          </div>
          {!loading && syncing && (() => {
            const total = Object.values(counts).reduce((a, b) => a + b, 0);
            if (total <= posts.length) return null;
            const pct = total > 0 ? Math.min(99, Math.round((posts.length / total) * 100)) : 0;
            return (
              <div className="flex items-center gap-2" title="전체 콘텐츠를 백그라운드로 불러오는 중입니다">
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                  <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                </div>
                <span className="whitespace-nowrap text-xs text-gray-400">동기화 {pct}%</span>
              </div>
            );
          })()}
        </div>
        <div className="flex items-center gap-2">
          {/* 플랫폼 */}
          <div className="flex items-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
            {([["all", "전체"], ["youtube", "유튜브"], ["instagram", "인스타"]] as const).map(([v, label], i) => (
              <button key={v} onClick={() => { setPlatformFilter(v); resetToFirst(); }} className={`px-2.5 py-1.5 font-medium ${i > 0 ? "border-l border-gray-200 dark:border-gray-700" : ""} ${platformFilter === v ? "bg-primary text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
            ))}
          </div>
          {/* 보기 형식 */}
          <div className="flex items-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 text-xs">
            {([["all", "전체"], ["image", "이미지"], ["slide", "슬라이드"], ["video", "영상"]] as const).map(([v, label], i) => (
              <button key={v} onClick={() => { setMediaFilter(v); resetToFirst(); }} className={`px-2.5 py-1.5 font-medium ${i > 0 ? "border-l border-gray-200 dark:border-gray-700" : ""} ${mediaFilter === v ? "bg-primary text-white" : "bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{label}</button>
            ))}
          </div>
          <button onClick={() => { setSavedOnly((v) => !v); resetToFirst(); }} className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${savedOnly ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
            <Star className={`h-4 w-4 ${savedOnly ? "fill-amber-400 text-amber-400" : ""}`} />
            스와이프 {savedCount > 0 && `(${savedCount})`}
          </button>
          <button onClick={() => { setWorkedOnly((v) => !v); resetToFirst(); }} title="메모를 적었거나 AI 분석을 저장한 콘텐츠만 보기" className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium ${workedOnly ? "border-violet-300 bg-violet-50 text-violet-700 dark:border-violet-700 dark:bg-violet-900/30 dark:text-violet-300" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
            <ClipboardList className="h-4 w-4" />
            메모·분석 {workedCount > 0 && `(${workedCount})`}
          </button>
        </div>
      </div>

      {/* 그리드 */}
      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-gray-400" /></div>
      ) : pagePosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Activity className="h-12 w-12 text-gray-200 dark:text-gray-700 mb-3" />
          <p className="text-gray-400 dark:text-gray-500">{posts.length === 0 ? "아직 수집된 콘텐츠가 없습니다. 크리에이터를 추가하면 크롤러가 채웁니다." : "조건에 맞는 콘텐츠가 없습니다."}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {pagePosts.map((p) => {
              const name = creatorNameOf(p);
              const img = creatorImageOf(p);
              const ended = p.status === "ended";
              const hasMemo = !!(p.memo && p.memo.trim());
              const hasAnalysis = !!p.has_analysis;
              const tLabel = typeLabelOf(p);
              return (
                <div key={p.post_id} onClick={() => openDetail(p)} className="cursor-pointer rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                  <div className="p-2.5">
                    <div className="flex items-center gap-2">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: colorFromString(name) }}>{name.slice(0, 1).toUpperCase()}</div>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-bold dark:text-gray-100">{name}</span>
                      <PlatformBadge platform={p.platform} />
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-[10px] leading-tight text-gray-400">
                      <span className={`rounded-full px-1.5 py-0.5 font-bold ${p.media_type === "video" ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300" : tLabel === "슬라이드" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>{tLabel}</span>
                      <span>{fmtDate(p.posted_at || p.first_seen_at)}</span>
                    </div>
                  </div>

                  <div className="relative aspect-square">
                    <MediaView post={p} card />
                    {!ended && isNew(p.first_seen_at) && (
                      <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-bold text-white">신규</span>
                    )}
                    <div className="absolute right-1.5 top-1.5 z-10 flex flex-col items-end gap-1">
                      {ended && <span className="rounded-full bg-gray-700/90 px-2 py-0.5 text-[10px] font-bold text-white">종료</span>}
                      {hasAnalysis && <span className="flex items-center gap-0.5 rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" title="AI 분석 저장됨"><Sparkles className="h-3 w-3" /> AI</span>}
                      {hasMemo && <span className="flex items-center gap-0.5 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow" title="메모 있음"><Pencil className="h-3 w-3" /> 메모</span>}
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); toggleSaved(p); }} title={p.saved ? "스와이프 파일에서 제거" : "스와이프 파일에 저장"} className="absolute bottom-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white hover:bg-black/65">
                      <Star className={`h-3.5 w-3.5 ${p.saved ? "fill-amber-400 text-amber-400" : "text-white"}`} />
                    </button>
                  </div>

                  {/* 지표 바(없으면 '—') */}
                  <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] text-gray-500 dark:text-gray-400">
                    <span className="flex items-center gap-0.5" title="조회수"><Eye className="h-3 w-3" /> {fmtNum(p.views)}</span>
                    <span className="flex items-center gap-0.5" title="좋아요"><Heart className="h-3 w-3" /> {fmtNum(p.likes)}</span>
                    <span className="flex items-center gap-0.5" title="댓글"><MessageCircle className="h-3 w-3" /> {fmtNum(p.comments)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-1">
              <button onClick={() => setPage(1)} disabled={safePage === 1} title="처음으로" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronsLeft className="h-4 w-4" /></button>
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} title="이전" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft className="h-4 w-4" /></button>
              {pageItems(safePage, pageCount).map((it) => (
                <button key={it} onClick={() => setPage(it)} className={`h-8 min-w-8 rounded-lg px-2 text-sm font-medium ${it === safePage ? "bg-primary text-white" : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{it}</button>
              ))}
              <button onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage === pageCount} title="다음" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronRight className="h-4 w-4" /></button>
              <button onClick={() => setPage(pageCount)} disabled={safePage === pageCount} title="끝으로" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronsRight className="h-4 w-4" /></button>
              <div className="ml-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                <input type="number" min={1} max={pageCount} value={jumpPage} onChange={(e) => setJumpPage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const n = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1)); setPage(n); setJumpPage(""); } }} placeholder={String(safePage)} className="h-8 w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 text-center text-sm dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-primary/40" />
                <span className="whitespace-nowrap">/ {pageCount}</span>
                <button onClick={() => { const n = Math.min(pageCount, Math.max(1, Number(jumpPage) || 1)); setPage(n); setJumpPage(""); }} className="h-8 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">이동</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* 상세 모달 */}
      {detail && (
        <PostDetailModal
          post={detail}
          creatorName={creatorNameOf(detail)}
          creatorImage={creatorImageOf(detail)}
          onClose={() => setDetail(null)}
          onMemoSaved={onMemoSaved}
          onAnalyzed={onAnalyzed}
          onTranscribed={onTranscribed}
          onToggleSaved={toggleSaved}
          clients={clients}
        />
      )}

      {/* 클라이언트↔크리에이터 매핑 플로팅(+ 매핑된 것만 토글) */}
      {showClientMap && (
        <CreatorClientMapModal
          clients={clients}
          creators={creators}
          counts={counts}
          onToggle={setCreatorClient}
          onClose={() => setShowClientMap(false)}
        />
      )}

      {/* 크리에이터 선택 플로팅 */}
      {showCreatorPicker && (
        <CreatorPickerModal
          creators={creators}
          counts={counts}
          selected={selectedCreators}
          isAdmin={isAdmin}
          onSetCategory={setCreatorCategory}
          onToggle={(id) => { setSelectedCreators((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); setActiveCategory("all"); resetToFirst(); }}
          onSelectMany={(ids) => { setSelectedCreators(ids); setActiveCategory("all"); resetToFirst(); }}
          onClear={() => { setSelectedCreators([]); resetToFirst(); }}
          onClose={() => setShowCreatorPicker(false)}
        />
      )}

      {/* 크리에이터 관리 모달 */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4">
          <div className="my-8 w-full max-w-3xl rounded-2xl bg-white dark:bg-gray-900 shadow-xl">
            <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3.5">
              <h2 className="text-base font-bold dark:text-white">크리에이터 관리</h2>
              <button onClick={() => setShowSettings(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto p-5 space-y-5">
              <form onSubmit={addCreator} className="rounded-xl border dark:border-gray-800 p-5">
                <div className="mb-3 text-sm font-bold dark:text-gray-200 flex items-center gap-1.5"><Plus className="h-4 w-4" /> 크리에이터 추가</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">크리에이터 이름</label>
                    <input placeholder="예: 김블로그" value={cName} onChange={(e) => setCName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">채널/프로필 URL (유튜브 또는 인스타그램)</label>
                    <input placeholder="https://www.youtube.com/@handle  또는  https://www.instagram.com/handle" value={cUrl} onChange={(e) => setCUrl(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                    <p className="mt-1 text-[11px] text-gray-400">URL 로 플랫폼(유튜브/인스타)을 자동 인식합니다. 5일마다 새 콘텐츠가 있는지 확인해 크롤링해요.</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">대분류 (선택)</label>
                    <select value={cCategory} onChange={(e) => setCCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200">
                      <option value="">대분류 선택</option>
                      {CATEGORY_OPTIONS.filter((c) => c !== "미분류").map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  {addNotice && (
                    <div className="rounded-lg border border-green-200 dark:border-green-900/50 bg-green-50 dark:bg-green-950/30 p-2.5 text-xs text-green-800 dark:text-green-300">{addNotice}</div>
                  )}
                  <div className="flex justify-end pt-1">
                    <button type="submit" disabled={!cUrl.trim()} className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">추가</button>
                  </div>
                </div>
              </form>

              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-sm font-bold dark:text-gray-200">추적 중인 크리에이터 {creators.length > 0 && `(${creators.length})`}</div>
                  <div className="relative w-48">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                    <input value={creatorMgmtSearch} onChange={(e) => setCreatorMgmtSearch(e.target.value)} placeholder="크리에이터 검색" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-1.5 pl-8 pr-2 text-xs dark:text-gray-200" />
                  </div>
                </div>
                {creators.length === 0 && <p className="text-sm text-gray-400">아직 없음 — 위에서 추가하세요.</p>}
                {Object.keys(groups).sort().map((cat) => (
                  <div key={cat} className="mb-3">
                    <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-gray-400">{cat}</div>
                    {groups[cat].map((c) =>
                      editingId === c.id ? (
                        <div key={c.id} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-lg border border-primary/50 bg-primary/5 p-2">
                          <input value={edit.label ?? ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="이름" className="flex-1 min-w-[110px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          <select value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200">
                            <option value="">대분류</option>
                            {CATEGORY_OPTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
                          </select>
                          <select value={edit.platform} onChange={(e) => setEdit({ ...edit, platform: e.target.value as "youtube" | "instagram" })} className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200">
                            <option value="youtube">유튜브</option>
                            <option value="instagram">인스타그램</option>
                          </select>
                          <input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="URL" className="flex-1 min-w-[160px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          <button onClick={() => saveEdit(c.id)} className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white">저장</button>
                          <button onClick={() => setEditingId(null)} className="rounded border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300">취소</button>
                        </div>
                      ) : (
                        <div key={c.id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-800 p-2">
                          {c.profile_image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.profile_image} alt="" className="h-6 w-6 rounded-full object-cover" />
                          ) : null}
                          <PlatformBadge platform={c.platform} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm dark:text-gray-200">{c.enabled ? "🟢" : "⚪"} {c.profile_name || c.label}</div>
                            {c.summary && <div className="truncate text-[11px] text-violet-600 dark:text-violet-300">✨ {c.summary}</div>}
                          </div>
                          <span className="shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-[11px] text-gray-600 dark:text-gray-300">{counts[c.id] ?? 0}개</span>
                          <button onClick={() => startEdit(c)} className="rounded p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 dark:hover:bg-gray-800" title="편집"><Pencil className="h-4 w-4" /></button>
                          <button onClick={() => patchCreator(c.id, { enabled: !c.enabled })} className={`rounded p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 ${c.enabled ? "text-green-600" : "text-gray-400"}`} title={c.enabled ? "끄기" : "켜기"}><Power className="h-4 w-4" /></button>
                          <button onClick={() => removeCreator(c)} className="rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-800" title="삭제"><Trash2 className="h-4 w-4" /></button>
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
    <button onClick={onClick} className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? "bg-primary text-white" : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>{children}</button>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 py-2">
      <div className="flex items-center gap-1 text-[10px] font-medium text-gray-400">{icon}{label}</div>
      <div className="mt-0.5 text-sm font-bold dark:text-gray-100">{value}</div>
    </div>
  );
}

/* ── AI 분석 시각화(정적, 메타광고 analyze JSON 과 호환) ── */
type AnalysisData = {
  summary?: string;
  phases?: { name: string; weight: number; desc?: string }[];
  engagement?: { t: number; v: number }[];
  markers?: { t: number; label: string; note?: string }[];
  segments?: { name: string; t?: number; good?: string; bad?: string }[];
  target?: string;
  offer?: string;
  strengths?: string[];
};
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const PHASE_COLORS = ["#3b82f6", "#0ea5e9", "#6366f1", "#22c55e", "#a855f7", "#14b8a6", "#ec4899"];

function parseAnalysis(raw: string | null): AnalysisData | null {
  if (!raw) return null;
  const ok = (o: unknown): AnalysisData | null =>
    o && typeof o === "object" && (Array.isArray((o as AnalysisData).phases) || Array.isArray((o as AnalysisData).engagement)) ? (o as AnalysisData) : null;
  try { const o = ok(JSON.parse(raw)); if (o) return o; } catch {}
  const s = raw.indexOf("{");
  if (s < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = s; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { try { return ok(JSON.parse(raw.slice(s, i + 1))); } catch { return null; } } }
  }
  return null;
}

function AnalysisViz({ data }: { data: AnalysisData }) {
  const phases = (data.phases || []).filter((p) => p && p.name);
  const totalWeight = phases.reduce((s, p) => s + (Number(p.weight) || 0), 0) || 1;
  const pts = (data.engagement || []).map((p) => ({ t: clamp(Number(p.t) || 0, 0, 100), v: clamp(Number(p.v) || 0, 0, 100) })).sort((a, b) => a.t - b.t);
  const markers = (data.markers || []).map((m) => ({ t: clamp(Number(m.t) || 0, 0, 100), label: m.label || "", note: m.note || "" }));
  const segments = (data.segments || []).filter((s) => s && s.name);
  const yTop = (v: number) => 88 - (v / 100) * 76;
  const linePath = pts.length ? pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.t} ${yTop(p.v)}`).join(" ") : "";
  const areaPath = pts.length ? `${linePath} L ${pts[pts.length - 1].t} 100 L ${pts[0].t} 100 Z` : "";
  const interpV = (t: number) => {
    if (!pts.length) return 50;
    if (t <= pts[0].t) return pts[0].v;
    if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (t >= a.t && t <= b.t) return a.v + ((b.v - a.v) * (t - a.t)) / ((b.t - a.t) || 1); }
    return 50;
  };
  return (
    <div className="space-y-3">
      {data.summary && <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{data.summary}</p>}
      {phases.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold text-gray-400">구간 흐름</div>
          <div className="flex h-7 w-full overflow-hidden rounded-lg">
            {phases.map((p, i) => (
              <div key={i} title={p.desc || p.name} style={{ width: `${((Number(p.weight) || 0) / totalWeight) * 100}%`, backgroundColor: PHASE_COLORS[i % PHASE_COLORS.length] }} className="flex items-center justify-center truncate px-1 text-[10px] font-bold text-white">{p.name}</div>
            ))}
          </div>
        </div>
      )}
      {pts.length > 0 && (
        <div>
          <div className="mb-1 text-[11px] font-bold text-gray-400">시청자 몰입 흐름 (추정)</div>
          <div className="relative h-28 w-full rounded-lg border border-gray-100 dark:border-gray-800 bg-gradient-to-b from-blue-50/70 to-transparent dark:from-blue-950/20">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <path d={areaPath} fill="rgba(37,99,235,0.15)" />
              <path d={linePath} fill="none" stroke="#2563eb" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            </svg>
            {markers.map((m, i) => (
              <div key={i} style={{ left: `${m.t}%`, top: `${yTop(interpV(m.t))}%` }} title={m.label + (m.note ? ` · ${m.note}` : "")} className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-gray-900" />
            ))}
          </div>
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
      {segments.length > 0 && (
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-gray-400">구간별 잘한 점 · 아쉬운 점</div>
          <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
            <div className="flex items-center gap-2 bg-gray-50 px-2 py-1 text-[10px] font-bold text-gray-400 dark:bg-gray-800/60">
              <span className="w-16">구간</span>
              <span className="flex-1">잘한 점</span>
              <span className="flex-1">아쉬운 점</span>
            </div>
            {segments.map((s, i) => (
              <div key={i} className="flex items-start gap-2 border-t border-gray-100 px-2 py-2 text-[12px] dark:border-gray-800">
                <span className="w-16 shrink-0 truncate text-[11px] font-medium text-gray-700 dark:text-gray-200" title={s.name}>{s.name}</span>
                <div className="flex-1 leading-snug text-green-700 dark:text-green-400">{s.good || "—"}</div>
                <div className="flex-1 leading-snug text-amber-700 dark:text-amber-500">{s.bad || "—"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {(data.target || data.offer) && (
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          {data.target && (<div><div className="text-gray-400">타겟</div><div className="font-medium dark:text-gray-200">{data.target}</div></div>)}
          {data.offer && (<div><div className="text-gray-400">핵심 메시지</div><div className="font-medium dark:text-gray-200">{data.offer}</div></div>)}
        </div>
      )}
    </div>
  );
}

/* ── 크리에이터 선택 플로팅 ── */
function CreatorPickerModal({
  creators, counts, selected, isAdmin, onSetCategory, onToggle, onSelectMany, onClear, onClose,
}: {
  creators: Creator[];
  counts: Record<string, number>;
  selected: string[];
  isAdmin: boolean;
  onSetCategory: (id: string, category: string) => void;
  onToggle: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const cats = useMemo(() => {
    const set = new Set<string>();
    for (const c of creators) set.add((c.category || "").trim() || "미분류");
    return Array.from(set).sort((a, b) => (a === "기타" ? 1 : b === "기타" ? -1 : a.localeCompare(b, "ko")));
  }, [creators]);
  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return creators
      .map((c) => ({ c, n: counts[c.id] || 0, cat: (c.category || "").trim() || "미분류" }))
      .filter(({ c, cat: cc }) => (cat !== "all" && cc !== cat ? false : kw && !((c.profile_name || c.label || "").toLowerCase().includes(kw)) ? false : true))
      .sort((a, b) => b.n - a.n);
  }, [creators, counts, q, cat]);
  const selectedSet = new Set(selected);
  const visibleIds = rows.map((r) => r.c.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-[6vh] w-full max-w-4xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl flex max-h-[82vh] flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Filter className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold dark:text-gray-100">크리에이터 선택</h3>
            {selected.length > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{selected.length}명 선택됨</span>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="크리에이터명 검색" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setCat("all")} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cat === "all" ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>전체</button>
            {cats.map((c) => (
              <button key={c} onClick={() => setCat(c)} className={`rounded-full px-2.5 py-1 text-xs font-medium ${cat === c ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>{c}</button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-2 text-xs">
          <span className="text-gray-400">{rows.length}명</span>
          <div className="flex items-center gap-3">
            <button onClick={() => onSelectMany(allVisibleSelected ? selected.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selected, ...visibleIds])))} className="font-medium text-primary hover:underline">{allVisibleSelected ? "보이는 항목 해제" : "보이는 항목 전체 선택"}</button>
            {selected.length > 0 && <button onClick={onClear} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">전체 해제</button>}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-3">
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">검색 결과가 없습니다.</p>
          ) : (
            <ul className="space-y-0.5">
              {rows.map(({ c, n, cat: cc }) => {
                const on = selectedSet.has(c.id);
                const catOpts = CATEGORY_OPTIONS.includes(cc) ? CATEGORY_OPTIONS : [cc, ...CATEGORY_OPTIONS];
                return (
                  <li key={c.id} className={`flex items-center gap-3 rounded-lg px-2.5 py-2 ${on ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                    <button onClick={() => onToggle(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-gray-600"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                      {c.profile_image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.profile_image} alt="" className="h-8 w-8 flex-shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800 text-xs font-bold text-gray-500">{(c.profile_name || c.label || "?").slice(0, 1)}</span>
                      )}
                      <div className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-medium dark:text-gray-200"><PlatformBadge platform={c.platform} />{c.profile_name || c.label}</span>
                      </div>
                    </button>
                    {isAdmin ? (
                      <select value={cc} onChange={(e) => onSetCategory(c.id, e.target.value)} onClick={(e) => e.stopPropagation()} title="대분류 수정 (관리자 전용)" className="max-w-[130px] flex-shrink-0 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-1.5 py-1 text-[11px] text-gray-600 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-primary/40">
                        {catOpts.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    ) : (
                      <span className="flex-shrink-0 rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[11px] text-gray-500 dark:text-gray-400">{cc}</span>
                    )}
                    <span className="flex-shrink-0 text-xs font-semibold text-gray-400">{n}개</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3">
          <button onClick={onClose} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90">{selected.length > 0 ? `${selected.length}명 보기` : "전체 보기"}</button>
        </div>
      </div>
    </div>
  );
}

/* ── 상세 모달 ── */
function PostDetailModal({
  post, creatorName, creatorImage, onClose, onMemoSaved, onAnalyzed, onTranscribed, onToggleSaved, clients,
}: {
  post: Post;
  creatorName: string;
  creatorImage: string | null;
  onClose: () => void;
  onMemoSaved: (postId: string, memo: string) => void;
  onAnalyzed: (postId: string, analysis: string) => void;
  onTranscribed: (postId: string, transcript: string) => void;
  onToggleSaved: (p: Post) => void;
  clients: Client[];
}) {
  const router = useRouter();
  const [memo, setMemo] = useState(post.memo ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(post.ai_analysis ?? null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisSaved, setAnalysisSaved] = useState<boolean>(!!post.ai_analysis);
  const [savingAnalysis, setSavingAnalysis] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(post.transcript ?? null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcriptErr, setTranscriptErr] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [mmPicking, setMmPicking] = useState(false);
  const [mmGenerating, setMmGenerating] = useState(false);
  const [cgPicking, setCgPicking] = useState(false);
  const [cgGenerating, setCgGenerating] = useState(false);
  const ended = post.status === "ended";
  const isDirectVideo = post.media_type === "video" && post.platform !== "youtube" && !!post.media_url;

  useEffect(() => { setMemo(post.memo ?? ""); }, [post.memo]);
  useEffect(() => { setAnalysis(post.ai_analysis ?? null); setAnalysisSaved(!!post.ai_analysis); }, [post.ai_analysis]);
  useEffect(() => { setTranscript(post.transcript ?? null); setTranscriptErr(null); }, [post.transcript, post.post_id]);

  const memoRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = memoRef.current; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }, [memo]);

  async function runTranscript() {
    setTranscribing(true); setTranscriptErr(null);
    try {
      const res = await aiFetch("/api/owned-media/transcript", { method: "POST", body: JSON.stringify({ post_id: post.post_id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setTranscriptErr(j.error || "대본 추출에 실패했어요."); return; }
      if (j.empty) { setTranscript(""); setTranscriptErr("나레이션(음성)이 감지되지 않았어요."); return; }
      setTranscript(j.transcript || "");
      if (j.transcript) onTranscribed(post.post_id, j.transcript);
    } catch { setTranscriptErr("대본 추출 중 오류가 발생했어요."); }
    finally { setTranscribing(false); }
  }

  async function persistAnalysis(value: string, silent = false): Promise<boolean> {
    try {
      const res = await fetch(`/api/owned-media/posts/${post.post_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ai_analysis: value }) });
      if (res.ok) { setAnalysisSaved(true); onAnalyzed(post.post_id, value); return true; }
      if (!silent) alert("분석 저장 실패");
      return false;
    } catch { if (!silent) alert("분석 저장 실패"); return false; }
  }
  async function runAnalyze() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/owned-media/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ post_id: post.post_id }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert("AI 분석 실패: " + (j.error ?? res.status)); return; }
      const result = j.analysis || "분석 결과가 없습니다.";
      setAnalysis(result);
      await persistAnalysis(result, true);
    } finally { setAnalyzing(false); }
  }
  async function saveAnalysis() { if (!analysis) return; setSavingAnalysis(true); try { await persistAnalysis(analysis); } finally { setSavingAnalysis(false); } }
  async function saveMemo() {
    setSaving(true);
    try {
      const res = await fetch(`/api/owned-media/posts/${post.post_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memo }) });
      if (res.ok) { onMemoSaved(post.post_id, memo); setSaved(true); setTimeout(() => setSaved(false), 1800); } else alert("메모 저장 실패");
    } finally { setSaving(false); }
  }

  const isDirty = () => memo !== (post.memo ?? "") || (!!analysis && !analysisSaved);
  function requestClose() { if (isDirty()) setConfirmClose(true); else onClose(); }

  async function generateMindmap(clientId: string) {
    setMmGenerating(true);
    try {
      if (isDirectVideo && !post.transcript) {
        try { await aiFetch("/api/owned-media/transcript", { method: "POST", body: JSON.stringify({ post_id: post.post_id }) }); } catch {}
      }
      const res = await aiFetch("/api/ai/mindmap", { method: "POST", body: JSON.stringify({ library_id: post.post_id, source: "om" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert(j.error || "마인드맵 생성에 실패했어요."); return; }
      const capTitle = (post.caption || "").replace(/\n+/g, " ").trim().slice(0, 40);
      const mm = await createMindmap({ client_id: clientId, library_id: post.post_id, title: capTitle ? `${creatorName} · ${capTitle}` : creatorName, source_brand: creatorName, source_thumb: posterThumb(post) || creatorImage || null, data: j.data });
      router.push(`/plan-mindmap/${mm.id}`);
    } catch { alert("마인드맵 생성 중 오류가 발생했어요."); }
    finally { setMmGenerating(false); setMmPicking(false); }
  }

  async function generateContentGuide(clientId: string) {
    setCgGenerating(true);
    try {
      const res = await aiFetch("/api/ai/content-guide", { method: "POST", body: JSON.stringify({ library_id: post.post_id, source: "om" }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert(j.error || "컨텐츠 가이드 생성에 실패했어요."); return; }
      const scenes = j.scenes || [];
      if (!scenes.length) { alert("장면을 만들지 못했어요. 다시 시도해 주세요."); return; }
      const capTitle = (post.caption || "").replace(/\n+/g, " ").trim().slice(0, 40);
      const cg = await createContentGuide({ client_id: clientId, library_id: post.post_id, title: capTitle ? `${creatorName} · ${capTitle}` : creatorName, source_brand: creatorName, source_thumb: posterThumb(post) || creatorImage || null, data: { scenes, brand: j.brand || creatorName } });
      router.push(`/content-guide/${cg.id}`);
    } catch { alert("컨텐츠 가이드 생성 중 오류가 발생했어요."); }
    finally { setCgGenerating(false); setCgPicking(false); }
  }

  const parsed = parseAnalysis(analysis);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4" onClick={requestClose}>
      <div className="my-4 flex max-h-[92vh] w-[94vw] max-w-6xl flex-col overflow-hidden rounded-2xl bg-white dark:bg-gray-900 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b dark:border-gray-800 px-5 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {creatorImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={creatorImage} alt="" className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: colorFromString(creatorName) }}>{creatorName.slice(0, 1).toUpperCase()}</div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 truncate text-sm font-bold dark:text-gray-100"><PlatformBadge platform={post.platform} />{creatorName}</div>
              <div className="flex items-center gap-1.5 text-xs">
                <span className={`inline-flex items-center gap-1 ${ended ? "text-gray-400" : "text-green-600"}`}><span className={`h-1.5 w-1.5 rounded-full ${ended ? "bg-gray-400" : "bg-green-500"}`} />{ended ? "종료됨" : "게시 중"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onToggleSaved(post)} title={post.saved ? "스와이프 파일에서 제거" : "스와이프 파일에 저장"} className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${post.saved ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
              <Star className={`h-3.5 w-3.5 ${post.saved ? "fill-amber-400 text-amber-400" : ""}`} />{post.saved ? "저장됨" : "스와이프"}
            </button>
            {post.post_url && (
              <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 dark:border-gray-700 px-2.5 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"><ExternalLink className="h-3.5 w-3.5" /> 원본</a>
            )}
            <button onClick={requestClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
          </div>
        </div>

        <div className="grid flex-1 overflow-hidden md:grid-cols-2">
          {/* 좌: 미디어 + 캡션 */}
          <div className="space-y-4 overflow-y-auto border-b p-4 dark:border-gray-800 md:border-b-0 md:border-r">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[320px] overflow-hidden rounded-xl bg-black">
              <MediaView post={post} rounded="rounded-xl" />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">제목 · 캡션</span>
                {isDirectVideo && (
                  <button onClick={runTranscript} disabled={transcribing} title="영상 나레이션을 텍스트로 받아쓰기 (리메이크용 대본)" className="flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 dark:bg-primary/10">
                    {transcribing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}{transcribing ? "받아쓰는 중..." : transcript ? "대본 다시" : "대본"}
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3.5 text-sm leading-relaxed text-gray-700 dark:bg-gray-800/50 dark:text-gray-200">{post.caption || "—"}</p>
              {transcriptErr && !transcribing && (<div className="mt-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">{transcriptErr}</div>)}
              {transcript && !transcribing && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">🎙️ 나레이션 대본</span>
                    <button onClick={() => navigator.clipboard?.writeText(transcript)} className="text-[11px] font-medium text-primary hover:underline">복사</button>
                  </div>
                  <p className="whitespace-pre-wrap rounded-lg border border-primary/20 bg-primary/[0.03] p-3 text-sm leading-relaxed text-gray-700 dark:bg-primary/[0.06] dark:text-gray-200">{transcript}</p>
                </div>
              )}
            </div>
          </div>

          {/* 우: 지표 + 메모 + AI분석 + 시드 */}
          <div className="overflow-y-auto p-5 space-y-4">
            {/* 지표 */}
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">지표 <span className="font-normal text-gray-300">(비공개는 — 표기)</span></div>
              <div className="grid grid-cols-5 gap-1.5">
                <Metric icon={<Eye className="h-3 w-3" />} label="조회" value={fmtNum(post.views)} />
                <Metric icon={<Heart className="h-3 w-3" />} label="좋아요" value={fmtNum(post.likes)} />
                <Metric icon={<MessageCircle className="h-3 w-3" />} label="댓글" value={fmtNum(post.comments)} />
                <Metric icon={<Share2 className="h-3 w-3" />} label="공유" value={fmtNum(post.shares)} />
                <Metric icon={<Bookmark className="h-3 w-3" />} label="저장" value={fmtNum(post.saves)} />
              </div>
            </div>

            {/* 메타데이터 */}
            <div className="rounded-xl border dark:border-gray-800 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">메타데이터</div>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <MetaRow k="플랫폼" v={platformLabel(post.platform)} />
                <MetaRow k="유형" v={typeLabelOf(post)} />
                <MetaRow k="게시일" v={post.posted_at ?? "—"} />
                <MetaRow k="최초 수집" v={fmtDate(post.first_seen_at)} />
                <MetaRow k="최근 확인" v={fmtDate(post.last_seen_at)} />
                <MetaRow k="상태" v={ended ? "종료" : "게시 중"} />
              </dl>
            </div>

            {/* 메모 */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wide text-gray-400">메모</span>
                <button onClick={saveMemo} disabled={saving} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50">{saving ? <Loader2 className="h-3 w-3 animate-spin" /> : saved ? "저장됨" : <><Save className="h-3 w-3" /> 저장</>}</button>
              </div>
              <textarea ref={memoRef} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="이 콘텐츠에 대한 메모를 남기세요 (팀 공유 · Shift+Enter 줄바꿈)" className="min-h-[90px] w-full resize-none overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-2.5 text-sm leading-relaxed dark:text-gray-200" />
            </div>

            {/* AI 분석 */}
            <div>
              {analysis ? (
                <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50 dark:bg-violet-950/20 p-3">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1 text-xs font-bold text-violet-700 dark:text-violet-300"><Sparkles className="h-3.5 w-3.5" /> AI 분석</div>
                    <div className="flex items-center gap-1.5">
                      {analysisSaved ? (
                        <span className="flex items-center gap-0.5 text-[11px] font-medium text-green-600"><Check className="h-3 w-3" /> 저장됨</span>
                      ) : (
                        <button onClick={saveAnalysis} disabled={savingAnalysis} className="flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50">{savingAnalysis ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3" /> 저장</>}</button>
                      )}
                      <button onClick={runAnalyze} disabled={analyzing} className="rounded-md border border-violet-300 dark:border-violet-800 px-2 py-1 text-[11px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-50" title="다시 분석">{analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : "다시"}</button>
                    </div>
                  </div>
                  {parsed ? <AnalysisViz data={parsed} /> : <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-200">{analysis}</p>}
                  {!analysisSaved && <p className="mt-2 text-[11px] text-gray-400">저장하지 않으면 이 분석은 창을 닫을 때 사라집니다.</p>}
                </div>
              ) : (
                <button onClick={runAnalyze} disabled={analyzing} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-300 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/20 px-3 py-2.5 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-50">
                  {analyzing ? <><Loader2 className="h-4 w-4 animate-spin" /> 분석 중...</> : <><Sparkles className="h-4 w-4" /> AI 분석</>}
                </button>
              )}
            </div>

            {/* 이 콘텐츠로 만들기 */}
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">이 콘텐츠로 만들기</div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setMmPicking(true)} title="이 콘텐츠를 7갈래 기획 마인드맵으로 분해 (본인 Anthropic 키 필요)" className="flex items-center gap-1.5 rounded-lg border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-sm font-medium text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"><Network className="h-4 w-4" /> 기획 마인드맵 <ArrowUpRight className="h-3.5 w-3.5" /></button>
                <button onClick={() => setCgPicking(true)} title="이 콘텐츠의 장면별 스토리보드 생성 (본인 Anthropic 키 필요)" className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"><Film className="h-4 w-4" /> 컨텐츠 가이드 <ArrowUpRight className="h-3.5 w-3.5" /></button>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">이 콘텐츠의 소구점·카피를 입력값으로 채워 해당 페이지로 이동합니다.</p>
            </div>
          </div>
        </div>
      </div>

      {/* 마인드맵: 클라이언트 선택 */}
      {mmPicking && (
        <ClientPick title="기획 마인드맵으로 만들기" generating={mmGenerating} clients={clients} onPick={generateMindmap} onClose={() => setMmPicking(false)} loadingText="AI가 마인드맵을 만드는 중… (수십 초 걸려요)" />
      )}
      {/* 컨텐츠 가이드: 클라이언트 선택 */}
      {cgPicking && (
        <ClientPick title="컨텐츠 가이드로 만들기" generating={cgGenerating} clients={clients} onPick={generateContentGuide} onClose={() => setCgPicking(false)} loadingText="AI가 장면별 가이드를 만드는 중…" />
      )}

      {confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={(e) => { e.stopPropagation(); setConfirmClose(false); }}>
          <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-gray-900 dark:text-gray-100">저장하지 않은 변경이 있어요</div>
            <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">메모나 분석이 아직 저장되지 않았어요. 저장하고 닫을까요?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setConfirmClose(false); onClose(); }} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800">그냥 닫기</button>
              <button onClick={async () => { if (memo !== (post.memo ?? "")) await saveMemo(); if (analysis && !analysisSaved) await persistAnalysis(analysis, true); setConfirmClose(false); onClose(); }} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">저장하고 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-gray-400">{k}</dt>
      <dd className="text-right font-medium dark:text-gray-200">{v}</dd>
    </>
  );
}

/* ── 클라이언트(기획안 폴더) 선택 플로팅 ── */
function ClientPick({ title, generating, clients, onPick, onClose, loadingText }: { title: string; generating: boolean; clients: Client[]; onPick: (clientId: string) => void; onClose: () => void; loadingText: string }) {
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const list = clients.filter((c) => !kw || c.name.toLowerCase().includes(kw));
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-[10vh] w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-base font-bold dark:text-gray-100">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">선택한 &apos;기획안 제작&apos; 클라이언트 폴더에 저장됩니다.</p>
        {generating ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-500"><Loader2 className="h-5 w-5 animate-spin" /> {loadingText}</div>
        ) : (
          <>
            {clients.length > 6 && (
              <div className="relative mb-2">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="클라이언트 검색" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-8 pr-2 text-sm dark:text-gray-200" />
              </div>
            )}
            <div className="max-h-[50vh] space-y-1 overflow-y-auto">
              {list.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">클라이언트가 없습니다. 기획안 제작에서 먼저 등록하세요.</p>
              ) : (
                list.map((c) => (
                  <button key={c.id} onClick={() => onPick(c.id)} className="flex w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2.5 text-left text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-200">
                    {c.name}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── 클라이언트 ↔ 크리에이터 매핑 플로팅 (+ 선택 클라이언트에 매핑된 것만 보기 토글) ── */
function CreatorClientMapModal({
  clients, creators, counts, onToggle, onClose,
}: {
  clients: Client[];
  creators: Creator[];
  counts: Record<string, number>;
  onToggle: (creatorId: string, clientId: string, on: boolean) => void;
  onClose: () => void;
}) {
  const [editClient, setEditClient] = useState<string>(clients[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [mappedOnly, setMappedOnly] = useState(false); // 선택 클라이언트에 매핑된 것만 보기

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "(삭제된 클라이언트)";

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return creators
      .map((c) => ({ c, n: counts[c.id] || 0 }))
      .filter(({ c }) => {
        // '매핑된 것만' 토글: 반드시 선택된 클라이언트 기준(크리에이터가 여러 클라에 중복 매핑 가능하므로).
        if (mappedOnly && editClient && !(Array.isArray(c.client_ids) && c.client_ids.includes(editClient))) return false;
        if (kw && !((c.profile_name || c.label || "").toLowerCase().includes(kw))) return false;
        return true;
      })
      .sort((a, b) => b.n - a.n);
  }, [creators, counts, q, mappedOnly, editClient]);

  const mappedCount = editClient
    ? creators.filter((c) => Array.isArray(c.client_ids) && c.client_ids.includes(editClient)).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4" onClick={onClose}>
      <div className="mt-[6vh] flex max-h-[82vh] w-full max-w-3xl flex-col rounded-2xl bg-white dark:bg-gray-900 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-base font-bold dark:text-gray-100">클라이언트별 크리에이터 매핑</h3>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>

        {clients.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            클라이언트가 없습니다.<br />
            <span className="text-xs">먼저 &apos;기획안 제작&apos;에서 클라이언트를 추가해 주세요.</span>
          </div>
        ) : (
          <>
            <div className="border-b border-gray-100 dark:border-gray-800 px-5 py-3">
              <div className="mb-2 text-xs font-semibold text-gray-400">편집할 클라이언트 선택</div>
              <div className="flex flex-wrap gap-1.5">
                {clients.map((c) => (
                  <button key={c.id} onClick={() => setEditClient(c.id)} className={`rounded-full px-3 py-1 text-xs font-medium ${editClient === c.id ? "bg-primary text-white" : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"}`}>{c.name}</button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 border-b border-gray-100 dark:border-gray-800 px-5 py-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="크리에이터명 검색" className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 py-2 pl-9 pr-3 text-sm dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <button
                onClick={() => setMappedOnly((v) => !v)}
                disabled={!editClient}
                title={editClient ? "선택한 클라이언트에 매핑된 크리에이터만 정렬해서 보기" : "먼저 클라이언트를 선택하세요"}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-40 ${mappedOnly ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
              >
                <Filter className="h-3.5 w-3.5" />
                {mappedOnly ? "매핑된 것만" : "전체 보기"}
              </button>
              <span className="whitespace-nowrap text-xs text-gray-400"><b className="text-primary">{clientName(editClient)}</b> · {mappedCount}개</span>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-2">
              {mappedOnly && rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">이 클라이언트에 매핑된 크리에이터가 없어요.</p>
              ) : (
                <ul className="space-y-0.5">
                  {rows.map(({ c, n }) => {
                    const cids = Array.isArray(c.client_ids) ? c.client_ids : [];
                    const on = cids.includes(editClient);
                    const others = cids.filter((id) => id !== editClient);
                    return (
                      <li key={c.id}>
                        <button onClick={() => onToggle(c.id, editClient, !on)} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left ${on ? "bg-primary/5 dark:bg-primary/10" : "hover:bg-gray-50 dark:hover:bg-gray-800"}`}>
                          <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border ${on ? "border-primary bg-primary text-white" : "border-gray-300 dark:border-gray-600"}`}>{on && <Check className="h-3.5 w-3.5" />}</span>
                          <PlatformBadge platform={c.platform} />
                          <div className="min-w-0 flex-1">
                            <span className="truncate text-sm font-medium dark:text-gray-200">{c.profile_name || c.label}</span>
                            {others.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1">
                                {others.map((id) => (<span key={id} className="rounded bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-gray-400">{clientName(id)}</span>))}
                              </div>
                            )}
                          </div>
                          <span className="flex-shrink-0 text-xs font-semibold text-gray-400">{n}개</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-gray-100 dark:border-gray-800 px-5 py-3">
              <button onClick={onClose} className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90">완료</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
