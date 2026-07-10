"use client";

/* 네이버 카페 자동화 v2
   [레이아웃] 페이지 안 좌측 = 카페 패널(대시보드/가입 카페 목록/카페 추가) · 우측 = 대시보드 또는 카페 워크스페이스
   [대시보드] 현황 통계 + 발행 에이전트 상태 + "놓친 반응 측정" 큐 + 카페 선택형 기획 섹션 + 전체 원고
   [카페 워크스페이스] 페르소나/주제/기획 일정/발행 예약 설정 + AI 초안(하루 3개, 공용 Claude 키) +
     원고(클릭 → 수정 후 저장/수정 후 발행/저장/발행 4버튼 플로팅) + 발행 글 목록(24h 반응: 조회/좋아요/댓글)
   [발행/측정] 내 PC 에이전트가 디버깅(CDP) 브라우저로 사람처럼 실제 타이핑해 등록 + 24h 후 반응 측정(놓친 건 몰아서) */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Bot,
  Coffee,
  ExternalLink,
  Eye,
  Heart,
  LayoutDashboard,
  Loader2,
  MessageCircle,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type Cafe = {
  id: string;
  name: string;
  cafe_url: string; // 게시판 URL(…/cafes/<id>/menus/<menuId> 형태 권장 — 에이전트가 게시판까지 바로 진입)
  board_name: string;
  tone: string; // 활동 컨셉(페르소나)
  topics: string; // 주로 업로드하는 컨텐츠
  notes: string;
  plan_schedule: string;
  publish_slot: string; // 업로드 주기
  selling_point?: string | null; // 채널 소구점
  daily_drafts?: number | null; // 하루 AI 초안 개수
  enabled: boolean;
};

// 카페 추가/설정 공용 필드 정의(라벨·placeholder 한 곳 관리)
const CAFE_FIELDS: { key: "cafe_url" | "tone" | "selling_point" | "topics" | "publish_slot"; label: string; ph: string; rows?: number }[] = [
  { key: "cafe_url", label: "게시판 URL", ph: "https://cafe.naver.com/f-e/cafes/.../menus/... (글 올릴 게시판 주소)" },
  { key: "tone", label: "활동 컨셉", ph: "예: 정보 많은 의문의 보따리 상인, 싸가지 없지만 일은 잘함(어투·잘난척 금물)", rows: 2 },
  { key: "selling_point", label: "채널 소구점", ph: "예: 마케팅 꿀팁·파일 방출하며 팬층 쌓기", rows: 2 },
  { key: "topics", label: "주로 업로드하는 컨텐츠", ph: "예: 마케팅과 상세페이지 관련", rows: 2 },
  { key: "publish_slot", label: "업로드 주기", ph: "예: 2일에 1번씩" },
];

type Post = {
  id: string;
  cafe_id: string;
  title: string;
  body: string;
  status: "draft" | "queued" | "publishing" | "published" | "failed";
  origin: "manual" | "auto";
  published_at: string | null;
  published_url: string | null;
  error: string | null;
  track_due_at: string | null;
  tracked_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  created_at: string;
  nc_cafes?: { id: string; name: string } | null;
};

const STATUS_LABEL: Record<Post["status"], string> = { draft: "초안", queued: "발행 대기", publishing: "발행 중", published: "발행 완료", failed: "실패" };
const STATUS_CHIP: Record<Post["status"], string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  publishing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};
const inputCls = "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";

const fmtN = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());

/* ── 원고 플로팅: 제목/본문 + [수정 후 저장][수정 후 발행][저장][발행] + 발행글이면 반응 표시 ── */
function PostModal({ post, onClose, onChanged }: { post: Post; onClose: () => void; onChanged: () => void }) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const editable = post.status === "draft" || post.status === "failed" || post.status === "queued";
  const edited = title !== post.title || body !== post.body;

  async function act(withEdit: boolean, status: "draft" | "queued") {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { id: post.id, status };
      if (withEdit) { payload.title = title; payload.body = body; }
      const r = await fetch("/api/naver-cafe/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "처리 실패"); return; }
      onChanged();
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[post.status]}`}>{STATUS_LABEL[post.status]}</span>
            {post.origin === "auto" && <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">AI 초안</span>}
            <span className="text-sm font-bold dark:text-gray-100">{post.nc_cafes?.name}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {post.status === "failed" && post.error ? (
            <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">실패 원인: {post.error}</p>
          ) : null}
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} placeholder="제목" className={inputCls} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={13} placeholder="본문" className={inputCls} />
        </div>
        {editable && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t p-4 dark:border-gray-800">
            <button onClick={() => act(true, "draft")} disabled={busy || !edited} title={edited ? "수정한 내용으로 저장" : "수정된 내용이 없어요"} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <PenLine className="h-3.5 w-3.5" /> 수정 후 저장
            </button>
            <button onClick={() => act(true, "queued")} disabled={busy || !edited} title={edited ? "수정한 내용으로 발행 대기" : "수정된 내용이 없어요"} className="flex items-center gap-1 rounded-lg border border-primary/50 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-40">
              <PenLine className="h-3.5 w-3.5" /> 수정 후 발행
            </button>
            <button onClick={() => act(false, "draft")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <Save className="h-3.5 w-3.5" /> 저장
            </button>
            <button onClick={() => act(false, "queued")} disabled={busy} title="에이전트가 로그인된 브라우저로 실제 타이핑해 등록해요" className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              <Send className="h-3.5 w-3.5" /> 발행
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 기획(수동 작성) 플로팅: 제목/원고 (+대시보드에선 카페 선택) ── */
function ComposeModal({ cafes, fixedCafeId, onClose, onSaved }: { cafes: Cafe[]; fixedCafeId: string | null; onClose: () => void; onSaved: () => void }) {
  const [cafeId, setCafeId] = useState(fixedCafeId || cafes[0]?.id || "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(status: "draft" | "queued") {
    if (!cafeId) { alert("카페를 선택해 주세요."); return; }
    if (!title.trim()) { alert("제목을 입력해 주세요."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/naver-cafe/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cafe_id: cafeId, title, body, status }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); alert(j.error || "저장 실패"); return; }
      onSaved();
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <h3 className="text-sm font-bold dark:text-gray-100">직접 기획하기</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {fixedCafeId ? (
            <p className="text-xs text-gray-500 dark:text-gray-400">카페: <b className="dark:text-gray-200">{cafes.find((c) => c.id === fixedCafeId)?.name}</b></p>
          ) : (
            <select value={cafeId} onChange={(e) => setCafeId(e.target.value)} className={inputCls}>
              {cafes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" className={inputCls} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12} placeholder="원고(본문)" className={inputCls} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-4 dark:border-gray-800">
          <button onClick={() => save("draft")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Save className="h-3.5 w-3.5" /> 저장</button>
          <button onClick={() => save("queued")} disabled={busy} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"><Send className="h-3.5 w-3.5" /> 발행 대기</button>
        </div>
      </div>
    </div>
  );
}

/* ── 원고 한 줄(리스트 공용) ── */
function PostRow({ p, showCafe, onOpen, onQuick, onDelete }: { p: Post; showCafe?: boolean; onOpen: () => void; onQuick: (status: "draft" | "queued") => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span>
      {p.origin === "auto" && <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-label="AI 초안" />}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-medium hover:text-primary dark:text-gray-200">{p.title}</p>
        <p className="truncate text-[11px] text-gray-400">
          {showCafe ? `${p.nc_cafes?.name || ""} · ` : ""}{new Date(p.created_at).toLocaleString("ko-KR")}
          {p.status === "published" && p.tracked_at ? ` · 조회 ${fmtN(p.views)} · 좋아요 ${fmtN(p.likes)} · 댓글 ${fmtN(p.comments)}` : ""}
          {p.status === "failed" && p.error ? ` · ${p.error.slice(0, 50)}` : ""}
        </p>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        {p.status === "draft" && <button onClick={() => onQuick("queued")} className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white">발행 대기</button>}
        {p.status === "queued" && <button onClick={() => onQuick("draft")} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">대기 취소</button>}
        {p.status === "publishing" && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
        {p.status === "failed" && <button onClick={() => onQuick("queued")} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><RefreshCw className="h-3 w-3" /> 재시도</button>}
        {p.published_url && <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><ExternalLink className="h-3 w-3" /></a>}
        {p.status !== "publishing" && <button onClick={onDelete} className="rounded-lg p-1 text-gray-300 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  );
}

/* ── 메인 ── */
export default function NaverCafePage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [sel, setSel] = useState<string | "dash">("dash"); // 좌측 패널 선택(대시보드 또는 카페 id)
  const [postModal, setPostModal] = useState<Post | null>(null);
  const [compose, setCompose] = useState<null | { fixed: string | null }>(null);
  const [addingCafe, setAddingCafe] = useState(false); // 카페 추가 플로팅 창
  const [newCafe, setNewCafe] = useState<Record<string, string>>({ name: "", cafe_url: "", tone: "", selling_point: "", topics: "", publish_slot: "", daily_drafts: "3" });
  const [cafeForm, setCafeForm] = useState<Partial<Cafe>>({});
  const [savingCafe, setSavingCafe] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const loadAll = useCallback(() => {
    fetch("/api/naver-cafe/cafes")
      .then(async (r) => { const j = await r.json().catch(() => []); if (!r.ok) throw new Error(); setCafes(j as Cafe[]); setLoadErr(""); })
      .catch(() => setLoadErr("데이터를 불러오지 못했어요. db/naver-cafe.sql(v2 마이그레이션 포함)이 실행됐는지 확인해 주세요."));
    fetch("/api/naver-cafe/posts").then((r) => (r.ok ? r.json() : [])).then((j) => setPosts(j as Post[])).catch(() => {});
    fetch("/api/naver-cafe/agent").then((r) => (r.ok ? r.json() : null)).then((j) => j && setAgentOnline(!!j.online)).catch(() => {});
  }, []);
  useEffect(() => { loadAll(); const t = setInterval(loadAll, 15_000); return () => clearInterval(t); }, [loadAll]);

  const cafe = sel !== "dash" ? cafes.find((c) => c.id === sel) || null : null;
  useEffect(() => {
    // 카페 선택 시 설정 폼 동기화
    if (cafe) setCafeForm({ cafe_url: cafe.cafe_url, tone: cafe.tone, selling_point: cafe.selling_point || "", topics: cafe.topics, notes: cafe.notes, publish_slot: cafe.publish_slot, daily_drafts: cafe.daily_drafts ?? 3 });
  }, [cafe?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addCafe() {
    if (!newCafe.name.trim() || !/cafe\.naver\.com\//i.test(newCafe.cafe_url)) { alert("카페명과 cafe.naver.com 게시판 URL을 입력해 주세요."); return; }
    const r = await fetch("/api/naver-cafe/cafes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...newCafe, daily_drafts: Number(newCafe.daily_drafts) || 3 }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || "추가 실패"); return; }
    setNewCafe({ name: "", cafe_url: "", tone: "", selling_point: "", topics: "", publish_slot: "", daily_drafts: "3" });
    setAddingCafe(false);
    loadAll();
    if (j.cafe?.id) setSel(j.cafe.id);
  }

  async function saveCafeForm() {
    if (!cafe) return;
    setSavingCafe(true);
    try {
      const r = await fetch("/api/naver-cafe/cafes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cafe.id, ...cafeForm }) });
      if (!r.ok) { alert("저장 실패"); return; }
      loadAll();
    } finally { setSavingCafe(false); }
  }

  async function removeCafe() {
    if (!cafe) return;
    if (!confirm(`"${cafe.name}" 카페와 글 기록을 모두 삭제할까요?`)) return;
    await fetch(`/api/naver-cafe/cafes?id=${cafe.id}`, { method: "DELETE" });
    setSel("dash");
    loadAll();
  }

  async function genDrafts() {
    if (!cafe) return;
    setGenBusy(true);
    try {
      const r = await fetch("/api/naver-cafe/auto-drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cafe_id: cafe.id }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { alert(j.error || "초안 생성 실패"); return; }
      if (!j.made) alert("오늘 분량이 이미 채워져 있어요. 내일 아침 자동으로 다시 생성돼요.");
      loadAll();
    } finally { setGenBusy(false); }
  }

  async function quickPatch(p: Post, status: "draft" | "queued") {
    await fetch("/api/naver-cafe/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id, status }) });
    loadAll();
  }
  async function removePost(p: Post) {
    if (!confirm("이 글을 삭제할까요?")) return;
    await fetch(`/api/naver-cafe/posts?id=${p.id}`, { method: "DELETE" });
    loadAll();
  }

  const stats = useMemo(() => {
    const s = { queued: 0, published: 0, failed: 0, trackWait: 0 };
    const now = Date.now();
    for (const p of posts) {
      if (p.status === "queued" || p.status === "publishing") s.queued++;
      if (p.status === "published") s.published++;
      if (p.status === "failed") s.failed++;
      if (p.published_url && !p.tracked_at && p.track_due_at && new Date(p.track_due_at).getTime() <= now) s.trackWait++;
    }
    return s;
  }, [posts]);
  const trackQueue = useMemo(() => posts.filter((p) => p.published_url && !p.tracked_at && p.track_due_at && new Date(p.track_due_at) <= new Date()), [posts]);
  const cafePosts = useMemo(() => (cafe ? posts.filter((p) => p.cafe_id === cafe.id) : []), [posts, cafe]);

  // 관리자 전용(사이드바에도 잠금 표시 + 직접 URL 진입 차단)
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
    <div
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${agentOnline ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"}`}
      title={agentOnline ? "발행 대기 글을 실제 타이핑으로 등록하고, 24시간 지난 발행 글 반응을 측정합니다" : "내 PC에서 naver-cafe-agent/publish-agent.bat 실행 시 발행·반응측정이 자동으로 돌아요"}
    >
      <Bot className="h-4 w-4" /> 발행 에이전트 {agentOnline == null ? "확인 중…" : agentOnline ? "온라인" : "오프라인"}
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-0px)]">
      {/* ── 페이지 내부 좌측: 카페 패널 ── */}
      <div className="flex w-56 shrink-0 flex-col border-r bg-white dark:border-gray-800 dark:bg-gray-950">
        <div className="border-b p-3 dark:border-gray-800">
          <p className="flex items-center gap-1.5 text-sm font-bold dark:text-gray-100"><Coffee className="h-4 w-4 text-primary" /> 네이버 카페</p>
        </div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          <button onClick={() => setSel("dash")} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium ${sel === "dash" ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
            <LayoutDashboard className="h-4 w-4" /> 대시보드
          </button>
          <p className="px-2.5 pt-2 text-[10px] font-bold uppercase text-gray-400">가입한 카페</p>
          {cafes.map((c) => (
            <button key={c.id} onClick={() => setSel(c.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium ${sel === c.id ? "bg-primary text-white" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          <button onClick={() => setAddingCafe(true)} className="flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-2.5 py-2 text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
            <Plus className="h-4 w-4" /> 카페 추가
          </button>
        </div>
      </div>

      {/* ── 우측: 대시보드 or 카페 워크스페이스 ── */}
      <div className="flex-1 overflow-y-auto p-6">
        {loadErr && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>}

        {sel === "dash" ? (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100"><BarChart3 className="h-6 w-6 text-primary" /> 카페 자동화 대시보드</h1>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">카페별 페르소나 초안(매일 3개) → 검수 → 실제 타이핑 발행 → 24시간 반응 측정</p>
              </div>
              {agentBadge}
            </div>

            {/* 현황 통계 */}
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                { label: "가입 카페", value: cafes.length },
                { label: "발행 대기·중", value: stats.queued },
                { label: "발행 완료", value: stats.published },
                { label: "반응 측정 대기", value: stats.trackWait, warn: stats.trackWait > 0 },
              ].map((s) => (
                <div key={s.label} className={`rounded-2xl border p-4 ${s.warn ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30" : "border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"}`}>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{s.label}</p>
                  <p className="mt-1 text-2xl font-bold dark:text-gray-100">{s.value}</p>
                </div>
              ))}
            </div>

            {/* 놓친/대기 중 반응 측정 큐 */}
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-bold dark:text-gray-100">반응 측정 대기 ({trackQueue.length})</h2>
                <p className={`text-[11px] ${trackQueue.length > 0 && !agentOnline ? "font-semibold text-amber-600 dark:text-amber-300" : "text-gray-400"}`}>
                  {trackQueue.length > 0 && !agentOnline
                    ? "⚠ 에이전트 오프라인 — publish-agent.bat 을 켜면 밀린 것까지 한 번에 일괄 측정돼요"
                    : "PC가 꺼져 있어 놓친 것 포함 — 에이전트가 켜져 있으면 순서대로 자동 측정"}
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

            {/* 대시보드 기획 섹션(카페 선택형) */}
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold dark:text-gray-100">기획하기</h2>
                  <p className="mt-0.5 text-xs text-gray-400">직접 제목/원고를 쓰고 어느 카페에 저장할지 선택</p>
                </div>
                <button onClick={() => setCompose({ fixed: null })} disabled={!cafes.length} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">
                  <PenLine className="h-4 w-4" /> 새 기획
                </button>
              </div>
            </div>

            {/* 전체 원고 최근순 */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-2 text-sm font-bold dark:text-gray-100">전체 원고</h2>
              {posts.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">아직 원고가 없어요. 카페를 추가하고 AI 초안을 받아보세요.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {posts.slice(0, 30).map((p) => (
                    <PostRow key={p.id} p={p} showCafe onOpen={() => setPostModal(p)} onQuick={(s) => quickPatch(p, s)} onDelete={() => removePost(p)} />
                  ))}
                </div>
              )}
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
              <div className="flex items-center gap-2">
                {agentBadge}
                <button onClick={removeCafe} className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"><Trash2 className="h-3.5 w-3.5" /> 카페 삭제</button>
              </div>
            </div>

            {/* 카페 운영 설정(페르소나/주제/일정) */}
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-3 text-sm font-bold dark:text-gray-100">운영 설정 <span className="ml-1 text-[11px] font-normal text-gray-400">— AI 초안이 이 설정(특히 페르소나)에 맞춰 작성돼요</span></h2>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">게시판 URL</label>
                  <input value={(cafeForm.cafe_url as string) || ""} onChange={(e) => setCafeForm({ ...cafeForm, cafe_url: e.target.value })} placeholder="https://cafe.naver.com/f-e/cafes/.../menus/..." className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">활동 컨셉</label>
                  <textarea value={cafeForm.tone || ""} onChange={(e) => setCafeForm({ ...cafeForm, tone: e.target.value })} rows={3} placeholder="예: 정보 많은 의문의 보따리 상인(어투·잘난척 금물)" className={inputCls} />
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
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">업로드 주기</label>
                  <input value={cafeForm.publish_slot || ""} onChange={(e) => setCafeForm({ ...cafeForm, publish_slot: e.target.value })} placeholder="예: 2일에 1번씩" className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">하루 AI 원고 개수</label>
                  <input type="number" min={0} max={10} value={cafeForm.daily_drafts ?? 3} onChange={(e) => setCafeForm({ ...cafeForm, daily_drafts: Number(e.target.value) })} className={inputCls} />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button onClick={saveCafeForm} disabled={savingCafe} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">{savingCafe ? "저장 중…" : "설정 저장"}</button>
              </div>
            </div>

            {/* 원고(초안/대기/실패) */}
            <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-bold dark:text-gray-100">원고 <span className="ml-1 text-[11px] font-normal text-gray-400">— 매일 아침 AI가 {cafe.daily_drafts ?? 3}개씩 자동 작성(활동 컨셉·소구점 반영)</span></h2>
                <div className="flex gap-2">
                  <button onClick={() => setCompose({ fixed: cafe.id })} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><PenLine className="h-3.5 w-3.5" /> 직접 기획</button>
                  <button onClick={genDrafts} disabled={genBusy} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
                    {genBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} 오늘 초안 {cafe.daily_drafts ?? 3}개 생성
                  </button>
                </div>
              </div>
              {cafePosts.filter((p) => p.status !== "published").length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">대기 중인 원고가 없어요. [오늘 초안 3개 생성]을 눌러보세요.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {cafePosts.filter((p) => p.status !== "published").map((p) => (
                    <PostRow key={p.id} p={p} onOpen={() => setPostModal(p)} onQuick={(s) => quickPatch(p, s)} onDelete={() => removePost(p)} />
                  ))}
                </div>
              )}
            </div>

            {/* 발행된 글 + 24h 반응 */}
            <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
              <h2 className="mb-2 text-sm font-bold dark:text-gray-100">발행된 글 <span className="ml-1 text-[11px] font-normal text-gray-400">— 발행 24시간 후 조회/좋아요/댓글 자동 측정</span></h2>
              {cafePosts.filter((p) => p.status === "published").length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">아직 발행된 글이 없어요.</p>
              ) : (
                <div className="divide-y dark:divide-gray-800">
                  {cafePosts.filter((p) => p.status === "published").map((p) => (
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
          </>
        ) : null}
      </div>

      {postModal && <PostModal post={postModal} onClose={() => setPostModal(null)} onChanged={loadAll} />}
      {compose && <ComposeModal cafes={cafes} fixedCafeId={compose.fixed} onClose={() => setCompose(null)} onSaved={loadAll} />}

      {/* 카페 추가 플로팅 */}
      {addingCafe && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAddingCafe(false)}>
          <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
              <h3 className="text-sm font-bold dark:text-gray-100">가입한 카페 추가</h3>
              <button onClick={() => setAddingCafe(false)} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">카페명 *</label>
                <input value={newCafe.name} onChange={(e) => setNewCafe({ ...newCafe, name: e.target.value })} placeholder="예: 돈셀모" className={inputCls} />
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
              <button onClick={addCafe} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white">카페 추가</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
