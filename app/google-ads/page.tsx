"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { AddToProductionButton } from "@/components/add-to-production";
import { aiFetch } from "@/lib/ai-fetch";
import { getClients, type Client } from "@/lib/api/clients";
import { loadCache, saveCache } from "@/lib/crawler-cache";
import { createMindmap } from "@/lib/api/mindmaps";
import { createContentGuide } from "@/lib/api/content-guides";
import { supabase } from "@/lib/supabase";

// 영상에서 "배경(씬)이 바뀔 때마다" 프레임을 떠서(화면 변화 감지) 스토리지에 올린 뒤 URL 반환.
// CORS/디코딩 실패 시 throw → 호출부에서 서버 프레임(5장)으로 폴백.
async function extractSceneFrames(videoUrl: string): Promise<string[]> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = videoUrl;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("video load fail"));
    setTimeout(() => reject(new Error("timeout")), 15000);
  });
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) throw new Error("no duration");

  const W = video.videoWidth || 540;
  const H = video.videoHeight || 960;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // 저해상도 시그니처(텍스트·미세 카메라 이동에 둔감하게) — 하단 자막 영역은 비교에서 제외
  const SW = 24, SH = 14;
  const ROWS = Math.max(1, Math.floor(SH * 0.72)); // 상단 72%만 비교(하단 자막 변화 무시)
  const sc = document.createElement("canvas");
  sc.width = SW;
  sc.height = SH;
  const sctx = sc.getContext("2d")!;

  const seekTo = (t: number) =>
    new Promise<void>((resolve, reject) => {
      const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = Math.min(t, duration - 0.05);
      setTimeout(() => reject(new Error("seek timeout")), 8000);
    });
  const sig = () => { sctx.drawImage(video, 0, 0, SW, SH); return sctx.getImageData(0, 0, SW, SH).data; };
  // 상단 영역만 비교 → 자막/하단 글자가 바뀌어도 배경 같으면 같은 씬으로 본다
  const diffTop = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    let s = 0; const n = SW * ROWS;
    for (let p = 0; p < n; p++) {
      const i = p * 4;
      s += Math.abs((a[i] + a[i + 1] + a[i + 2]) / 3 - (b[i] + b[i + 1] + b[i + 2]) / 3);
    }
    return s / n;
  };

  // ── 1차: 영상 전체를 끝까지 훑어 '씬 시작 시점'만 수집(조기 종료 없음) ──
  const STEP = Math.max(0.3, duration / 80);
  const THRESH = 18;   // 씬 전환 민감도(저해상도라 '큰 변화'만 잡힘 → 미세 이동/글자변화 무시)
  const MIN_GAP = 1.0; // 직전 씬과 최소 간격(초) — 빠른 자막 깜빡임을 새 씬으로 안 봄
  const SAFE_MAX = 60; // 안전 상한(스트로브/글리치 영상 폭주 방지 — 정상 광고면 도달 안 함)
  const times: number[] = [];
  let prevSig: Uint8ClampedArray | null = null;
  let lastT = -99;
  for (let t = 0.1; t < duration && times.length < SAFE_MAX; t += STEP) {
    await seekTo(t);
    const cur = sig();
    if (!prevSig || (diffTop(prevSig, cur) > THRESH && t - lastT >= MIN_GAP)) {
      times.push(t);
      prevSig = cur;
      lastT = t;
    }
  }
  if (!times.length) times.push(0.1);

  // 씬 개수는 dedup(유사씬 통합)이 정한다 — 임의로 자르지 않고 '실제로 다른 씬'은 전부 사용.
  const picked = times;

  // ── 2차: 선택된 시점에서 풀해상도 캡처 + 업로드 ──
  const urls: string[] = [];
  for (const t of picked) {
    await seekTo(t);
    ctx.drawImage(video, 0, 0, W, H);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.82));
    if (blob) {
      const path = `content-frames/${Math.random().toString(36).slice(2, 9)}.jpg`;
      const { error } = await supabase.storage.from("shooting-guides").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (!error) urls.push(supabase.storage.from("shooting-guides").getPublicUrl(path).data.publicUrl);
    }
  }
  return urls;
}
import {
  Megaphone,
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
  Layers,
  ArrowUpRight,
  Film,
  Play,
  MapPin,
  ClipboardList,
  Move,
  Filter,
  ChevronDown,
  FileText,
  Users,
  Link2,
  Network,
} from "lucide-react";

type Target = {
  id: string;
  label: string;
  category: string | null;
  advertiser_id: string | null; // 구글 투명성 센터 광고주 ID (AR...)
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
  last_shown?: string | null;
  ad_text: string | null;
  media_type: string | null; // 'video' | 'image' | 'carousel' | 'text'
  media_url: string | null;
  media_urls?: string[] | null;
  poster_url?: string | null;
  frames?: string[] | null;
  landing_url?: string | null;
  source_url?: string | null; // 투명성 센터 원본 링크
  format?: string | null;
  regions?: unknown;
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

// 투명성 센터 URL 유효성: 광고주 URL(/advertiser/AR…) 또는 도메인 검색 URL(?domain=…) 이면 통과.
function parseAdvertiserId(input: string): string | null {
  const s = (input || "").trim();
  const m = s.match(/\/advertiser\/(AR[0-9A-Za-z_-]+)/);
  if (m) return m[1];
  if (/^AR[0-9A-Za-z_-]+$/.test(s)) return s;
  const dom = s.match(/[?&]domain=([^&#\s]+)/);
  if (dom) return "domain:" + dom[1];
  return null;
}
const ADVERTISER_URL_WARN =
  "구글 광고 투명성 센터 URL이 필요해요.\n\nadstransparency.google.com 에서 브랜드를 검색한 뒤,\n① 광고주를 클릭해 주소창의 …/advertiser/AR… URL, 또는\n② 도메인 검색 결과의 …?domain=… URL\n을 복사해 붙여넣어 주세요.";

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
  // 투명성 센터 원본 링크가 있으면 그걸, 없으면 크리에이티브 검색 링크.
  return ad.source_url || `https://adstransparency.google.com/?searchTerm=${encodeURIComponent(ad.page_name || "")}&region=KR`;
}

// 유튜브 watch/youtu.be/embed/shorts URL → 임베드 URL. 유튜브가 아니면(우리 스토리지 mp4 등) null.
function youtubeEmbed(url: string | null | undefined): string | null {
  const s = url || "";
  if (!/youtube\.com|youtu\.be/i.test(s)) return null;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{6,})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
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

// 내 PC의 로컬 온디맨드 영상 서버(serve-videos.mjs). 떠 있으면 재생이 ~5초로 압도적으로 빠름.
const LOCAL_VIDEO_SERVER = "http://127.0.0.1:47615";
// 광고에서 유튜브 videoId 추출(poster 썸네일 i.ytimg.com/vi/<id> 우선).
const ytIdOfAd = (ad: Ad): string | null => {
  const s = `${ad.poster_url || ""} ${ad.media_url || ""}`;
  return (
    s.match(/i\.ytimg\.com\/vi\/([\w-]{6,})\//)?.[1] ||
    s.match(/[?&]v=([\w-]{6,})/)?.[1] ||
    s.match(/youtu\.be\/([\w-]{6,})/)?.[1] ||
    s.match(/shorts\/([\w-]{6,})/)?.[1] ||
    null
  );
};

/* ── 온디맨드 영상: 임베드 차단된 구글 광고(유튜브) 영상 재생.  ※ Apify 안 씀(과금 0).
   상세창 열리는 순간 로컬 서버(내 PC)로 스트림 URL을 "미리" 추출(프리페치) → 재생 클릭 시 즉시 재생.
   재생하는 동안 Supabase 영구저장은 백그라운드로 진행. 로컬 서버 없으면 이미 받아둔 것만 재생(안내). */
function OnDemandGoogleVideo({ ad, rounded, videoRef }: { ad: Ad; rounded: string; videoRef?: React.RefObject<HTMLVideoElement | null> }) {
  const [phase, setPhase] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [dead, setDead] = useState(false); // 원본 삭제/차단 등 재시도 무의미
  const [preReady, setPreReady] = useState(false);
  const preRef = useRef<Promise<string | null> | null>(null);
  // 로컬 서버가 알려준 "진짜 실패 이유"(영상 삭제/차단, 추출 실패 등). 서버가 꺼져 있으면 null 유지.
  const localErrRef = useRef<{ msg: string; dead: boolean } | null>(null);
  const aliveRef = useRef(true);

  // 로컬 서버(내 PC)로 스트림 URL 추출(+백그라운드로 Supabase 영구저장). 로컬 서버 없으면 null.
  const resolveViaLocal = useCallback(async (): Promise<string | null> => {
    const id = ytIdOfAd(ad);
    if (!id) {
      // 크롤 데이터에 유튜브 영상 정보가 아예 없는 광고 → 재생 수단 없음(원본 링크로 안내).
      localErrRef.current = { msg: "이 광고는 영상 정보가 수집되지 않아 재생할 수 없어요.", dead: true };
      return null;
    }
    try {
      const h = await fetch(`${LOCAL_VIDEO_SERVER}/health`, { signal: AbortSignal.timeout(1200) });
      if (!h.ok) return null;
    } catch { return null; }
    try {
      const r = await fetch(`${LOCAL_VIDEO_SERVER}/get?id=${id}`, { signal: AbortSignal.timeout(120000) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && j.error) localErrRef.current = { msg: j.error as string, dead: !!j.dead };
      return (j.url as string) || null;
    } catch { return null; }
  }, [ad]);

  // 상세창 열리는 즉시 프리페치 시작 → 사용자가 광고 보는 2~3초 사이 준비 완료 → 재생 클릭 = 즉시.
  useEffect(() => {
    aliveRef.current = true;
    const p = resolveViaLocal();
    preRef.current = p;
    p.then((u) => { if (aliveRef.current && u) setPreReady(true); }).catch(() => {});
    return () => { aliveRef.current = false; };
  }, [resolveViaLocal]);

  // 로컬 서버 없을 때: Apify 안 씀(과금 X). 이미 받아둔 영상이면 재생, 아니면 안내만.
  async function checkStoredOrNotify() {
    try {
      const res = await fetch("/api/google-ads/fetch-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library_id: ad.library_id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!aliveRef.current) return;
      if (j.done && j.url) { setUrl(j.url); setPhase("ready"); return; }
      if (j.dead) setDead(true);
      setMsg(j.error || "아직 다운로드 전이에요. 곧 자동으로 받아집니다.");
      setPhase("error");
    } catch {
      if (!aliveRef.current) return;
      setMsg("네트워크 오류. 다시 시도해 주세요.");
      setPhase("error");
    }
  }

  async function start() {
    setPhase("loading");
    setMsg("영상 준비 중…");
    // 프리페치가 이미 끝났으면 즉시 재생. 아직이면 그 결과를 기다림(로컬 서버 있을 때만 값 나옴).
    let pre: string | null = null;
    try { pre = await (preRef.current ?? resolveViaLocal()); } catch {}
    if (!aliveRef.current) return;
    if (pre) { setUrl(pre); setPhase("ready"); return; }
    // 로컬 서버가 실패 이유를 알려줬으면 그걸 그대로(삭제/차단 영상을 "준비 전"으로 오안내하지 않게).
    if (localErrRef.current) {
      setDead(localErrRef.current.dead);
      setMsg(localErrRef.current.msg);
      setPhase("error");
      return;
    }
    checkStoredOrNotify();
  }

  const poster = ad.poster_url || undefined;

  if (phase === "ready" && url) {
    return <video ref={videoRef} src={url} poster={poster} controls autoPlay playsInline preload="metadata" onClick={(e) => e.stopPropagation()} className={`h-full w-full bg-black object-contain ${rounded}`} />;
  }
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); if (phase !== "loading" && !dead) start(); }} className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-black ${rounded}`}>
      {poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" />
      )}
      <div className="relative z-10 flex flex-col items-center gap-2 px-4 text-center text-white">
        {phase === "loading" ? (
          <>
            <Loader2 className="h-8 w-8 animate-spin" />
            <span className="text-xs">{msg}</span>
          </>
        ) : phase === "error" ? (
          <>
            <span className="text-xs text-red-300">{msg}</span>
            <span className="flex items-center gap-2">
              {!dead && <span className="rounded-full bg-white/20 px-3 py-1 text-xs">다시 시도 ▶</span>}
              <span
                role="link"
                tabIndex={0}
                onClick={(e) => { e.stopPropagation(); window.open(sourceLink(ad), "_blank", "noopener"); }}
                className="rounded-full bg-white/20 px-3 py-1 text-xs hover:bg-white/30"
              >
                원본 광고 보기 ↗
              </span>
            </span>
          </>
        ) : (
          <>
            <div className={`flex h-14 w-14 items-center justify-center rounded-full backdrop-blur ${preReady ? "bg-emerald-500/70" : "bg-white/25"}`}>
              <Play className="h-7 w-7 fill-white text-white" />
            </div>
            <span className="text-[11px] opacity-80">{preReady ? "재생 (준비 완료 · 즉시)" : "재생 (자동으로 불러와요)"}</span>
          </>
        )}
      </div>
    </button>
  );
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

  if (ad.media_type === "video") {
    // 스토리지 mp4로 저장돼 있으면 바로 재생. 아니면(media_url null/유튜브) 재생 시 온디맨드로 상세+다운로드.
    const stored = !!ad.media_url && /\/storage\/v1\/object\//.test(ad.media_url);
    if (card) {
      // 카드: 썸네일(previewUrl/poster) + 가운데 ▶ (클릭하면 모달 열림)
      return (
        <div className="pointer-events-none relative h-full w-full bg-black">
          {stored ? (
            <video src={ad.media_url!} poster={ad.poster_url || undefined} muted playsInline preload="metadata" className={`h-full w-full object-cover ${r}`} />
          ) : ad.poster_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.poster_url} alt="" loading="lazy" decoding="async" className={`h-full w-full object-cover ${r}`} />
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
    if (stored) {
      return (
        <video ref={videoRef} src={ad.media_url!} poster={ad.poster_url || undefined} controls autoPlay playsInline preload="metadata" onClick={(e) => e.stopPropagation()} className={`h-full w-full bg-black object-contain ${r}`} />
      );
    }
    // media_url 없음/유튜브 → 재생 누르면 상세 로딩 → 다운로드 → 재생 (온디맨드).
    return <OnDemandGoogleVideo ad={ad} rounded={r} videoRef={videoRef} />;
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

// 모듈 메모리 캐시: 다른 탭 갔다가 재진입해도(SPA 이동) 재fetch 없이 그대로 유지.
// F5(전체 새로고침 → 모듈 초기화) 때만 null 이 되어 새로 로드됨.
let googleMemCache: { targets: Target[]; ads: Ad[]; counts: Record<string, number> } | null = null;

export default function GoogleAdsCrawlerPage() {
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
  const [advertiserUrl, setAdvertiserUrl] = useState(""); // 투명성 센터 광고주 URL
  const [country, setCountry] = useState("KR");

  // 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Target> & { url?: string }>({});

  const categorizedRef = useRef(false);
  const bgLoadedRef = useRef(false); // 백그라운드 전체 로드 1회만
  const loadedBrandsRef = useRef<Set<string>>(new Set()); // 브랜드별 on-demand 로드 추적
  const hadCacheRef = useRef(false); // 진입 시 IndexedDB 캐시가 있었나(있으면 델타만 동기화)
  const cacheIdsRef = useRef<Set<string>>(new Set()); // 캐시에 담겨있던 library_id(델타 종료 판정용)

  // 새로 받은 광고들을 기존 ads 에 병합(중복 제거, 기존 항목 우선 — bootstrap 의 ad_text/has_analysis 보존)
  const mergeAds = useCallback((rows: Ad[]) => {
    if (!rows?.length) return;
    setAds((prev) => {
      const map = new Map(prev.map((a) => [a.library_id, a]));
      for (const row of rows) if (!map.has(row.library_id)) map.set(row.library_id, row);
      return Array.from(map.values());
    });
  }, []);
  // 갱신 병합(기존은 최신값으로 덮고, 신규는 추가). bootstrap 최신 300 반영에 사용.
  const upsertAds = useCallback((rows: Ad[]) => {
    if (!rows?.length) return;
    setAds((prev) => {
      const map = new Map(prev.map((a) => [a.library_id, a]));
      for (const row of rows) map.set(row.library_id, { ...map.get(row.library_id), ...row });
      return Array.from(map.values());
    });
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const res = await fetch("/api/google-ads/bootstrap");
      if (res.ok) {
        const j = await res.json();
        setTargets(j.targets ?? []);
        setCounts(j.counts ?? {});
        upsertAds(j.ads ?? []); // 최신 300 을 갱신 병합(캐시로 이미 렌더된 목록 위에 최신값 반영)
      }
    } finally {
      setLoading(false);
    }
    // has_analysis 배지: 분석된 id 목록을 첫 페인트와 분리해 백그라운드로 받아 병합(임계경로 단축).
    fetch("/api/google-ads/analyzed")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const ids: string[] = j?.ids ?? [];
        if (ids.length) {
          const set = new Set(ids);
          setAds((prev) => prev.map((a) => (set.has(a.library_id) ? { ...a, has_analysis: true } : a)));
        }
      })
      .catch(() => {});
    // 첫 화면(최근 300)을 띄운 뒤, 나머지 광고를 백그라운드로 이어 받아 병합(화면 안 멈춤). 진입당 1회.
    // 속도: 페이지를 한 번에 1000개씩, 6개를 동시(병렬)로 받아 합친다 → 순차 대비 수 배 빠름.
    if (!bgLoadedRef.current) {
      bgLoadedRef.current = true;
      const PAGE = 1000; // PostgREST 한 요청 최대치
      if (hadCacheRef.current) {
        // 델타 동기화: 캐시가 이미 전체를 담고 있으니, 최신부터 훑다가 "모두 아는 페이지"를 만나면 중단.
        //   보통 새로 생긴 몇 개만 받고 1~2요청에 끝난다(동기화 바 없음).
        (async () => {
          const known = cacheIdsRef.current;
          for (let offset = 0; ; offset += PAGE) {
            try {
              const r = await fetch(`/api/google-ads/ads?light=1&limit=${PAGE}&offset=${offset}`);
              if (!r.ok) break;
              const rows: Ad[] = await r.json();
              if (!rows.length) break;
              const knownCount = rows.reduce((n, x) => n + (known.has(x.library_id) ? 1 : 0), 0);
              mergeAds(rows);
              if (rows.length < PAGE || knownCount === rows.length) break; // 끝 또는 전부 아는 페이지 → 중단
            } catch { break; }
          }
        })();
      } else {
        // 최초(캐시 없음): 전체 병렬 로드 후 캐시에 저장.
        (async () => {
          setSyncing(true);
          const CONCURRENCY = 12; // 3만+ 대량이라 동시성 상향
          let nextOffset = 300;
          let done = false;
          let buffer: Ad[] = [];
          const flush = () => { if (buffer.length) { mergeAds(buffer); buffer = []; } };
          const timer = setInterval(flush, 1200);
          const worker = async () => {
            while (!done) {
              const offset = nextOffset;
              nextOffset += PAGE;
              try {
                const r = await fetch(`/api/google-ads/ads?light=1&limit=${PAGE}&offset=${offset}`);
                if (!r.ok) { done = true; break; }
                const rows: Ad[] = await r.json();
                if (rows.length) buffer.push(...rows);
                if (rows.length < PAGE) { done = true; break; }
              } catch { done = true; break; }
            }
          };
          try { await Promise.all(Array.from({ length: CONCURRENCY }, () => worker())); }
          finally { clearInterval(timer); flush(); setSyncing(false); }
        })();
      }
    }
  }, [mergeAds, upsertAds]);

  useEffect(() => {
    // 1) 같은 세션 SPA 재진입: 메모리 캐시 즉시 복원 + 백그라운드 델타.
    if (googleMemCache) {
      setTargets(googleMemCache.targets);
      setAds(googleMemCache.ads);
      setCounts(googleMemCache.counts);
      setLoading(false);
      hadCacheRef.current = true;
      cacheIdsRef.current = new Set(googleMemCache.ads.map((a) => a.library_id));
      loadAll();
      return;
    }
    // 2) F5/새 탭/앱 재시작: IndexedDB 영구 캐시가 있으면 전체를 즉시 복원(동기화 바 없이) → 델타만.
    loadCache<Ad>("google")
      .then((cached) => {
        if (cached?.length) {
          hadCacheRef.current = true;
          cacheIdsRef.current = new Set(cached.map((a) => a.library_id));
          setAds(cached);
          setLoading(false);
        }
      })
      .finally(() => loadAll());
  }, [loadAll]);

  // 최신 상태를 모듈 메모리 캐시(세션) + IndexedDB(영구, 디바운스)에 보관.
  useEffect(() => {
    if (loading) return;
    googleMemCache = { targets, ads, counts };
    const t = setTimeout(() => { saveCache("google", ads); }, 1500);
    return () => clearTimeout(t);
  }, [targets, ads, counts, loading]);

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
          await fetch("/api/google-ads/categorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target_id: t.id }),
          });
        } catch {}
      }
      const tRes = await fetch("/api/google-ads/targets");
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
          const r = await fetch(`/api/google-ads/ads?light=1&limit=1000&target_id=${bid}`);
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

  const pageCount = Math.max(1, Math.ceil(filteredAds.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageAds = filteredAds.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function resetToFirst() {
    setPage(1);
  }

  // ── 관리(설정) ──
  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    if (!parseAdvertiserId(advertiserUrl)) {
      alert(ADVERTISER_URL_WARN);
      return;
    }
    const res = await fetch("/api/google-ads/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label, category, url: advertiserUrl, country }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert("추가 실패: " + (j.error ?? res.status));
      return;
    }
    setLabel("");
    setCategory("");
    setAdvertiserUrl("");
    loadAll();
    if (j.crawl_triggered) {
      setAddNotice("✅ 광고주 추가됨 · 방금 이 광고주 크롤링을 시작했어요. 1~2분 뒤 소재가 자동으로 채워집니다.");
      setTimeout(() => loadAll(), 90000);
      setTimeout(() => loadAll(), 150000);
    } else {
      setAddNotice("광고주 추가됨 · 즉시 크롤은 미설정 상태라 다음 자동 크롤링(최대 7일) 때 수집됩니다. (관리자: GH_DISPATCH_TOKEN 설정 시 즉시 크롤 / 또는 bat 실행)");
    }
    setTimeout(() => setAddNotice(null), 15000);
  }

  async function patchTarget(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/google-ads/targets/${id}`, {
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
      url: t.advertiser_id
        ? (t.advertiser_id.startsWith("domain:")
            ? `https://adstransparency.google.com/?region=${t.country || "KR"}&domain=${t.advertiser_id.slice(7)}`
            : `https://adstransparency.google.com/advertiser/${t.advertiser_id}?region=${t.country || "KR"}`)
        : "",
      country: t.country,
    });
  }

  async function saveEdit(id: string) {
    const patch: Record<string, unknown> = {
      label: edit.label,
      category: edit.category,
      country: edit.country,
    };
    if (edit.url && edit.url.trim()) patch.url = edit.url.trim();
    await patchTarget(id, patch);
    setEditingId(null);
  }

  async function remove(t: Target) {
    if (!confirm(`'${t.label}' 삭제할까요? (쌓인 광고는 유지됩니다)`)) return;
    await fetch(`/api/google-ads/targets/${t.id}`, { method: "DELETE" });
    setSelectedBrands((prev) => prev.filter((id) => id !== t.id));
    loadAll();
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
      const r = await fetch(`/api/google-ads/targets/${targetId}`, {
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
      const r = await fetch(`/api/google-ads/targets/${targetId}`, {
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
      const res = await fetch(`/api/google-ads/ads/${ad.library_id}`, {
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
      const res = await fetch(`/api/google-ads/ads/${ad.library_id}`);
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
          구글 광고 크롤러는 관리자가 권한을 부여한 사용자만 볼 수 있어요.
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
            구글 광고 크롤러
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            구글 광고 투명성 센터에서 자동 수집한 경쟁사 광고(검색·유튜브·디스플레이)를 한눈에. 대분류로 묶어 분석합니다.
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
          clients={clients}
          mappedClientIds={detail.target_id ? (targetMap[detail.target_id]?.client_ids || []) : []}
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
                  <Plus className="h-4 w-4" /> 광고주 추가
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">광고주 이름</label>
                    <input placeholder="예: 미니드" value={label} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">광고 투명성 센터 광고주 URL</label>
                    <input placeholder="https://adstransparency.google.com/advertiser/AR...?region=KR" value={advertiserUrl} onChange={(e) => setAdvertiserUrl(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2.5 text-sm dark:text-gray-200" />
                    <p className="mt-1 text-[11px] text-gray-400">adstransparency.google.com 에서 브랜드 검색 → 광고주 클릭 → 주소창 URL(…/advertiser/AR… 포함) 복사·붙여넣기</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-gray-400">지역</span>
                    <input value={country} onChange={(e) => setCountry(e.target.value)} title="지역코드(region)" className="w-16 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-2 text-sm dark:text-gray-200" />
                    <span className="text-[11px] text-gray-400">(URL에 region이 있으면 자동 인식)</span>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-500 dark:text-gray-400">대분류</label>
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
                    <button type="submit" disabled={!advertiserUrl.trim()} className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40">추가</button>
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
                          <input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="투명성 센터 광고주 URL(…/advertiser/AR…)" className="flex-1 min-w-[200px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
                          <input value={edit.country ?? "KR"} onChange={(e) => setEdit({ ...edit, country: e.target.value })} title="지역코드" className="w-14 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm dark:text-gray-200" />
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
  const [mappedOnly, setMappedOnly] = useState(false); // 선택 클라이언트에 매핑된 것만 보기

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "(삭제된 클라이언트)";

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return targets
      .map((t) => ({ t, n: counts[t.id] || 0 }))
      .filter(({ t }) => {
        // '매핑된 것만' 토글: 반드시 선택된 클라이언트 기준(광고주가 여러 클라에 중복 매핑 가능하므로).
        if (mappedOnly && editClient && !(Array.isArray(t.client_ids) && t.client_ids.includes(editClient))) return false;
        if (kw && !((t.profile_name || t.label || "").toLowerCase().includes(kw))) return false;
        return true;
      })
      .sort((a, b) => b.n - a.n);
  }, [targets, counts, q, mappedOnly, editClient]);

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
              <button
                onClick={() => setMappedOnly((v) => !v)}
                disabled={!editClient}
                title={editClient ? "선택한 클라이언트에 매핑된 광고주만 정렬해서 보기" : "먼저 클라이언트를 선택하세요"}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium disabled:opacity-40 ${
                  mappedOnly
                    ? "border-primary/40 bg-primary/5 text-primary dark:bg-primary/10"
                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                <Filter className="h-3.5 w-3.5" />
                {mappedOnly ? "매핑된 것만" : "전체 보기"}
              </button>
              <span className="whitespace-nowrap text-xs text-gray-400">
                <b className="text-primary">{clientName(editClient)}</b> · {mappedCount}개
              </span>
            </div>

            {/* 브랜드 목록(체크 = 이 클라이언트에 속함) */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {mappedOnly && rows.length === 0 ? (
                <p className="py-10 text-center text-sm text-gray-400">이 클라이언트에 매핑된 광고주가 없어요.</p>
              ) : (
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
              )}
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
  clients,
  mappedClientIds,
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
  clients: Client[];
  mappedClientIds: string[];
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
  const [mmPicking, setMmPicking] = useState(false); // 기획 마인드맵: 클라이언트 선택창
  const [mmKw, setMmKw] = useState("");
  const [mmGenerating, setMmGenerating] = useState(false);
  const [cgPicking, setCgPicking] = useState(false); // 컨텐츠 가이드: 클라이언트 선택창
  const [cgGenerating, setCgGenerating] = useState(false);
  const router = useRouter();
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
      const res = await aiFetch("/api/google-ads/transcript", {
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
      const res = await fetch(`/api/google-ads/ads/${ad.library_id}`, {
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
      const res = await fetch("/api/google-ads/analyze", {
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
      const res = await fetch(`/api/google-ads/ads/${ad.library_id}`, {
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
    const url = `${window.location.origin}/google-ad/share/${ad.library_id}`;
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

  // 기획 마인드맵 생성: 선택한 클라이언트 폴더에 저장 후 캔버스로 이동.
  // AI 호출은 사용자 본인 Anthropic 키(aiFetch → x-user-api-key). 키 없으면 라우트가 401 반환.
  async function generateMindmap(clientId: string) {
    setMmGenerating(true);
    try {
      // 영상이고 아직 나레이션 대본이 없으면 먼저 받아쓰기(STT) → 마인드맵에 '나레이션 원문'이 들어가게.
      // best-effort(OpenAI 키 없거나 실패해도 마인드맵은 진행).
      if (ad.media_type === "video" && !ad.transcript) {
        try { await aiFetch("/api/google-ads/transcript", { method: "POST", body: JSON.stringify({ library_id: ad.library_id }) }); } catch {}
      }
      const res = await aiFetch("/api/ai/mindmap", {
        method: "POST",
        body: JSON.stringify({ library_id: ad.library_id, source: "ga" }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(j.error || "마인드맵 생성에 실패했어요.");
        return;
      }
      const capTitle = cleanCaption(ad.ad_text, brandName).replace(/\n+/g, " ").trim().slice(0, 40);
      const mm = await createMindmap({
        client_id: clientId,
        library_id: ad.library_id,
        title: capTitle ? `${brandName} · ${capTitle}` : brandName,
        source_brand: brandName,
        source_thumb: posterThumb(ad) || brandImage || null,
        data: j.data,
      });
      router.push(`/plan-mindmap/${mm.id}`);
    } catch {
      alert("마인드맵 생성 중 오류가 발생했어요.");
    } finally {
      setMmGenerating(false);
      setMmPicking(false);
    }
  }

  // 컨텐츠 가이드 생성: 선택한 클라이언트 폴더에 스토리보드 저장 후 개별 페이지로 이동.
  async function generateContentGuide(clientId: string) {
    setCgGenerating(true);
    try {
      // 영상이면 브라우저에서 씬(배경 변화) 프레임을 추출(실패 시 서버 5프레임 폴백)
      let frames: string[] = [];
      if (ad.media_type === "video" && ad.media_url) {
        try { frames = await extractSceneFrames(ad.media_url); } catch {}
      }

      type CScene = { image: string; prompt: string; description: string; caution: string };
      let scenes: CScene[] = [];
      let brand = brandName;

      if (frames.length) {
        // 장면별로 "따로따로 병렬 생성"(동시 4개). 각 호출은 1이미지·작은 출력 → 타임아웃/맥스토큰 제약 없음.
        const out: CScene[] = new Array(frames.length);
        let idx = 0;
        const worker = async () => {
          while (idx < frames.length) {
            const i = idx++;
            const img = frames[i];
            try {
              const r = await aiFetch("/api/ai/content-guide", { method: "POST", body: JSON.stringify({ library_id: ad.library_id, image: img, source: "ga" }) });
              const j = await r.json().catch(() => ({}));
              out[i] = { image: img, prompt: j.prompt || "", description: j.description || "", caution: j.caution || "" };
            } catch {
              out[i] = { image: img, prompt: "", description: "", caution: "" };
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, frames.length) }, worker));
        scenes = out;
      } else {
        // 폴백: 서버 프레임(≤5) 배치
        const res = await aiFetch("/api/ai/content-guide", { method: "POST", body: JSON.stringify({ library_id: ad.library_id, source: "ga" }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { alert(j.error || "컨텐츠 가이드 생성에 실패했어요."); return; }
        scenes = j.scenes || [];
        brand = j.brand || brandName;
      }

      if (!scenes.length) { alert("장면을 만들지 못했어요. 다시 시도해 주세요."); return; }

      const capTitle = cleanCaption(ad.ad_text, brandName).replace(/\n+/g, " ").trim().slice(0, 40);
      const cg = await createContentGuide({
        client_id: clientId,
        library_id: ad.library_id,
        title: capTitle ? `${brandName} · ${capTitle}` : brandName,
        source_brand: brandName,
        source_thumb: posterThumb(ad) || brandImage || null,
        data: { scenes, brand },
      });
      router.push(`/content-guide/${cg.id}`);
    } catch {
      alert("컨텐츠 가이드 생성 중 오류가 발생했어요.");
    } finally {
      setCgGenerating(false);
      setCgPicking(false);
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
            <AddToProductionButton source="google" refId={ad.library_id} brand={brandName} thumb={ad.poster_url} mediaType={ad.media_type} />
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
              <ExternalLink className="h-3.5 w-3.5" /> 투명성 센터
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
                  onClick={() => setMmPicking(true)}
                  title="이 소재를 7갈래 기획 마인드맵으로 분해 (본인 Anthropic 키 필요)"
                  className="flex items-center gap-1.5 rounded-lg border border-yellow-300 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 px-3 py-2 text-sm font-medium text-yellow-700 dark:text-yellow-300 hover:bg-yellow-100 dark:hover:bg-yellow-900/40"
                >
                  <Network className="h-4 w-4" /> 기획 마인드맵 <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setCgPicking(true)}
                  title="이 소재의 장면별 스토리보드(프롬프트·설명·주의점) 생성 (본인 Anthropic 키 필요)"
                  className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
                >
                  <Film className="h-4 w-4" /> 컨텐츠 가이드 <ArrowUpRight className="h-3.5 w-3.5" />
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

      {/* 기획 마인드맵: 저장할 브랜드(클라이언트) 선택 */}
      {mmPicking && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { e.stopPropagation(); if (!mmGenerating) setMmPicking(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-gray-100">
              <Network className="h-4 w-4 text-primary" /> 어느 브랜드에 저장할까요?
            </div>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">선택한 &apos;기획안 제작&apos; 브랜드 폴더에 마인드맵이 저장됩니다.</p>
            {mmGenerating ? (
              <div className="flex flex-col items-center gap-2 py-10 text-sm text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                AI가 마인드맵을 만드는 중… (수십 초 걸려요)
              </div>
            ) : (
              <>
                <input
                  value={mmKw}
                  onChange={(e) => setMmKw(e.target.value)}
                  placeholder="브랜드 검색…"
                  className="mb-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                />
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {clients.length === 0 ? (
                    <p className="py-6 text-center text-xs text-gray-400">&apos;기획안 제작&apos;에서 브랜드를 먼저 추가하세요.</p>
                  ) : (
                    clients
                      .filter((c) => !mmKw || c.name.toLowerCase().includes(mmKw.toLowerCase()))
                      .sort((a, b) => (mappedClientIds.includes(b.id) ? 1 : 0) - (mappedClientIds.includes(a.id) ? 1 : 0))
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => generateMindmap(c.id)}
                          className="flex w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color || "#3B82F6" }} />
                          <span className="flex-1 truncate dark:text-gray-200">{c.name}</span>
                          {mappedClientIds.includes(c.id) && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">매핑됨</span>
                          )}
                        </button>
                      ))
                  )}
                </div>
                <button
                  onClick={() => setMmPicking(false)}
                  className="mt-3 w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  취소
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 컨텐츠 가이드: 저장할 브랜드(클라이언트) 선택 */}
      {cgPicking && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => { e.stopPropagation(); if (!cgGenerating) setCgPicking(false); }}
        >
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-900 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-gray-900 dark:text-gray-100">
              <Film className="h-4 w-4 text-primary" /> 어느 브랜드에 저장할까요?
            </div>
            <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">선택한 &apos;기획안 제작&apos; 브랜드 폴더에 컨텐츠 가이드가 저장됩니다.</p>
            {cgGenerating ? (
              <div className="flex flex-col items-center gap-2 py-10 text-sm text-gray-500">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                AI가 장면별 스토리보드를 만드는 중… (수십 초)
              </div>
            ) : (
              <>
                <input
                  value={mmKw}
                  onChange={(e) => setMmKw(e.target.value)}
                  placeholder="브랜드 검색…"
                  className="mb-2 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm dark:text-gray-200"
                />
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {clients.length === 0 ? (
                    <p className="py-6 text-center text-xs text-gray-400">&apos;기획안 제작&apos;에서 브랜드를 먼저 추가하세요.</p>
                  ) : (
                    clients
                      .filter((c) => !mmKw || c.name.toLowerCase().includes(mmKw.toLowerCase()))
                      .sort((a, b) => (mappedClientIds.includes(b.id) ? 1 : 0) - (mappedClientIds.includes(a.id) ? 1 : 0))
                      .map((c) => (
                        <button
                          key={c.id}
                          onClick={() => generateContentGuide(c.id)}
                          className="flex w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800"
                        >
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color || "#3B82F6" }} />
                          <span className="flex-1 truncate dark:text-gray-200">{c.name}</span>
                          {mappedClientIds.includes(c.id) && (
                            <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">매핑됨</span>
                          )}
                        </button>
                      ))
                  )}
                </div>
                <button
                  onClick={() => setCgPicking(false)}
                  className="mt-3 w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  취소
                </button>
              </>
            )}
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
