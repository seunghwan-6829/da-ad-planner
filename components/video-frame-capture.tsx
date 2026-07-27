"use client";

/* 크롤러 상세 모달 공용: 재생 중인 <video>의 '지금 이 장면'을 PNG로 캡처해 바로 다운로드.
   사용법: 미디어 박스 div에 ref를 걸고 <CaptureFrameButton container={ref} filenameBase="브랜드명" />.

   왜 숨김 플레이어를 다시 여나 — 재생 중인 엘리먼트에는 crossOrigin 속성이 없어서
   CDN이 CORS를 허용해도 캔버스가 오염(taint)된다. 같은 소스를 crossOrigin="anonymous"로
   다시 열어 같은 시점으로 시크한 뒤 그리면 된다(Range 요청이라 필요한 조각만 받는다).
   그래도 안 되는 CDN은 같은 출처 프록시(/api/media/frame-proxy)로 우회한다.
   유튜브·인스타 '임베드(iframe)'는 브라우저가 화면 접근 자체를 막아 캡처 불가 → 안내만. */

import { useRef, useState } from "react";
import { Camera, Check, Loader2 } from "lucide-react";

function waitEvent(el: HTMLMediaElement, ok: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => { cleanup(); reject(new Error("timeout")); }, timeoutMs);
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error("load-error")); };
    function cleanup() {
      clearTimeout(to);
      el.removeEventListener(ok, onOk);
      el.removeEventListener("error", onErr);
    }
    el.addEventListener(ok, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

function drawToBlob(v: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (!w || !h) return reject(new Error("no-frame"));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return reject(new Error("no-ctx"));
    ctx.drawImage(v, 0, 0, w, h);
    try {
      // 오염된 캔버스는 여기서 SecurityError — 호출부가 다음 방법으로 넘어간다
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("tainted"))), "image/png");
    } catch (e) {
      reject(e);
    }
  });
}

// 같은 소스를 CORS 모드 숨김 플레이어로 열어 같은 시점의 프레임을 뜬다
async function captureViaClone(srcUrl: string, atTime: number): Promise<Blob> {
  const v = document.createElement("video");
  v.crossOrigin = "anonymous";
  v.muted = true;
  v.preload = "auto";
  v.src = srcUrl;
  try {
    v.load();
    await waitEvent(v, "loadedmetadata", 15000);
    const dur = isFinite(v.duration) && v.duration > 0 ? v.duration : atTime + 1;
    v.currentTime = Math.min(Math.max(atTime, 0), Math.max(dur - 0.05, 0));
    await waitEvent(v, "seeked", 15000);
    return await drawToBlob(v);
  } finally {
    v.removeAttribute("src");
    try { v.load(); } catch {}
  }
}

function download(blob: Blob, base: string, at: number) {
  const m = Math.floor(at / 60);
  const s = Math.floor(at % 60);
  const safe =
    (base || "영상").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "영상";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safe}_${m}m${String(s).padStart(2, "0")}s.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export async function captureCurrentFrame(video: HTMLVideoElement, filenameBase: string): Promise<void> {
  if (!video.paused) video.pause(); // 사용자가 고른 순간을 고정
  if (video.readyState < 2) throw new Error("영상이 아직 로딩 중이에요. 재생이 시작된 뒤 캡처해 주세요.");
  const at = video.currentTime;
  const src = video.currentSrc || video.src;
  if (!src) throw new Error("영상 주소를 찾지 못했어요.");

  // ① 보이는 플레이어에서 바로 (같은 출처면 성공)
  try { download(await drawToBlob(video), filenameBase, at); return; } catch {}
  // ② 같은 소스를 CORS 모드로 다시 열어 같은 시점 캡처 (저장본·fbcdn·로컬 영상 서버)
  try { download(await captureViaClone(src, at), filenameBase, at); return; } catch {}
  // ③ 같은 출처 프록시로 우회 — CORS 헤더가 없는 원본 CDN용
  if (/^https:\/\//i.test(src)) {
    try {
      download(await captureViaClone(`/api/media/frame-proxy?url=${encodeURIComponent(src)}`, at), filenameBase, at);
      return;
    } catch {}
  }
  throw new Error("이 영상은 보안 정책 때문에 캡처할 수 없었어요. 잠시 후 다시 시도해 주세요.");
}

export default function CaptureFrameButton({
  container,
  filenameBase,
  className,
}: {
  container: React.RefObject<HTMLElement | null>;
  filenameBase: string;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function onClick() {
    if (busy) return;
    const video = container.current?.querySelector("video") ?? null;
    if (!video) {
      alert(
        "지금은 임베드 플레이어로 재생 중이라 캡처할 수 없어요.\n(유튜브·인스타 임베드는 브라우저가 화면 접근을 막아요 — 저장본 영상에서 가능해요)"
      );
      return;
    }
    setBusy(true);
    try {
      await captureCurrentFrame(video, filenameBase);
      setDone(true);
      if (doneTimer.current) clearTimeout(doneTimer.current);
      doneTimer.current = setTimeout(() => setDone(false), 2000);
    } catch (e) {
      alert(e instanceof Error && e.message ? e.message : "캡처에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      title="일시정지한 지금 이 장면을 PNG로 저장해요 (내 다운로드 폴더로)"
      className={
        className ??
        "flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 dark:bg-primary/10"
      }
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : done ? <Check className="h-3 w-3" /> : <Camera className="h-3 w-3" />}
      {busy ? "캡처 중..." : done ? "저장됨" : "화면 캡처"}
    </button>
  );
}
