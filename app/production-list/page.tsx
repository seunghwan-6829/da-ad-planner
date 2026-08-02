"use client";

/* 제작 리스트 — 크롤러(메타/구글/온드미디어)에서 담아둔 "제작할 소재" 보드.
   한 곳에 모아 보고(필터), 항목을 열면 해당 광고 소재가 크롤러 상세처럼 플로팅으로 뜬다. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Film,
  ImageOff,
  ListChecks,
  Loader2,
  Network,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getClients, type Client } from "@/lib/api/clients";
import { useGenJobs, type GenKind } from "@/components/gen-jobs";

type Source = "meta" | "google" | "owned";

type PLItem = {
  id: string;
  source: Source;
  ref_id: string;
  brand: string | null;
  thumb: string | null;
  media_type: string | null;
  note: string;
  status: "todo" | "doing" | "done";
  client_id: string | null;
  created_by: string | null;
  created_at: string;
};

type Detail = {
  source: Source;
  ref_id: string;
  brand: string | null;
  text: string;
  media_type: string | null;
  media_url: string | null;
  media_urls: string[];
  poster_url: string | null;
  landing_url: string | null;
  origin_url: string | null;
  platform?: string | null;
  stats?: { views: number | null; likes: number | null; comments: number | null };
  dead?: boolean;
  ended?: boolean;
};

const SOURCE_LABEL: Record<Source, string> = { meta: "메타", google: "구글", owned: "온드" };
const SOURCE_COLOR: Record<Source, string> = {
  meta: "bg-blue-600",
  google: "bg-red-500",
  owned: "bg-violet-600",
};
const STATUS_LABEL: Record<PLItem["status"], string> = { todo: "대기", doing: "제작 중", done: "완료" };
const STATUS_CHIP: Record<PLItem["status"], string> = {
  todo: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  doing: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
};

// 유튜브 watch/shorts/youtu.be URL → 임베드 URL (아니면 null)
function youtubeEmbed(url: string | null): string | null {
  if (!url) return null;
  const id =
    url.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    url.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    url.match(/shorts\/([\w-]{6,})/)?.[1] ||
    url.match(/embed\/([\w-]{6,})/)?.[1] ||
    null;
  return id ? `https://www.youtube.com/embed/${id}?playsinline=1` : null;
}

// 인스타 릴스/게시물 URL → 임베드 URL (아니면 null)
function instagramEmbed(url: string | null): string | null {
  if (!url) return null;
  const code = url.match(/\/(?:reel|reels|p|tv)\/([\w-]+)/)?.[1];
  return code ? `https://www.instagram.com/reel/${code}/embed/` : null;
}

const isStorageUrl = (u: string | null) => !!u && /\/storage\/v1\/object\//.test(u);

/* ── 미디어 뷰(통합): 저장영상 → video, 유튜브/인스타 → 임베드, 캐러셀 → 슬라이드, 그 외 → 포스터 ── */
function DetailMedia({ d }: { d: Detail }) {
  const [slide, setSlide] = useState(0);
  const r = "rounded-xl";

  if (d.media_type === "video") {
    if (isStorageUrl(d.media_url)) {
      return <video src={d.media_url!} poster={d.poster_url || undefined} controls playsInline preload="metadata" className={`h-full w-full bg-black object-contain ${r}`} />;
    }
    if (d.source === "owned" && d.platform === "instagram") {
      const ig = instagramEmbed(d.origin_url);
      if (ig) return <iframe src={ig} title="" scrolling="no" allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen className={`h-full w-full bg-white ${r}`} />;
    }
    const yt = youtubeEmbed(d.media_url) || (d.source === "owned" ? youtubeEmbed(d.origin_url) : null);
    if (yt) return <iframe src={yt} title="" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className={`h-full w-full bg-black ${r}`} />;
    // 재생 수단 없음(미다운로드/원본삭제) → 포스터 + 안내
    return (
      <div className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-black ${r}`}>
        {d.poster_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={d.poster_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />
        ) : null}
        <div className="relative z-10 px-4 text-center text-xs text-white/90">
          {d.dead ? "원본 영상이 유튜브에서 삭제/차단됐어요" : "영상은 크롤러 페이지에서 재생할 수 있어요"}
        </div>
      </div>
    );
  }

  const slides = (d.media_urls || []).filter(Boolean);
  if (slides.length > 1) {
    return (
      <div className={`relative h-full w-full overflow-hidden bg-black ${r}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={slides[slide]} alt="" className="h-full w-full object-contain" />
        <button onClick={() => setSlide((s) => (s - 1 + slides.length) % slides.length)} className="absolute left-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={() => setSlide((s) => (s + 1) % slides.length)} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70">
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-2 py-0.5 text-[10px] text-white">
          {slide + 1} / {slides.length}
        </div>
      </div>
    );
  }

  const img = d.media_url || d.poster_url || slides[0] || null;
  if (img) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={img} alt="" className={`h-full w-full bg-black object-contain ${r}`} />;
  }
  return (
    <div className={`flex h-full w-full items-center justify-center bg-gray-100 text-gray-400 dark:bg-gray-800 ${r}`}>
      <ImageOff className="h-8 w-8" />
    </div>
  );
}

/* ── 상세 플로팅 모달 ── */
function DetailModal({
  item,
  clients,
  onClose,
  onPatched,
  onDeleted,
}: {
  item: PLItem;
  clients: Client[];
  onClose: () => void;
  onPatched: (patch: Partial<PLItem>) => void;
  onDeleted: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailErr, setDetailErr] = useState<string>("");
  const [note, setNote] = useState(item.note || "");
  const [noteSaved, setNoteSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const genJobs = useGenJobs();

  /* 기획 마인드맵/컨텐츠 가이드 생성 → 전역 큐(우측 하단 토스트)로.
     여기서 기다리지 않으니 모달을 닫고 다음 소재를 바로 눌러 '중첩'으로 돌릴 수 있고,
     페이지를 이동해도 진행 표시가 따라온다. 완료되면 토스트의 [열기]로 이동. */
  function startGenerate(kind: GenKind) {
    if (!item.client_id) { alert("먼저 아래에서 클라이언트를 지정해 주세요."); return; }
    genJobs.start({
      kind,
      source: item.source,
      refId: item.ref_id,
      clientId: item.client_id,
      label: item.brand || item.ref_id,
      sub: clients.find((c) => c.id === item.client_id)?.name,
      brand: item.brand,
      thumb: item.thumb,
      // 영상 소재면 대본(나레이션)부터 추출 — 상세가 아직 로딩 전이면 리스트의 media_type 으로 판단
      isVideo: (detail?.media_type ?? item.media_type) === "video",
    });
  }

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setDetailErr("");
    fetch(`/api/production-list/detail?source=${item.source}&ref=${encodeURIComponent(item.ref_id)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (r.ok) setDetail(j as Detail);
        else setDetailErr(j.error || "원본 소재를 불러오지 못했어요.");
      })
      .catch(() => alive && setDetailErr("네트워크 오류로 원본 소재를 불러오지 못했어요."));
    return () => {
      alive = false;
    };
  }, [item.source, item.ref_id]);

  async function patch(p: { status?: PLItem["status"]; note?: string; client_id?: string | null }) {
    setSaving(true);
    try {
      const r = await fetch("/api/production-list", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, ...p }),
      });
      if (r.ok) {
        onPatched(p);
        if (p.note !== undefined) {
          setNoteSaved(true);
          setTimeout(() => setNoteSaved(false), 1500);
        }
      } else alert("저장 실패");
    } catch {
      alert("네트워크 오류");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("이 소재를 제작 리스트에서 제거할까요?")) return;
    const r = await fetch(`/api/production-list?id=${item.id}`, { method: "DELETE" });
    if (r.ok) onDeleted();
    else alert("제거 실패");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b p-3.5 dark:border-gray-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${SOURCE_COLOR[item.source]}`}>
              {SOURCE_LABEL[item.source]}
            </span>
            <div className="truncate text-sm font-bold dark:text-gray-100">{item.brand || item.ref_id}</div>
            {detail?.ended && <span className="shrink-0 text-xs text-gray-400">종료됨</span>}
          </div>
          <div className="flex items-center gap-2">
            {detail?.origin_url && (
              <a
                href={detail.origin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ExternalLink className="h-3.5 w-3.5" /> 원본
              </a>
            )}
            <button onClick={remove} title="제작 리스트에서 제거" className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40">
              <Trash2 className="h-3.5 w-3.5" /> 제거
            </button>
            <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 좌: 소재(고정폭) / 우: 제작 관리(넓게) */}
        <div className="grid flex-1 overflow-hidden md:grid-cols-[360px_1fr]">
          {/* 좌: 소재(크롤러 상세처럼) */}
          <div className="space-y-3 overflow-y-auto border-b p-4 dark:border-gray-800 md:border-b-0 md:border-r">
            <div className="relative mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-xl bg-black">
              {detail ? (
                <DetailMedia d={detail} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-white/70">
                  {detailErr ? <span className="px-4 text-center text-xs">{detailErr}</span> : <Loader2 className="h-6 w-6 animate-spin" />}
                </div>
              )}
            </div>
            {detail?.text ? (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:bg-gray-800/60 dark:text-gray-300">
                {detail.text}
              </p>
            ) : null}
          </div>

          {/* 우: 제작 관리 */}
          <div className="space-y-4 overflow-y-auto p-4">
            {/* 크롤러 상세와 동일한 제작 도구 — 누르면 우측 하단 토스트로 진행되고, 여러 소재를 중첩으로 돌릴 수 있다 */}
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => startGenerate("mindmap")}
                title="이 소재로 기획 마인드맵 생성 — 우측 하단에서 진행을 볼 수 있어요 (본인 Anthropic 키 필요)"
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
              >
                <Network className="h-4 w-4" /> 기획 마인드맵
              </button>
              <button
                onClick={() => startGenerate("guide")}
                title="이 소재로 장면별 컨텐츠 가이드 생성 — 우측 하단에서 진행을 볼 수 있어요 (본인 Anthropic 키 필요)"
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
              >
                <Film className="h-4 w-4" /> 컨텐츠 가이드
              </button>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">클라이언트</p>
              <select
                value={item.client_id || ""}
                onChange={(e) => patch({ client_id: e.target.value || null } as Partial<PLItem>)}
                disabled={saving}
                className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="">미지정</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">제작 상태</p>
              <div className="flex gap-1.5">
                {(Object.keys(STATUS_LABEL) as PLItem["status"][]).map((s) => (
                  <button
                    key={s}
                    onClick={() => patch({ status: s })}
                    disabled={saving}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      item.status === s
                        ? "border-primary bg-primary text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500 dark:text-gray-400">제작 메모</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder="레퍼런스 포인트, 변형 아이디어, 담당자 등"
                className="w-full rounded-lg border border-gray-200 bg-white p-2.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={() => patch({ note })}
                disabled={saving}
                className="mt-1.5 flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {noteSaved ? <Check className="h-3.5 w-3.5" /> : null}
                {noteSaved ? "저장됨" : "메모 저장"}
              </button>
            </div>

            {detail?.stats && (detail.stats.views != null || detail.stats.likes != null) ? (
              <div className="flex gap-3 text-xs text-gray-500 dark:text-gray-400">
                {detail.stats.views != null && <span>조회 {detail.stats.views.toLocaleString()}</span>}
                {detail.stats.likes != null && <span>좋아요 {detail.stats.likes.toLocaleString()}</span>}
                {detail.stats.comments != null && <span>댓글 {detail.stats.comments.toLocaleString()}</span>}
              </div>
            ) : null}

            {detail?.landing_url ? (
              <a href={detail.landing_url} target="_blank" rel="noopener noreferrer" className="block truncate text-xs text-blue-500 hover:underline">
                랜딩: {detail.landing_url}
              </a>
            ) : null}

            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              담은 날짜 {new Date(item.created_at).toLocaleDateString("ko-KR")}
              {item.created_by ? ` · ${item.created_by}` : ""}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── 메인 페이지 ── */
export default function ProductionListPage() {
  useAuth(); // 로그인 컨텍스트 초기화(다른 도구 페이지와 동일 패턴)
  const [items, setItems] = useState<PLItem[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [fSource, setFSource] = useState<"all" | Source>("all");
  const [fStatus, setFStatus] = useState<"all" | PLItem["status"]>("all");
  const [fClient, setFClient] = useState<string>("all"); // 클라이언트 필터('all' | 'none' | client_id)
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(1); // 16개씩 페이지 나누기

  // 필터/검색이 바뀌면 1페이지로
  useEffect(() => {
    setPage(1);
  }, [fSource, fStatus, fClient, search]);

  useEffect(() => {
    getClients().then((cs) => setClients(cs || [])).catch(() => {});
  }, []);
  const clientMap = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/production-list")
      .then(async (r) => {
        const j = await r.json().catch(() => []);
        if (!r.ok) throw new Error((j as { error?: string }).error || "load fail");
        setItems(j as PLItem[]);
        setLoadErr("");
      })
      .catch(() => setLoadErr("목록을 불러오지 못했어요. production_list 테이블이 생성됐는지 확인해 주세요."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items.filter(
      (it) =>
        (fSource === "all" || it.source === fSource) &&
        (fStatus === "all" || it.status === fStatus) &&
        (fClient === "all" || (fClient === "none" ? !it.client_id : it.client_id === fClient)) &&
        (!s || (it.brand || "").toLowerCase().includes(s))
    );
  }, [items, fSource, fStatus, fClient, search]);

  const PAGE_SIZE = 16;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const open = openId ? items.find((i) => i.id === openId) || null : null;
  const counts = useMemo(() => {
    const c = { meta: 0, google: 0, owned: 0 } as Record<Source, number>;
    for (const it of items) c[it.source]++;
    return c;
  }, [items]);

  return (
    <div className="p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100">
            <ListChecks className="h-6 w-6 text-primary" /> 제작 리스트
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            크롤러에서 담은 제작할 소재 {items.length}개 — 메타 {counts.meta} · 구글 {counts.google} · 온드 {counts.owned}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={fSource} onChange={(e) => setFSource(e.target.value as typeof fSource)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            <option value="all">출처 전체</option>
            <option value="meta">메타 광고</option>
            <option value="google">구글 광고</option>
            <option value="owned">온드미디어</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value as typeof fStatus)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            <option value="all">상태 전체</option>
            <option value="todo">대기</option>
            <option value="doing">제작 중</option>
            <option value="done">완료</option>
          </select>
          <select value={fClient} onChange={(e) => setFClient(e.target.value)} className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            <option value="all">클라이언트 전체</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
            <option value="none">미지정</option>
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="브랜드 검색"
            className="w-40 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center text-gray-400">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : loadErr ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 p-10 text-center text-sm text-gray-400 dark:border-gray-700">
          {items.length === 0
            ? "아직 담긴 소재가 없어요. 크롤러 상세에서 [제작 리스트] 버튼으로 담아보세요."
            : "필터에 맞는 소재가 없어요."}
        </div>
      ) : (
        <>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {pageItems.map((it) => (
            <button
              key={it.id}
              onClick={() => setOpenId(it.id)}
              className="group overflow-hidden rounded-xl border border-gray-200 bg-white text-left shadow-sm transition hover:shadow-md dark:border-gray-800 dark:bg-gray-900"
            >
              {/* 1:1 프리뷰(세로/가로 소재는 중앙 기준 크롭 — 클릭하면 상세에서 원본 비율로) */}
              <div className="relative aspect-square w-full overflow-hidden bg-gray-100 dark:bg-gray-800">
                {it.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.thumb} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-gray-300 dark:text-gray-600">
                    <ImageOff className="h-7 w-7" />
                  </div>
                )}
                <span className={`absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${SOURCE_COLOR[it.source]}`}>
                  {SOURCE_LABEL[it.source]}
                </span>
                <span className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CHIP[it.status]}`}>
                  {STATUS_LABEL[it.status]}
                </span>
              </div>
              <div className="p-2.5">
                <p className="truncate text-xs font-semibold dark:text-gray-200">{it.brand || it.ref_id}</p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                  {it.client_id && clientMap.get(it.client_id) ? (
                    <>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: clientMap.get(it.client_id)!.color || "#94a3b8" }} />
                      <span className="truncate">{clientMap.get(it.client_id)!.name}</span>
                      <span className="shrink-0">·</span>
                    </>
                  ) : null}
                  <span className="shrink-0">{new Date(it.created_at).toLocaleDateString("ko-KR")}</span>
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* 페이지네이션: 16개 = 1페이지 */}
        {pageCount > 1 && (
          <div className="mt-5 flex items-center justify-center gap-1.5">
            <button onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage === 1} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter((n) => n === 1 || n === pageCount || Math.abs(n - safePage) <= 3)
              .map((n, idx, arr) => (
                <span key={n} className="flex items-center gap-1.5">
                  {idx > 0 && arr[idx - 1] !== n - 1 && <span className="text-xs text-gray-400">…</span>}
                  <button onClick={() => setPage(n)} className={`min-w-[32px] rounded-lg px-2.5 py-1.5 text-xs font-medium ${n === safePage ? "bg-primary text-white" : "border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{n}</button>
                </span>
              ))}
            <button onClick={() => setPage(Math.min(pageCount, safePage + 1))} disabled={safePage === pageCount} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
        </>
      )}

      {open && (
        <DetailModal
          item={open}
          clients={clients}
          onClose={() => setOpenId(null)}
          onPatched={(p) => setItems((prev) => prev.map((i) => (i.id === open.id ? { ...i, ...p } : i)))}
          onDeleted={() => {
            setItems((prev) => prev.filter((i) => i.id !== open.id));
            setOpenId(null);
          }}
        />
      )}
    </div>
  );
}
