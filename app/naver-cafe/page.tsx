"use client";

/* 네이버 카페 자동화 v3 (리뉴얼 반영)
   [모델] 브랜드(페르소나) → 발행처(카페 보드) → 큐 아이템(초안→승인/보관/반려→발행)
   [안전] 서버 페이스 게이트(활동시간·일/주 상한·랜덤 간격) — 발행 에이전트는 "손"만, 서버가 허용 판정
   [자동] 발행처별 자동 스케줄(주기마다 초안 생성, auto_publish 면 바로 승인) — PC 꺼져도 서버 크론이 생성
   [발행/측정] 내 PC 에이전트가 로그인 브라우저로 사람처럼 실제 타이핑해 등록 + 24h 후 반응 측정(놓친 건 몰아서) */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  BarChart3,
  Bot,
  Check,
  Coffee,
  ExternalLink,
  Eye,
  Gauge,
  Heart,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  MessagesSquare,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// ── 타입 ──────────────────────────────────────────────
type Brand = {
  id: string;
  name: string;
  description: string;
  persona: string;
  default_topics: string[] | null;
  enabled: boolean;
  cafe_count?: number;
};

type Cafe = {
  id: string;
  name: string;
  cafe_url: string;
  board_name: string;
  tone: string; // 활동 컨셉(페르소나)
  topics: string;
  notes: string;
  plan_schedule: string;
  publish_slot: string;
  selling_point?: string | null;
  daily_drafts?: number | null;
  enabled: boolean;
  // v3 발행처 필드
  brand_id?: string | null;
  club_id?: string | null;
  board_id?: string | null;
  require_prefix?: boolean | null;
  prefix?: string | null;
  emphasis?: string[] | null;
  allow_post?: boolean | null;
  allow_comment?: boolean | null;
  auto_mode?: boolean | null;
  interval_days?: number | null;
  auto_publish?: boolean | null;
  rules?: { promo_banned?: boolean; notes?: string } | null;
};

type PostStatus = "draft" | "approved" | "queued" | "publishing" | "preview" | "published" | "rejected" | "failed" | "saved";

/* 에이전트 상태 상세 — "왜 안 올라가지?"를 화면에서 바로 알 수 있게. */
type AgentState = {
  online: boolean;
  last_seen: string | null;
  halted: boolean;
  halt_reason: string | null;
  fail_streak: number;
  last_event: string | null;
  last_event_at: string | null;
  next_action_at: string | null;
};

/* 대시보드 상단 카드로 고르는 화면 필터. '모두'가 기본이고 나머지는 해당 섹션만 보여준다. */
type DashView = "all" | "draft" | "approved" | "published" | "week" | "track";
const VIEW_LABEL: Record<DashView, string> = {
  all: "모두",
  draft: "검수 대기(초안)",
  approved: "발행 대기(승인)",
  published: "발행 완료",
  week: "이번 주 발행",
  track: "반응 측정 대기",
};
type Post = {
  id: string;
  cafe_id: string;
  kind?: "post" | "comment" | null;
  source_url?: string | null;
  title: string;
  body: string;
  status: PostStatus;
  origin: "manual" | "auto";
  published_at: string | null;
  published_url: string | null;
  error: string | null;
  note?: string | null;
  fail_count?: number | null;
  approved_at?: string | null;
  not_before?: string | null;
  force_publish?: boolean | null; // 지금 바로 발행(페이스 규칙 1회 건너뛰기)
  preview_url?: string | null;
  preview_at?: string | null;
  typed_title?: string | null; // 등록 직전 에디터에서 그대로 읽어온 값(캡처가 잘려도 확인 가능)
  typed_body?: string | null;
  track_due_at: string | null;
  tracked_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  created_at: string;
  nc_cafes?: { id: string; name: string } | null;
};

type Pacing = {
  active_hours: [number, number];
  daily_post_limit: number;
  daily_comment_limit: number;
  per_cafe_post_weekly: number;
  min_action_gap_min: number;
  max_action_gap_min: number;
  comment_delay_min: number;
  comment_delay_max: number;
};
type PacingStatus = {
  active: boolean;
  active_hours: [number, number];
  post_today: number;
  daily_post_limit: number;
  comment_today: number;
  daily_comment_limit: number;
  next_action_at: string | null;
  wait_min: number;
};

// ── 상태 라벨/색 ──────────────────────────────────────
const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "초안",
  saved: "보관함",
  approved: "발행 대기",
  queued: "발행 대기",
  publishing: "발행 중",
  published: "발행 완료",
  rejected: "반려",
  failed: "실패",
};
const STATUS_CHIP: Record<PostStatus, string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  saved: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  approved: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  publishing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};
const inputCls = "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";
const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

// 카페 추가/설정 공용 필드
const CAFE_FIELDS: { key: "cafe_url" | "tone" | "selling_point" | "topics" | "publish_slot"; label: string; ph: string; rows?: number }[] = [
  { key: "cafe_url", label: "게시판 URL", ph: "https://cafe.naver.com/f-e/cafes/.../menus/... (글 올릴 게시판 주소)" },
  { key: "tone", label: "활동 컨셉", ph: "예: 정보 많은 의문의 보따리 상인, 싸가지 없지만 일은 잘함(어투·잘난척 금물)", rows: 2 },
  { key: "selling_point", label: "채널 소구점", ph: "예: 마케팅 꿀팁·파일 방출하며 팬층 쌓기", rows: 2 },
  { key: "topics", label: "주로 업로드하는 컨텐츠", ph: "예: 마케팅과 상세페이지 관련", rows: 2 },
  { key: "publish_slot", label: "업로드 주기", ph: "예: 2일에 1번씩" },
];

async function api(path: string, method: string, body?: unknown) {
  const r = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "요청 실패");
  return j;
}

/* ── 큐 한 줄(초안 검수/발행 대기/발행완료 공용) ── */
function QueueRow({ p, showCafe, onOpen, onAction, onDelete }: {
  p: Post; showCafe?: boolean; onOpen: () => void; onAction: (s: PostStatus) => void; onDelete: () => void;
}) {
  const isComment = p.kind === "comment";
  return (
    <div className="flex items-center gap-2.5 py-2">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      {isComment && <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-label="댓글" />}
      {p.origin === "auto" && <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-label="AI 초안" />}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium hover:text-primary dark:text-gray-200">{p.title || (isComment ? "(댓글)" : "(제목 없음)")}</p>
        <p className="truncate text-[11px] text-gray-400">
          {showCafe ? `${p.nc_cafes?.name || ""} · ` : ""}{new Date(p.created_at).toLocaleString("ko-KR")}
          {p.status === "published" && p.tracked_at ? ` · 조회 ${fmtN(p.views)} · 좋아요 ${fmtN(p.likes)} · 댓글 ${fmtN(p.comments)}` : ""}
          {p.status === "failed" && p.error ? ` · ${p.error.slice(0, 50)}` : ""}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-1">
        {p.status === "draft" && (
          <>
            <button onClick={() => onAction("approved")} title="승인 → 발행 대기 큐로" className="rounded-lg bg-primary px-2 py-1 text-[11px] font-medium text-white">승인</button>
            <button onClick={() => onAction("saved")} title="보관함에 담기" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">보관</button>
            <button onClick={() => onAction("rejected")} title="반려" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">반려</button>
          </>
        )}
        {p.status === "saved" && (
          <button onClick={() => onAction("approved")} className="rounded-lg bg-primary px-2 py-1 text-[11px] font-medium text-white">승인</button>
        )}
        {(p.status === "approved" || p.status === "queued") && (
          <button onClick={() => onAction("draft")} title="발행 대기 취소(초안으로)" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">대기 취소</button>
        )}
        {p.status === "publishing" && (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
            <button onClick={() => onAction("draft")} title="발행 중에서 멈춘 항목 되돌리기 — 카페에 이미 올라갔는지 확인 후 사용(중복 방지)" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">되돌리기</button>
          </>
        )}
        {p.status === "rejected" && <button onClick={() => onAction("draft")} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Undo2 className="h-3 w-3" /> 되살리기</button>}
        {p.status === "failed" && <button onClick={() => onAction("approved")} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><RefreshCw className="h-3 w-3" /> 재시도</button>}
        {p.published_url && <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ExternalLink className="h-3 w-3" /></a>}
        {p.status !== "publishing" && <button onClick={onDelete} className="rounded-lg p-1 text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  );
}

/* ── 원고/댓글 상세 플로팅 ── */
function PostModal({ post, onClose, onChanged }: { post: Post; onClose: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const isComment = post.kind === "comment";
  const editable = ["draft", "saved", "rejected", "failed", "approved", "queued"].includes(post.status);
  const edited = title !== post.title || body !== post.body;

  async function act(status: PostStatus, withEdit: boolean) {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { id: post.id, status };
      if (withEdit) { payload.title = title; payload.body = body; }
      await api("/api/naver-cafe/posts", "PATCH", payload);
      onChanged();
      onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); } finally { setBusy(false); }
  }
  async function saveEdit() {
    setBusy(true);
    try { await api("/api/naver-cafe/posts", "PATCH", { id: post.id, title, body }); onChanged(); onClose(); }
    catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[post.status]}`}>{STATUS_LABEL[post.status]}</span>
            {isComment && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">댓글</span>}
            {post.origin === "auto" && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">AI 초안</span>}
            <span className="text-sm font-bold dark:text-gray-100">{post.nc_cafes?.name}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {post.status === "failed" && post.error ? (
            <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">실패 원인: {post.error}</p>
          ) : null}
          {isComment && post.source_url && (
            <a href={post.source_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-500 hover:underline">원글 보기 <ExternalLink className="h-3 w-3" /></a>
          )}
          {post.status === "published" && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 p-3 text-xs dark:bg-emerald-950/30">
              <span className="font-bold text-emerald-700 dark:text-emerald-300">24시간 반응</span>
              {post.tracked_at ? (
                <>
                  <span className="flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-200"><Eye className="h-3.5 w-3.5 text-sky-500" /> {fmtN(post.views)}</span>
                  <span className="flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-200"><Heart className="h-3.5 w-3.5 text-rose-500" /> {fmtN(post.likes)}</span>
                  <span className="flex items-center gap-1 font-semibold text-gray-700 dark:text-gray-200"><MessageCircle className="h-3.5 w-3.5 text-amber-500" /> {fmtN(post.comments)}</span>
                  <span className="text-gray-400">측정 {new Date(post.tracked_at).toLocaleString("ko-KR")}</span>
                </>
              ) : post.track_due_at && new Date(post.track_due_at) <= new Date() ? (
                <span className="text-amber-600 dark:text-amber-300">측정 대기 — 에이전트가 켜지면 자동 측정돼요</span>
              ) : (
                <span className="text-gray-500">발행 24시간 후({post.track_due_at ? new Date(post.track_due_at).toLocaleString("ko-KR") : "—"}) 자동 측정</span>
              )}
              {post.published_url && (
                <a href={post.published_url} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-300"><ExternalLink className="h-3.5 w-3.5" /> 글 보기</a>
              )}
            </div>
          )}
          {!isComment && <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} placeholder="제목" className={inputCls} />}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={isComment ? 6 : 13} placeholder={isComment ? "댓글 내용" : "본문"} className={inputCls} />
        </div>
        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4 dark:border-gray-800">
            <button onClick={saveEdit} disabled={busy || !edited} title={edited ? "수정 내용 저장(상태 유지)" : "수정된 내용이 없어요"} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Save className="h-3.5 w-3.5" /> 저장</button>
            {(post.status === "approved" || post.status === "queued") ? (
              <button onClick={() => act("draft", edited)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Undo2 className="h-3.5 w-3.5" /> 발행 대기 취소</button>
            ) : (
              <>
                <button onClick={() => act("saved", edited)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-indigo-200 px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40"><Archive className="h-3.5 w-3.5" /> 보관</button>
                <button onClick={() => act("rejected", false)} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"><X className="h-3.5 w-3.5" /> 반려</button>
                <button onClick={() => act("approved", edited)} disabled={busy} title="승인하면 페이스 규칙에 맞춰 에이전트가 자동 발행해요" className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" /> {edited ? "수정 후 승인" : "승인(발행 대기)"}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 직접 기획(수동 작성) 플로팅 ── */
function ComposeModal({ cafes, fixedCafeId, onClose, onSaved }: { cafes: Cafe[]; fixedCafeId: string | null; onClose: () => void; onSaved: () => void }) {
  const [cafeId, setCafeId] = useState(fixedCafeId || cafes[0]?.id || "");
  const [kind, setKind] = useState<"post" | "comment">("post");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(status: "draft" | "approved") {
    if (!cafeId) { alert("발행처를 선택해 주세요."); return; }
    if (kind === "post" && !title.trim()) { alert("제목을 입력해 주세요."); return; }
    if (!body.trim()) { alert("내용을 입력해 주세요."); return; }
    setBusy(true);
    try {
      await api("/api/naver-cafe/posts", "POST", { cafe_id: cafeId, kind, title, body, status, source_url: kind === "comment" ? sourceUrl : undefined });
      onSaved(); onClose();
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <h3 className="text-sm font-bold dark:text-gray-100">직접 기획하기</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <div className="flex items-center gap-2">
            {(["post", "comment"] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`rounded-lg px-3 py-1 text-xs font-medium ${kind === k ? "bg-primary text-white" : "border border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-300"}`}>{k === "post" ? "글" : "댓글"}</button>
            ))}
          </div>
          {fixedCafeId ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">발행처: <b className="dark:text-gray-200">{cafes.find((c) => c.id === fixedCafeId)?.name}</b></p>
          ) : (
            <select value={cafeId} onChange={(e) => setCafeId(e.target.value)} className={inputCls}>
              {cafes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {kind === "comment" && <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="댓글 달 원글 URL(선택)" className={inputCls} />}
          {kind === "post" && <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" className={inputCls} />}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={kind === "comment" ? 6 : 12} placeholder={kind === "comment" ? "댓글 내용" : "원고(본문)"} className={inputCls} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-4 dark:border-gray-800">
          <button onClick={() => save("draft")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Save className="h-3.5 w-3.5" /> 초안 저장</button>
          <button onClick={() => save("approved")} disabled={busy} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Check className="h-3.5 w-3.5" /> 승인(발행 대기)</button>
        </div>
      </div>
    </div>
  );
}

// 모듈 메모리 캐시(SPA 재진입 깜빡임 제거). pacing 상태는 캐시하지 않음(카드/모달 정합 위해 항상 최신 /settings 로).
let ncMemCache: { brands: Brand[]; cafes: Cafe[]; posts: Post[]; agentOnline: boolean | null } | null = null;

/* ── 메인 ── */
export default function NaverCafePage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [brands, setBrands] = useState<Brand[]>(() => ncMemCache?.brands ?? []);
  const [cafes, setCafes] = useState<Cafe[]>(() => ncMemCache?.cafes ?? []);
  const [posts, setPosts] = useState<Post[]>(() => ncMemCache?.posts ?? []);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(() => ncMemCache?.agentOnline ?? null);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set()); // 일괄 승인/반려용 선택
  const [bulkBusy, setBulkBusy] = useState(false);
  const [pacing, setPacing] = useState<Pacing | null>(null);
  const [pacingStat, setPacingStat] = useState<PacingStatus | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [sel, setSel] = useState<string | "dash">("dash");
  // 대시보드 상단 카드 = 아래 목록의 필터. '모두'면 검수 대기부터 반응 측정까지 전부 보인다.
  const [view, setView] = useState<DashView>("all");
  const [postModal, setPostModal] = useState<Post | null>(null);
  const [compose, setCompose] = useState<null | { fixed: string | null }>(null);
  const [addingCafe, setAddingCafe] = useState<null | { brand_id: string | null }>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pacingOpen, setPacingOpen] = useState(false);
  const [brandModal, setBrandModal] = useState<null | Partial<Brand>>(null);
  const [newCafe, setNewCafe] = useState<Record<string, string>>({ name: "", cafe_url: "", tone: "", selling_point: "", topics: "", publish_slot: "", daily_drafts: "3" });
  const [cafeForm, setCafeForm] = useState<Partial<Cafe>>({});
  const [savingCafe, setSavingCafe] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const loadAll = useCallback(() => {
    fetch("/api/naver-cafe/brands").then((r) => (r.ok ? r.json() : [])).then((j) => setBrands(j as Brand[])).catch(() => {});
    fetch("/api/naver-cafe/cafes")
      .then(async (r) => { const j = await r.json().catch(() => []); if (!r.ok) throw new Error(); setCafes(j as Cafe[]); setLoadErr(""); })
      .catch(() => setLoadErr("데이터를 불러오지 못했어요. db/naver-cafe.sql(v3 마이그레이션 포함)이 실행됐는지 확인해 주세요."));
    fetch("/api/naver-cafe/posts").then((r) => (r.ok ? r.json() : [])).then((j) => setPosts(j as Post[])).catch(() => {});
    // 상태 상세(마지막 동작·다음 예정·자동 중단)까지 한 번에. 실패해도 온라인 표시만 못 할 뿐.
    fetch("/api/naver-cafe/agent/state")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { setAgentOnline(!!j.online); setAgentState(j as AgentState); } })
      .catch(() => {});
    fetch("/api/naver-cafe/settings").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) { setPacing(j.pacing); setPacingStat(j.status); } }).catch(() => {});
  }, []);
  useEffect(() => { loadAll(); const t = setInterval(loadAll, 15_000); return () => clearInterval(t); }, [loadAll]);
  useEffect(() => { ncMemCache = { brands, cafes, posts, agentOnline }; }, [brands, cafes, posts, agentOnline]);

  const cafe = sel !== "dash" ? cafes.find((c) => c.id === sel) || null : null;
  useEffect(() => {
    if (cafe) setCafeForm({
      brand_id: cafe.brand_id ?? null, cafe_url: cafe.cafe_url, tone: cafe.tone, selling_point: cafe.selling_point || "",
      topics: cafe.topics, notes: cafe.notes, publish_slot: cafe.publish_slot, daily_drafts: cafe.daily_drafts ?? 3,
      club_id: cafe.club_id || "", board_id: cafe.board_id || "", require_prefix: !!cafe.require_prefix, prefix: cafe.prefix || "",
      emphasis: cafe.emphasis || [], allow_post: cafe.allow_post !== false, allow_comment: cafe.allow_comment !== false,
      auto_mode: !!cafe.auto_mode, interval_days: cafe.interval_days ?? 3, auto_publish: !!cafe.auto_publish,
    });
  }, [cafe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 액션 ──
  async function addCafe() {
    if (!newCafe.name.trim() || !/cafe\.naver\.com\//i.test(newCafe.cafe_url)) { alert("발행처명과 cafe.naver.com 게시판 URL을 입력해 주세요."); return; }
    try {
      const j = await api("/api/naver-cafe/cafes", "POST", { ...newCafe, brand_id: addingCafe?.brand_id || null, daily_drafts: Number(newCafe.daily_drafts) || 3 });
      setNewCafe({ name: "", cafe_url: "", tone: "", selling_point: "", topics: "", publish_slot: "", daily_drafts: "3" });
      setAddingCafe(null); loadAll();
      if (j.cafe?.id) setSel(j.cafe.id);
    } catch (e) { alert(e instanceof Error ? e.message : "추가 실패"); }
  }
  async function saveCafeForm() {
    if (!cafe) return;
    setSavingCafe(true);
    try { await api("/api/naver-cafe/cafes", "PATCH", { id: cafe.id, ...cafeForm }); setSettingsOpen(false); loadAll(); }
    catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); } finally { setSavingCafe(false); }
  }
  async function removeCafe() {
    if (!cafe) return;
    if (!confirm(`"${cafe.name}" 발행처와 글 기록을 모두 삭제할까요?`)) return;
    await fetch(`/api/naver-cafe/cafes?id=${cafe.id}`, { method: "DELETE" });
    setSel("dash"); loadAll();
  }
  async function genDrafts() {
    if (!cafe) return;
    setGenBusy(true);
    try {
      const j = await api("/api/naver-cafe/auto-drafts", "POST", { cafe_id: cafe.id });
      if (!j.made) {
        const err = Array.isArray(j.detail) ? j.detail.find((d: { error?: string }) => d.error)?.error : null;
        alert(err ? `초안 생성 실패: ${err}` : "오늘 분량이 이미 채워져 있어요. 내일 아침 자동으로 다시 생성돼요.");
      }
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "초안 생성 실패"); } finally { setGenBusy(false); }
  }
  async function patchStatus(p: Post, status: PostStatus) {
    try { await api("/api/naver-cafe/posts", "PATCH", { id: p.id, status }); loadAll(); }
    catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); }
  }
  /* 지금 바로 발행 — 페이스 규칙(활동시간·간격·상한)을 이 글 하나만 건너뛴다.
     계정 보호 장치를 일부러 우회하는 것이라 반드시 한 번 확인받는다. */
  async function publishNow(p: Post) {
    if (!agentOnline && !confirm("발행 에이전트가 꺼져 있어요.\n지금 지정해두면 publish-agent.bat 을 켜는 즉시 올라갑니다.\n계속할까요?")) return;
    if (!confirm(`"${p.title}"\n\n페이스 규칙(활동시간·발행 간격·일일 상한)을 건너뛰고 바로 올립니다.\n자주 쓰면 계정 제재 위험이 올라가니 테스트나 급할 때만 써주세요.\n\n진행할까요?`)) return;
    try {
      await api("/api/naver-cafe/posts", "PATCH", { id: p.id, force_publish: true });
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); }
  }
  // ── 일괄 승인/반려 ──
  function togglePick(id: string) {
    setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }
  async function bulkPatch(status: PostStatus) {
    const ids = [...picked];
    if (!ids.length) return;
    const label = status === "approved" ? "승인" : status === "rejected" ? "반려" : "보관";
    if (!confirm(`선택한 ${ids.length}건을 ${label}할까요?`)) return;
    setBulkBusy(true);
    try {
      await api("/api/naver-cafe/posts", "PATCH", { ids, status });
      setPicked(new Set());
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); } finally { setBulkBusy(false); }
  }

  // ── 발행 전 미리보기 결정 ──
  async function decidePreview(p: Post, decision: "approve" | "cancel") {
    if (decision === "cancel" && !confirm("등록하지 않고 발행 대기로 되돌릴까요?")) return;
    try {
      await api("/api/naver-cafe/posts", "PATCH", { id: p.id, preview_decision: decision });
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); }
  }

  // ── 예약 발행 (not_before) ──
  async function schedule(p: Post) {
    const cur = p.not_before ? new Date(p.not_before) : new Date(Date.now() + 3600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const def = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())} ${pad(cur.getHours())}:${pad(cur.getMinutes())}`;
    const input = prompt("이 시각 이후에 발행합니다.\n형식: YYYY-MM-DD HH:MM  (비우면 예약 해제)", def);
    if (input === null) return;
    const v = input.trim();
    if (v && Number.isNaN(new Date(v.replace(" ", "T")).getTime())) { alert("시각 형식이 올바르지 않아요. 예) 2026-07-22 14:30"); return; }
    try {
      await api("/api/naver-cafe/posts", "PATCH", { id: p.id, not_before: v ? new Date(v.replace(" ", "T")).toISOString() : null });
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); }
  }

  // ── 알림 테스트 발송 ── 설정이 맞는지 발행 없이 확인.
  async function testNotify() {
    try {
      const j = await api("/api/naver-cafe/notify-test", "POST", {});
      const c = j.configured as { email: boolean; slack: boolean; to: string | null };
      const r = j.result as { email: string; slack: string };
      if (!c.email && !c.slack) {
        alert("알림이 아직 설정되지 않았어요.\n\nVercel 환경변수에 아래 두 개를 넣어주세요:\n· RESEND_API_KEY\n· NC_NOTIFY_EMAIL (받을 메일 주소)");
        return;
      }
      const lines = [
        c.email ? `메일(${c.to}): ${r.email === "sent" ? "발송됨 ✅" : r.email}` : "메일: 미설정",
        c.slack ? `슬랙: ${r.slack === "sent" ? "발송됨 ✅" : r.slack}` : "슬랙: 미설정",
      ];
      const hint = j.hint ? `\n\n💡 ${j.hint}` : "";
      const tail = r.email === "sent" ? "\n\n메일함(스팸함도) 확인해 주세요." : "";
      alert(`알림 테스트 결과\n\n${lines.join("\n")}${hint}${tail}`);
    } catch (e) { alert(e instanceof Error ? e.message : "테스트 실패"); }
  }

  // ── 자동 중단 해제 ──
  async function resumeAgent() {
    if (!confirm("자동 중단을 해제하고 발행을 재개할까요?\n실패 원인을 먼저 확인하셨는지 점검해 주세요.")) return;
    try {
      await api("/api/naver-cafe/agent/state", "POST", { resume: true });
      loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "처리 실패"); }
  }

  async function removePost(p: Post) {
    if (!confirm("이 글을 삭제할까요?")) return;
    await fetch(`/api/naver-cafe/posts?id=${p.id}`, { method: "DELETE" });
    loadAll();
  }
  async function saveBrand() {
    if (!brandModal?.name?.trim()) { alert("브랜드 이름을 입력해 주세요."); return; }
    try {
      const payload = { id: brandModal.id, name: brandModal.name, description: brandModal.description || "", persona: brandModal.persona || "", default_topics: brandModal.default_topics || [], enabled: brandModal.enabled !== false };
      await api("/api/naver-cafe/brands", brandModal.id ? "PATCH" : "POST", payload);
      setBrandModal(null); loadAll();
    } catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  }
  async function removeBrand(id: string) {
    if (!confirm("이 브랜드를 삭제할까요? (소속 발행처는 남고 '미지정'이 됩니다)")) return;
    await fetch(`/api/naver-cafe/brands?id=${id}`, { method: "DELETE" });
    setBrandModal(null); loadAll();
  }
  async function savePacing(patch: Partial<Pacing>) {
    try { const j = await api("/api/naver-cafe/settings", "PATCH", patch); setPacing(j.pacing); loadAll(); }
    catch (e) { alert(e instanceof Error ? e.message : "저장 실패"); }
  }

  // ── 집계 ──
  const stats = useMemo(() => {
    const s = { drafts: 0, approved: 0, saved: 0, published: 0, failed: 0, trackWait: 0 };
    const now = Date.now();
    for (const p of posts) {
      if (p.status === "draft") s.drafts++;
      if (p.status === "approved" || p.status === "queued" || p.status === "publishing") s.approved++;
      if (p.status === "saved") s.saved++;
      if (p.status === "published") s.published++;
      if (p.status === "failed") s.failed++;
      if (p.published_url && !p.tracked_at && p.track_due_at && new Date(p.track_due_at).getTime() <= now) s.trackWait++;
    }
    return s;
  }, [posts]);
  const reviewQueue = useMemo(() => posts.filter((p) => p.status === "draft").slice(0, 20), [posts]);
  // 등록 직전 사람 확인을 기다리는 글(에이전트가 브라우저를 열어둔 채 대기 중).
  const previewQueue = useMemo(() => posts.filter((p) => p.status === "preview"), [posts]);
  // 승인됐지만 아직 안 올라간 글 — 여기서 수정/취소/즉시발행을 한다.
  const publishQueue = useMemo(
    () => posts.filter((p) => p.status === "approved" || p.status === "queued" || p.status === "publishing"),
    [posts]
  );
  const trackQueue = useMemo(() => posts.filter((p) => p.published_url && !p.tracked_at && p.track_due_at && new Date(p.track_due_at) <= new Date()), [posts]);
  // 발행 완료 목록. '이번 주 발행' 카드를 고르면 최근 7일만 추린다.
  const publishedList = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    return posts
      .filter((p) => p.status === "published")
      .filter((p) => (view === "week" ? !!p.published_at && new Date(p.published_at).getTime() >= weekAgo : true))
      .sort((a, b) => (b.published_at || "").localeCompare(a.published_at || ""));
  }, [posts, view]);
  const dash = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let weekPub = 0, todayDrafts = 0;
    const per = new Map(cafes.map((c) => [c.id, { id: c.id, name: c.name, published: 0, tracked: 0, views: 0, likes: 0, comments: 0, last: null as string | null }]));
    const measured: Post[] = [];
    for (const p of posts) {
      if (p.origin === "auto" && new Date(p.created_at) >= today) todayDrafts++;
      if (p.status !== "published") continue;
      if (p.published_at && new Date(p.published_at).getTime() >= weekAgo) weekPub++;
      const s = per.get(p.cafe_id);
      if (s) {
        s.published++;
        if (p.published_at && (!s.last || p.published_at > s.last)) s.last = p.published_at;
        if (p.tracked_at) { s.tracked++; s.views += p.views || 0; s.likes += p.likes || 0; s.comments += p.comments || 0; }
      }
      if (p.tracked_at) measured.push(p);
    }
    measured.sort((a, b) => (b.views || 0) - (a.views || 0));
    return { weekPub, todayDrafts, perCafe: [...per.values()], best: measured.slice(0, 3) };
  }, [posts, cafes]);
  const cafePosts = useMemo(() => (cafe ? posts.filter((p) => p.cafe_id === cafe.id) : []), [posts, cafe]);
  const cafeSplit = useMemo(() => {
    const g = { draft: [] as Post[], approved: [] as Post[], published: [] as Post[], saved: [] as Post[], other: [] as Post[] };
    for (const p of cafePosts) {
      if (p.status === "draft") g.draft.push(p);
      else if (p.status === "approved" || p.status === "queued" || p.status === "publishing") g.approved.push(p);
      else if (p.status === "published") g.published.push(p);
      else if (p.status === "saved") g.saved.push(p);
      else g.other.push(p); // rejected/failed
    }
    return g;
  }, [cafePosts]);

  // 발행처 그룹핑(브랜드별 + 미지정)
  const grouped = useMemo(() => {
    const byBrand = new Map<string, Cafe[]>();
    const unassigned: Cafe[] = [];
    for (const c of cafes) {
      if (c.brand_id) { const arr = byBrand.get(c.brand_id) || []; arr.push(c); byBrand.set(c.brand_id, arr); }
      else unassigned.push(c);
    }
    return { byBrand, unassigned };
  }, [cafes]);

  // 관리자 전용
  if (!authLoading && !isAdmin) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800"><Bot className="h-7 w-7 text-gray-400" /></div>
        <p className="text-sm font-semibold dark:text-gray-200">네이버 카페 자동화는 관리자 전용 기능이에요</p>
        <p className="text-xs text-gray-400">필요하면 관리자에게 요청해 주세요.</p>
      </div>
    );
  }

  const agentBadge = (
    <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${agentOnline ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"}`}
      title={agentOnline ? "승인된 글을 페이스 규칙에 맞춰 실제 타이핑으로 등록하고, 24시간 후 반응을 측정합니다" : "내 PC에서 naver-cafe-agent 를 실행하면 발행·반응측정이 자동으로 돌아요"}>
      <Bot className="h-4 w-4" /> 발행 에이전트 {agentOnline == null ? "확인 중…" : agentState?.halted ? "중단됨" : agentOnline ? "온라인" : "오프라인"}
    </div>
  );

  /* 에이전트 상태 상세 — 마지막 동작 / 다음 발행 예정 / 연속 실패.
     "켜져 있는데 왜 안 올라가지?"를 화면에서 바로 판단할 수 있게. */
  const agentDetail = agentState && (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-1 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[11px] dark:border-gray-800 dark:bg-gray-900">
      <span className="flex items-center gap-1.5 font-semibold dark:text-gray-200">
        <span className={`h-1.5 w-1.5 rounded-full ${agentState.halted ? "bg-rose-500" : agentState.online ? "bg-emerald-500" : "bg-gray-300"}`} />
        {agentState.halted ? "자동 중단됨" : agentState.online ? "에이전트 동작 중" : "에이전트 꺼짐"}
      </span>
      <span className="text-gray-500 dark:text-gray-400">마지막 신호 {agentState.last_seen ? new Date(agentState.last_seen).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}</span>
      <span className="text-gray-500 dark:text-gray-400">
        다음 발행 가능 {agentState.next_action_at && new Date(agentState.next_action_at) > new Date()
          ? new Date(agentState.next_action_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })
          : "지금"}
      </span>
      {agentState.fail_streak > 0 && <span className="font-semibold text-amber-600 dark:text-amber-300">연속 실패 {agentState.fail_streak}회</span>}
      <button onClick={testNotify} className="rounded-full border border-gray-200 px-2 py-0.5 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800" title="알림이 실제로 오는지 지금 확인">알림 테스트</button>
      {agentState.last_event && (
        <span className="min-w-0 flex-1 truncate text-gray-400" title={agentState.last_event}>
          최근: {agentState.last_event}
          {agentState.last_event_at ? ` (${new Date(agentState.last_event_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })})` : ""}
        </span>
      )}
    </div>
  );

  const pacingCard = pacingStat && (
    <button onClick={() => setPacingOpen(true)} className="flex items-center gap-3 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-900" title="페이스(계정 밴 방지) 설정 열기">
      <span className={`flex items-center gap-1 font-semibold ${pacingStat.active ? "text-emerald-600 dark:text-emerald-400" : "text-gray-400"}`}><Gauge className="h-3.5 w-3.5" /> {pacingStat.active ? "활동 시간" : "휴면 시간"}</span>
      <span className="text-gray-500 dark:text-gray-400">글 {pacingStat.post_today}/{pacingStat.daily_post_limit} · 댓글 {pacingStat.comment_today}/{pacingStat.daily_comment_limit}</span>
      {pacingStat.wait_min > 0 && <span className="text-amber-600 dark:text-amber-300">다음 {pacingStat.wait_min}분</span>}
      <Settings2 className="h-3.5 w-3.5 text-gray-400" />
    </button>
  );

  return (
    <div className="flex h-[calc(100vh-0px)]">
      {/* 좌측: 브랜드 → 발행처 패널 */}
      <div className="flex w-60 shrink-0 flex-col border-r bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="border-b p-3 dark:border-gray-800">
          <p className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Coffee className="h-4 w-4 text-primary" /> 네이버 카페</p>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          <button onClick={() => setSel("dash")} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${sel === "dash" ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
            <LayoutDashboard className="h-4 w-4" /> 대시보드
          </button>

          {brands.map((br) => {
            const list = grouped.byBrand.get(br.id) || [];
            return (
              <div key={br.id} className="pt-1.5">
                <div className="group flex items-center gap-1 px-2.5 py-1">
                  <span className="truncate text-[10px] font-bold uppercase text-gray-400">{br.name}</span>
                  {!br.enabled && <span className="text-[9px] text-gray-300">(비활성)</span>}
                  <button onClick={() => setBrandModal(br)} className="ml-auto opacity-0 group-hover:opacity-100" title="브랜드 설정"><Settings2 className="h-3 w-3 text-gray-400" /></button>
                  <button onClick={() => setAddingCafe({ brand_id: br.id })} title="이 브랜드에 발행처 추가"><Plus className="h-3.5 w-3.5 text-gray-400 hover:text-primary" /></button>
                </div>
                {list.map((c) => (
                  <button key={c.id} onClick={() => setSel(c.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium ${sel === c.id ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
                    <span className="truncate">{c.name}</span>
                    {c.auto_mode && <Sparkles className="ml-auto h-3 w-3 shrink-0 text-violet-400" aria-label="자동 스케줄" />}
                  </button>
                ))}
              </div>
            );
          })}

          {grouped.unassigned.length > 0 && (
            <div className="pt-1.5">
              <p className="px-2.5 py-1 text-[10px] font-bold uppercase text-gray-400">미지정</p>
              {grouped.unassigned.map((c) => (
                <button key={c.id} onClick={() => setSel(c.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm font-medium ${sel === c.id ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
                  <span className="truncate">{c.name}</span>
                  {c.auto_mode && <Sparkles className="ml-auto h-3 w-3 shrink-0 text-violet-400" />}
                </button>
              ))}
            </div>
          )}

          <div className="space-y-1 pt-2">
            <button onClick={() => setBrandModal({ name: "", persona: "", default_topics: [], enabled: true })} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <Plus className="h-4 w-4" /> 브랜드 추가
            </button>
            <button onClick={() => setAddingCafe({ brand_id: null })} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <Plus className="h-4 w-4" /> 발행처 추가
            </button>
          </div>
        </div>
      </div>

      {/* 우측 */}
      <div className="flex-1 overflow-y-auto p-6">
        {loadErr && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>}

        {sel === "dash" ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100"><BarChart3 className="h-6 w-6 text-primary" /> 카페 자동화 대시보드</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">브랜드 페르소나 초안 → 검수(승인/보관/반려) → 페이스 규칙에 맞춰 실제 타이핑 발행 → 24h 반응 측정</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">{pacingCard}{agentBadge}</div>
            </div>

            {/* 현황 통계 = 아래 목록의 필터. 카드를 누르면 그 섹션만 본다. */}
            <div className="mb-5 grid grid-cols-3 gap-3 md:grid-cols-6">
              {[
                { key: "all" as const, label: "모두", value: posts.length, hint: "전체 흐름 보기" },
                { key: "draft" as const, label: "검수 대기(초안)", value: stats.drafts, warn: stats.drafts > 0 },
                { key: "approved" as const, label: "발행 대기(승인)", value: stats.approved },
                { key: "published" as const, label: "발행 완료", value: stats.published },
                { key: "week" as const, label: "이번 주 발행", value: dash.weekPub },
                { key: "track" as const, label: "반응 측정 대기", value: stats.trackWait, warn: stats.trackWait > 0 },
              ].map((s) => {
                const active = view === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => setView(s.key)}
                    title={s.hint || `${s.label}만 보기`}
                    className={`rounded-2xl border p-4 text-left transition ${
                      active
                        ? "border-primary bg-primary/5 ring-2 ring-primary/30 dark:bg-primary/10"
                        : s.warn
                          ? "border-amber-300 bg-amber-50 hover:border-amber-400 dark:border-amber-700 dark:bg-amber-950/30"
                          : "border-gray-200 bg-white hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
                    }`}
                  >
                    <p className={`text-xs ${active ? "font-semibold text-primary" : "text-gray-500 dark:text-gray-400"}`}>{s.label}</p>
                    <p className="mt-1 text-2xl font-bold dark:text-gray-100">{s.value}</p>
                  </button>
                );
              })}
            </div>
            {agentDetail}
            {view !== "all" && (
              <div className="mb-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                <span>필터: <b className="text-primary">{VIEW_LABEL[view]}</b>만 보는 중</span>
                <button onClick={() => setView("all")} className="rounded-full border border-gray-200 px-2 py-0.5 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">전체 보기</button>
              </div>
            )}

            {/* 자동 중단 배너 — 연속 실패로 멈췄을 때. 원인 확인 후 재개. */}
            {agentState?.halted && (
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 dark:border-rose-800 dark:bg-rose-950/30">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-rose-800 dark:text-rose-200">🛑 발행이 자동으로 중단됐어요</p>
                  <p className="mt-0.5 text-xs text-rose-700 dark:text-rose-300">{agentState.halt_reason}</p>
                  <p className="mt-1 text-[11px] text-rose-600/80 dark:text-rose-400/80">같은 실패를 반복하지 않으려고 멈춘 거예요. 원인을 확인한 뒤 재개해 주세요.</p>
                </div>
                <button onClick={resumeAgent} className="shrink-0 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">재개</button>
              </div>
            )}

            {/* 등록 직전 확인 — 에이전트가 화면을 다 채우고 사람 확인을 기다리는 중 */}
            {previewQueue.length > 0 && (
              <div className="mb-5 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                <h2 className="mb-2 text-sm font-bold dark:text-gray-100">
                  ⏸ 등록 직전 확인 ({previewQueue.length})
                  <span className="ml-1 text-[11px] font-normal text-gray-500 dark:text-gray-400">— 지금 카페 글쓰기 화면이 이렇게 채워져 있어요. 확인해야 등록됩니다</span>
                </h2>
                <div className="space-y-4">
                  {previewQueue.map((p) => (
                    <div key={p.id} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold dark:text-gray-100">{p.title}</p>
                          <p className="text-[11px] text-gray-400">{p.nc_cafes?.name} · 대기 시작 {p.preview_at ? new Date(p.preview_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "—"}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button onClick={() => decidePreview(p, "cancel")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">취소</button>
                          <button onClick={() => decidePreview(p, "approve")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">이대로 등록</button>
                        </div>
                      </div>
                      {/* 실제로 에디터에 들어간 글자 — 캡처가 잘려도 전문을 여기서 읽을 수 있다.
                          원문과 다르면(타이핑 누락 등) 경고한다. */}
                      {(p.typed_body || p.typed_title) && (() => {
                        const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
                        const titleOk = !p.typed_title || norm(p.typed_title) === norm(p.title);
                        const bodyOk = !p.typed_body || norm(p.typed_body) === norm(p.body);
                        return (
                          <div className="mb-3">
                            {(!titleOk || !bodyOk) && (
                              <p className="mb-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                                ⚠ 원문과 다르게 입력됐어요({!titleOk ? "제목" : ""}{!titleOk && !bodyOk ? "·" : ""}{!bodyOk ? "본문" : ""}). 아래 내용을 꼭 확인하고 등록해 주세요.
                              </p>
                            )}
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
                              <p className="mb-1 text-[11px] font-bold text-gray-500 dark:text-gray-400">실제 입력된 내용 (에디터에서 그대로 읽음)</p>
                              {p.typed_title && <p className="mb-1.5 text-sm font-bold dark:text-gray-100">{p.typed_title}</p>}
                              {p.typed_body && (
                                <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{p.typed_body}</pre>
                              )}
                              <p className="mt-1.5 text-[11px] text-gray-400">{(p.typed_body || "").length}자</p>
                            </div>
                          </div>
                        );
                      })()}

                      {p.preview_url && (
                        <details open>
                          <summary className="mb-1.5 cursor-pointer text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400">화면 캡처 보기 (클릭하면 접기 · 이미지를 누르면 원본 크기)</summary>
                          <a href={p.preview_url} target="_blank" rel="noopener noreferrer" title="새 탭에서 원본 크기로 보기">
                            {/* 잘림 방지: 높이 제한을 두되 스크롤로 전체를 볼 수 있게. 캡처 자체는 전체 화면(fullPage). */}
                            <div className="max-h-[520px] overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.preview_url} alt="등록 직전 화면" className="w-full" />
                            </div>
                          </a>
                        </details>
                      )}
                      <p className="mt-2 text-[11px] text-gray-400">에이전트가 브라우저를 열어둔 채 기다리는 중이에요. 15분 안에 결정하지 않으면 등록하지 않고 대기로 돌아갑니다.</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 검수 대기(초안) 보드 */}
            {(view === "all" || view === "draft") && (
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold dark:text-gray-100">검수 대기 <span className="ml-1 text-[11px] font-normal text-gray-400">— 승인하면 페이스 규칙에 맞춰 자동 발행돼요</span></h2>
                <button onClick={() => setCompose({ fixed: null })} disabled={!cafes.length} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><PenLine className="h-3.5 w-3.5" /> 직접 기획</button>
              </div>
              {/* 일괄 처리 바 — 초안이 100건 넘게 쌓여 하나씩 누르기 힘들어서. */}
              {reviewQueue.length > 0 && (
                <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={picked.size > 0 && reviewQueue.every((p) => picked.has(p.id))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(reviewQueue.map((p) => p.id)) : new Set())}
                      className="h-3.5 w-3.5"
                    />
                    이 목록 전체 선택
                  </label>
                  <span className="text-xs text-gray-400">{picked.size > 0 ? `${picked.size}건 선택됨` : "체크해서 여러 건을 한 번에 처리할 수 있어요"}</span>
                  {picked.size > 0 && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button onClick={() => bulkPatch("approved")} disabled={bulkBusy} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-50">일괄 승인</button>
                      <button onClick={() => bulkPatch("saved")} disabled={bulkBusy} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">일괄 보관</button>
                      <button onClick={() => bulkPatch("rejected")} disabled={bulkBusy} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-white disabled:opacity-50 dark:border-gray-700 dark:text-gray-300">일괄 반려</button>
                      <button onClick={() => setPicked(new Set())} className="text-[11px] text-gray-400 underline">선택 해제</button>
                    </div>
                  )}
                </div>
              )}
              {reviewQueue.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">검수할 초안이 없어요. 발행처에서 [오늘 초안 생성]을 눌러보세요.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {reviewQueue.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={picked.has(p.id)} onChange={() => togglePick(p.id)} className="h-3.5 w-3.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <QueueRow p={p} showCafe onOpen={() => setPostModal(p)} onAction={(s) => patchStatus(p, s)} onDelete={() => removePost(p)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* 발행 대기(승인) 보드 — 승인 후에도 수정·취소할 수 있고, 급하면 즉시 발행한다. */}
            {(view === "all" || view === "approved") && (
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold dark:text-gray-100">
                  발행 대기 ({publishQueue.length})
                  <span className="ml-1 text-[11px] font-normal text-gray-400">— 올라가기 전이라 지금도 고치거나 취소할 수 있어요</span>
                </h2>
                {/* 왜 안 올라가는지 그 자리에서 알려준다 — 승인만 해놓고 기다리는 상황을 없애기 위해. */}
                {publishQueue.length > 0 && (() => {
                  if (!agentOnline)
                    return <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">⚠ 발행 에이전트 오프라인 — publish-agent.bat 을 켜야 올라갑니다</p>;
                  if (pacingStat && !pacingStat.active)
                    return (
                      <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                        ⏸ 지금은 휴면 시간이라 대기 중 — 바로 올리려면 [지금 발행], 시간대를 바꾸려면 상단 페이스 설정
                      </p>
                    );
                  if (pacingStat && pacingStat.wait_min > 0)
                    return <p className="text-[11px] text-amber-600 dark:text-amber-300">⏱ 다음 발행까지 {pacingStat.wait_min}분 대기 중(발행 간격 규칙)</p>;
                  if (pacingStat && pacingStat.post_today >= pacingStat.daily_post_limit)
                    return <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">📌 오늘 글 상한({pacingStat.daily_post_limit}건)을 다 채웠어요 — 내일 이어서 올라갑니다</p>;
                  return <p className="text-[11px] text-gray-400">에이전트가 페이스 규칙에 맞춰 순서대로 올려요</p>;
                })()}
              </div>
              {publishQueue.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">발행 대기 중인 글이 없어요. 검수 대기에서 승인하면 여기로 옵니다.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {publishQueue.map((p) => (
                    <div key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                      <button onClick={() => setPostModal(p)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-medium dark:text-gray-200">
                          {p.force_publish && <span className="mr-1 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">즉시</span>}
                          {p.status === "publishing" && <span className="mr-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">발행 중</span>}
                          {p.title}
                        </p>
                        <p className="truncate text-[11px] text-gray-400">
                          {p.nc_cafes?.name} · 승인 {p.approved_at ? new Date(p.approved_at).toLocaleString("ko-KR") : "—"}
                          {p.not_before && new Date(p.not_before) > new Date() ? ` · ${new Date(p.not_before).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 이후 발행 예정` : ""}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-1">
                        <button onClick={() => setPostModal(p)} title="내용 수정" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">수정</button>
                        {p.status !== "publishing" && (
                          <>
                            <button onClick={() => schedule(p)} title="이 시각 이후에 발행되도록 예약" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">{p.not_before && new Date(p.not_before) > new Date() ? "예약 변경" : "예약"}</button>
                            <button onClick={() => patchStatus(p, "draft")} title="발행 대기 취소(초안으로 되돌리기)" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">대기 취소</button>
                            <button onClick={() => publishNow(p)} title="페이스 규칙을 건너뛰고 지금 바로 올립니다" className="rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-rose-700">지금 발행</button>
                          </>
                        )}
                        {p.status === "publishing" && (
                          <button onClick={() => patchStatus(p, "approved")} title="발행 중 상태로 멈춰 있으면 되돌리기" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">되돌리기</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* 발행 완료 / 이번 주 발행 — 올라간 글 목록(원문 링크 + 반응). */}
            {(view === "all" || view === "published" || view === "week") && (
              <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold dark:text-gray-100">
                    {view === "week" ? "이번 주 발행" : "발행 완료"} ({publishedList.length})
                    <span className="ml-1 text-[11px] font-normal text-gray-400">— 제목을 누르면 실제 카페 글로 이동해요</span>
                  </h2>
                </div>
                {publishedList.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">
                    {view === "week" ? "이번 주에 발행된 글이 없어요." : "아직 발행된 글이 없어요. 발행 대기에서 에이전트가 올리면 여기에 쌓입니다."}
                  </p>
                ) : (
                  <div className="divide-y dark:divide-gray-800">
                    {publishedList.map((p) => (
                      <div key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          {p.published_url ? (
                            <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="truncate text-sm font-medium text-primary hover:underline dark:text-blue-300">{p.title}</a>
                          ) : (
                            <p className="truncate text-sm font-medium dark:text-gray-200">{p.title}</p>
                          )}
                          <p className="truncate text-[11px] text-gray-400">
                            {p.nc_cafes?.name} · {p.published_at ? new Date(p.published_at).toLocaleString("ko-KR") : "—"}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          {p.tracked_at ? (
                            <span>조회 {(p.views ?? 0).toLocaleString()} · 좋아요 {p.likes ?? 0} · 댓글 {p.comments ?? 0}</span>
                          ) : (
                            <span className="text-gray-400">반응 측정 전</span>
                          )}
                          <button onClick={() => setPostModal(p)} className="rounded-lg border border-gray-200 px-2 py-1 font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">내용</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 반응 측정 대기 */}
            {(view === "all" || view === "track") && (
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold dark:text-gray-100">반응 측정 대기 ({trackQueue.length})</h2>
                <p className={`text-[11px] ${trackQueue.length > 0 && !agentOnline ? "font-semibold text-amber-600 dark:text-amber-300" : "text-gray-400"}`}>
                  {trackQueue.length > 0 && !agentOnline ? "⚠ 에이전트 오프라인 — 에이전트를 켜면 밀린 것까지 일괄 측정" : "에이전트가 켜져 있으면 순서대로 자동 측정"}
                </p>
              </div>
              {trackQueue.length === 0 ? (
                <p className="py-3 text-center text-xs text-gray-400">측정 대기 중인 글이 없어요.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {trackQueue.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate dark:text-gray-200">{p.title}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">{p.nc_cafes?.name} · 예정 {p.track_due_at ? new Date(p.track_due_at).toLocaleString("ko-KR") : "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* 카페별 성과 | 베스트 글 */}
            <div className="mb-5 grid items-start gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-2 text-sm font-bold dark:text-gray-100">발행처별 성과 <span className="ml-1 text-[11px] font-normal text-gray-400">— 측정된 글 기준 평균 반응</span></h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b text-left text-[11px] text-gray-400 dark:border-gray-800">
                        <th className="py-1.5 pr-2 font-medium">발행처</th><th className="py-1.5 pr-2 font-medium">발행</th><th className="py-1.5 pr-2 font-medium">평균 조회</th><th className="py-1.5 pr-2 font-medium">평균 좋아요·댓글</th><th className="py-1.5 font-medium">최근 발행</th>
                      </tr>
                    </thead>
                    <tbody className="dark:text-gray-300">
                      {dash.perCafe.map((s) => (
                        <tr key={s.id} className="border-b last:border-0 dark:border-gray-800">
                          <td className="max-w-[120px] truncate py-2 pr-2 font-semibold dark:text-gray-200">{s.name}</td>
                          <td className="py-2 pr-2">{s.published}</td>
                          <td className="py-2 pr-2">{s.tracked ? Math.round(s.views / s.tracked).toLocaleString() : "—"}</td>
                          <td className="py-2 pr-2">{s.tracked ? `${Math.round(s.likes / s.tracked)}·${Math.round(s.comments / s.tracked)}` : "—"}</td>
                          <td className="py-2 text-gray-400">{s.last ? new Date(s.last).toLocaleDateString("ko-KR") : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <h2 className="mb-2 text-sm font-bold dark:text-gray-100">베스트 글 TOP 3 <span className="ml-1 text-[11px] font-normal text-gray-400">— 24h 조회수 기준</span></h2>
                {dash.best.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">아직 반응이 측정된 글이 없어요. 발행 24시간 후 자동 측정돼요.</p>
                ) : (
                  <div className="divide-y dark:divide-gray-800">
                    {dash.best.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3 py-2.5">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${i === 0 ? "bg-amber-400" : i === 1 ? "bg-gray-400" : "bg-orange-400"}`}>{i + 1}</span>
                        <button onClick={() => setPostModal(p)} className="min-w-0 flex-1 text-left">
                          <p className="truncate text-sm font-medium hover:text-primary dark:text-gray-200">{p.title}</p>
                          <p className="text-[11px] text-gray-400">{p.nc_cafes?.name}</p>
                        </button>
                        <div className="flex shrink-0 items-center gap-2.5 text-xs font-semibold text-gray-700 dark:text-gray-200">
                          <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-sky-500" /> {fmtN(p.views)}</span>
                          <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-rose-500" /> {fmtN(p.likes)}</span>
                          <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5 text-amber-500" /> {fmtN(p.comments)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : cafe ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold dark:text-gray-100">{cafe.name}</h1>
                <a href={cafe.cafe_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 flex items-center gap-1 text-xs text-blue-500 hover:underline">
                  {cafe.cafe_url.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {pacingCard}
                {agentBadge}
                <button onClick={() => setSettingsOpen(true)} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Settings2 className="h-3.5 w-3.5" /> 운영설정</button>
                <button onClick={removeCafe} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /> 삭제</button>
              </div>
            </div>

            {/* 발행처 현황 */}
            <div className="mb-5 grid grid-cols-3 gap-3 md:grid-cols-6">
              {[
                { label: "초안", value: cafeSplit.draft.length },
                { label: "발행 대기", value: cafeSplit.approved.length },
                { label: "발행 완료", value: cafeSplit.published.length },
                { label: "보관함", value: cafeSplit.saved.length },
                { label: "자동 스케줄", value: cafe.auto_mode ? `${cafe.interval_days ?? 3}일` : "꺼짐" },
                { label: "댓글 허용", value: cafe.allow_comment !== false ? "예" : "아니오" },
              ].map((s) => (
                <div key={s.label} className="rounded-2xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="mt-0.5 text-lg font-bold dark:text-gray-100">{s.value}</p>
                </div>
              ))}
            </div>

            {/* 초안(검수) | 발행 대기·발행됨 */}
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold dark:text-gray-100">초안 검수 <span className="ml-1 text-[11px] font-normal text-gray-400">— 매일 아침 AI가 자동 작성</span></h2>
                  <div className="flex gap-2">
                    <button onClick={() => setCompose({ fixed: cafe.id })} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><PenLine className="h-3.5 w-3.5" /> 직접 기획</button>
                    <button onClick={genDrafts} disabled={genBusy} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                      {genBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 오늘 초안 {cafe.daily_drafts ?? 3}개 생성
                    </button>
                  </div>
                </div>
                {cafeSplit.draft.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">검수할 초안이 없어요.</p>
                ) : (
                  <div className="divide-y dark:divide-gray-800">
                    {cafeSplit.draft.map((p) => <QueueRow key={p.id} p={p} onOpen={() => setPostModal(p)} onAction={(s) => patchStatus(p, s)} onDelete={() => removePost(p)} />)}
                  </div>
                )}
                {cafeSplit.saved.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-indigo-600 dark:text-indigo-300">보관함 ({cafeSplit.saved.length})</summary>
                    <div className="divide-y dark:divide-gray-800">
                      {cafeSplit.saved.map((p) => <QueueRow key={p.id} p={p} onOpen={() => setPostModal(p)} onAction={(s) => patchStatus(p, s)} onDelete={() => removePost(p)} />)}
                    </div>
                  </details>
                )}
                {cafeSplit.other.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold text-gray-400">반려·실패 ({cafeSplit.other.length})</summary>
                    <div className="divide-y dark:divide-gray-800">
                      {cafeSplit.other.map((p) => <QueueRow key={p.id} p={p} onOpen={() => setPostModal(p)} onAction={(s) => patchStatus(p, s)} onDelete={() => removePost(p)} />)}
                    </div>
                  </details>
                )}
              </div>

              <div className="space-y-4">
                {/* 발행 대기(승인됨) */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-2 text-sm font-bold dark:text-gray-100">발행 대기 <span className="ml-1 text-[11px] font-normal text-gray-400">— 페이스 규칙 통과 시 에이전트가 자동 발행</span></h2>
                  {cafeSplit.approved.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-400">승인 대기 중인 글이 없어요.</p>
                  ) : (
                    <div className="divide-y dark:divide-gray-800">
                      {cafeSplit.approved.map((p) => <QueueRow key={p.id} p={p} onOpen={() => setPostModal(p)} onAction={(s) => patchStatus(p, s)} onDelete={() => removePost(p)} />)}
                    </div>
                  )}
                </div>
                {/* 발행된 글 */}
                <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                  <h2 className="mb-2 text-sm font-bold dark:text-gray-100">발행된 글 <span className="ml-1 text-[11px] font-normal text-gray-400">— 24시간 후 반응 자동 측정</span></h2>
                  {cafeSplit.published.length === 0 ? (
                    <p className="py-4 text-center text-xs text-gray-400">아직 발행된 글이 없어요.</p>
                  ) : (
                    <div className="divide-y dark:divide-gray-800">
                      {cafeSplit.published.map((p) => (
                        <div key={p.id} className="flex items-center gap-3 py-2.5">
                          <button onClick={() => setPostModal(p)} className="min-w-0 flex-1 text-left">
                            <p className="truncate text-sm font-medium hover:text-primary dark:text-gray-200">{p.title}</p>
                            <p className="text-[11px] text-gray-400">{p.published_at ? new Date(p.published_at).toLocaleString("ko-KR") : ""}</p>
                          </button>
                          <div className="flex shrink-0 items-center gap-3 text-xs font-semibold text-gray-700 dark:text-gray-200">
                            {p.tracked_at ? (
                              <>
                                <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5 text-sky-500" /> {fmtN(p.views)}</span>
                                <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5 text-rose-500" /> {fmtN(p.likes)}</span>
                                <span className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5 text-amber-500" /> {fmtN(p.comments)}</span>
                              </>
                            ) : p.track_due_at && new Date(p.track_due_at) <= new Date() ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">측정 대기</span>
                            ) : (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">24h 후 측정</span>
                            )}
                            {p.published_url && <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-primary"><ExternalLink className="h-3.5 w-3.5" /></a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {postModal && <PostModal post={postModal} onClose={() => setPostModal(null)} onChanged={loadAll} />}
      {compose && <ComposeModal cafes={cafes} fixedCafeId={compose.fixed} onClose={() => setCompose(null)} onSaved={loadAll} />}

      {/* 발행처 추가 플로팅 */}
      {addingCafe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAddingCafe(null)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold dark:text-gray-100">발행처 추가 {addingCafe.brand_id ? `— ${brands.find((b) => b.id === addingCafe.brand_id)?.name}` : ""}</h3>
              <button onClick={() => setAddingCafe(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">발행처명 *</label>
                <input value={newCafe.name} onChange={(e) => setNewCafe({ ...newCafe, name: e.target.value })} placeholder="예: 돈셀모 자유게시판" className={inputCls} />
              </div>
              {CAFE_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{f.label}{f.key === "cafe_url" ? " *" : ""}</label>
                  {f.rows ? (
                    <textarea value={newCafe[f.key] || ""} onChange={(e) => setNewCafe({ ...newCafe, [f.key]: e.target.value })} rows={f.rows} placeholder={f.ph} className={inputCls} />
                  ) : (
                    <input value={newCafe[f.key] || ""} onChange={(e) => setNewCafe({ ...newCafe, [f.key]: e.target.value })} placeholder={f.ph} className={inputCls} />
                  )}
                </div>
              ))}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">하루 AI 원고 개수</label>
                <input type="number" min={0} max={10} value={newCafe.daily_drafts} onChange={(e) => setNewCafe({ ...newCafe, daily_drafts: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div className="flex justify-end border-t p-4 dark:border-gray-800">
              <button onClick={addCafe} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">발행처 추가</button>
            </div>
          </div>
        </div>
      )}

      {/* 운영설정 플로팅 */}
      {settingsOpen && cafe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSettingsOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h2 className="text-sm font-bold dark:text-gray-100">운영 설정 <span className="ml-1 text-[11px] font-normal text-gray-400">— AI 원고가 이 설정에 맞춰 작성돼요</span></h2>
              <button onClick={() => setSettingsOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">브랜드</label>
                  <select value={(cafeForm.brand_id as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, brand_id: e.target.value || null })} className={inputCls}>
                    <option value="">(미지정)</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">업로드 주기(메모)</label>
                  <input value={cafeForm.publish_slot || ""} onChange={(e) => setCafeForm({ ...cafeForm, publish_slot: e.target.value })} placeholder="예: 2일에 1번씩" className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">게시판 URL</label>
                  <input value={(cafeForm.cafe_url as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, cafe_url: e.target.value })} placeholder="https://cafe.naver.com/f-e/cafes/.../menus/..." className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">카페 club_id(선택)</label>
                  <input value={(cafeForm.club_id as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, club_id: e.target.value })} placeholder="비우면 URL에서 자동 인식" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">게시판 board_id(선택)</label>
                  <input value={(cafeForm.board_id as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, board_id: e.target.value })} placeholder="메뉴 ID" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">활동 컨셉</label>
                  <textarea value={cafeForm.tone || ""} onChange={(e) => setCafeForm({ ...cafeForm, tone: e.target.value })} rows={3} placeholder="예: 정보 많은 보따리 상인(어투·잘난척 금물)" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">채널 소구점</label>
                  <textarea value={(cafeForm.selling_point as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, selling_point: e.target.value })} rows={3} placeholder="예: 마케팅 꿀팁·파일 방출하며 팬층 쌓기" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">주로 업로드하는 컨텐츠</label>
                  <textarea value={cafeForm.topics || ""} onChange={(e) => setCafeForm({ ...cafeForm, topics: e.target.value })} rows={2} placeholder="예: 마케팅과 상세페이지 관련" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">주의사항</label>
                  <textarea value={cafeForm.notes || ""} onChange={(e) => setCafeForm({ ...cafeForm, notes: e.target.value })} rows={2} placeholder="예: 직접 링크 금지" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">강조 키워드(쉼표로 구분 — 본문 볼드)</label>
                  <input value={(cafeForm.emphasis || []).join(", ")} onChange={(e) => setCafeForm({ ...cafeForm, emphasis: e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) })} placeholder="예: 전환율, 상세페이지" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">하루 AI 원고 개수</label>
                  <input type="number" min={0} max={10} value={cafeForm.daily_drafts ?? 3} onChange={(e) => setCafeForm({ ...cafeForm, daily_drafts: Number(e.target.value) })} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">말머리(선택)</label>
                  <input value={(cafeForm.prefix as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, prefix: e.target.value })} placeholder="예: [정보]" className={inputCls} />
                </div>
              </div>

              {/* 자동 스케줄 */}
              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-900 dark:bg-violet-950/20">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
                    <input type="checkbox" checked={!!cafeForm.auto_mode} onChange={(e) => setCafeForm({ ...cafeForm, auto_mode: e.target.checked })} /> 자동 스케줄
                  </label>
                  <span className="text-[11px] text-gray-500">주기마다 초안 자동 생성(PC 꺼져도 서버가 생성)</span>
                </div>
                {cafeForm.auto_mode && (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">생성 주기(일)</label>
                      <input type="number" min={1} max={30} value={cafeForm.interval_days ?? 3} onChange={(e) => setCafeForm({ ...cafeForm, interval_days: Number(e.target.value) })} className={inputCls} />
                    </div>
                    <label className="flex items-center gap-2 self-end pb-2 text-xs text-gray-600 dark:text-gray-300">
                      <input type="checkbox" checked={!!cafeForm.auto_publish} onChange={(e) => setCafeForm({ ...cafeForm, auto_publish: e.target.checked })} /> 생성 즉시 승인(검수 생략)
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-3 flex gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={cafeForm.allow_post !== false} onChange={(e) => setCafeForm({ ...cafeForm, allow_post: e.target.checked })} /> 글 발행 허용</label>
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={cafeForm.allow_comment !== false} onChange={(e) => setCafeForm({ ...cafeForm, allow_comment: e.target.checked })} /> 댓글 허용</label>
                <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!cafeForm.require_prefix} onChange={(e) => setCafeForm({ ...cafeForm, require_prefix: e.target.checked })} /> 말머리 필수</label>
              </div>
            </div>
            <div className="flex justify-end border-t p-4 dark:border-gray-800">
              <button onClick={saveCafeForm} disabled={savingCafe} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{savingCafe ? "저장 중…" : "설정 저장"}</button>
            </div>
          </div>
        </div>
      )}

      {/* 브랜드 플로팅 */}
      {brandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setBrandModal(null)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold dark:text-gray-100">{brandModal.id ? "브랜드 설정" : "브랜드 추가"}</h3>
              <button onClick={() => setBrandModal(null)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">브랜드 이름 *</label>
                <input value={brandModal.name || ""} onChange={(e) => setBrandModal({ ...brandModal, name: e.target.value })} placeholder="예: 우리 브랜드" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">설명</label>
                <input value={brandModal.description || ""} onChange={(e) => setBrandModal({ ...brandModal, description: e.target.value })} placeholder="한 줄 설명(선택)" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">페르소나(카페 활동 인물상)</label>
                <textarea value={brandModal.persona || ""} onChange={(e) => setBrandModal({ ...brandModal, persona: e.target.value })} rows={3} placeholder="발행처에 활동 컨셉이 없을 때 이 페르소나가 쓰여요" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">기본 주제(쉼표로 구분)</label>
                <input value={(brandModal.default_topics || []).join(", ")} onChange={(e) => setBrandModal({ ...brandModal, default_topics: e.target.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) })} placeholder="발행처에 주제가 비면 여기서 상속" className={inputCls} />
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

      {/* 페이스 설정 플로팅 */}
      {pacingOpen && pacing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPacingOpen(false)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="flex items-center gap-2 text-sm font-bold dark:text-gray-100"><Gauge className="h-4 w-4 text-primary" /> 페이스(계정 밴 방지) 설정</h3>
              <button onClick={() => setPacingOpen(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <p className="rounded-lg bg-gray-50 p-2.5 text-[11px] text-gray-500 dark:bg-gray-800 dark:text-gray-400">사람처럼 보이게 하는 안전장치예요. 값을 낮게(보수적으로) 둘수록 안전합니다.</p>
              <div className="grid grid-cols-2 gap-3">
                {/* 시간 제한은 기본으로 끈다(새벽에도 발행). 필요하면 켜서 시간대를 정할 수 있게 남겨둠. */}
                {(() => {
                  const unlimited = pacing.active_hours[0] <= 0 && pacing.active_hours[1] >= 24;
                  return (
                    <div className="col-span-2 rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                      <label className="flex cursor-pointer items-center gap-2 text-xs font-medium dark:text-gray-200">
                        <input
                          type="checkbox"
                          checked={!unlimited}
                          onChange={(e) => setPacing({ ...pacing, active_hours: e.target.checked ? [9, 23] : [0, 24] })}
                          className="h-3.5 w-3.5"
                        />
                        발행 시간 제한 두기
                        <span className="font-normal text-gray-400">{unlimited ? "— 지금은 24시간 언제든 발행" : "— 정한 시간대에만 발행"}</span>
                      </label>
                      {!unlimited && (
                        <div className="mt-2 flex items-center gap-2">
                          <input type="number" min={0} max={23} value={pacing.active_hours[0]} onChange={(e) => setPacing({ ...pacing, active_hours: [Number(e.target.value), pacing.active_hours[1]] })} className={inputCls} />
                          <span className="text-gray-400">~</span>
                          <input type="number" min={1} max={24} value={pacing.active_hours[1]} onChange={(e) => setPacing({ ...pacing, active_hours: [pacing.active_hours[0], Number(e.target.value)] })} className={inputCls} />
                          <span className="shrink-0 text-[11px] text-gray-400">시</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                {([
                  ["daily_post_limit", "하루 글 상한"],
                  ["daily_comment_limit", "하루 댓글 상한"],
                  ["per_cafe_post_weekly", "발행처별 주간 글 상한"],
                  ["min_action_gap_min", "동작 간 최소 간격(분)"],
                  ["max_action_gap_min", "동작 간 최대 간격(분)"],
                  ["comment_delay_min", "댓글 최소 지연(분)"],
                  ["comment_delay_max", "댓글 최대 지연(분)"],
                ] as [keyof Pacing, string][]).map(([k, label]) => (
                  <div key={k}>
                    <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
                    <input type="number" min={0} value={pacing[k] as number} onChange={(e) => setPacing({ ...pacing, [k]: Number(e.target.value) })} className={inputCls} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end border-t p-4 dark:border-gray-800">
              <button onClick={() => { savePacing(pacing); setPacingOpen(false); }} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
