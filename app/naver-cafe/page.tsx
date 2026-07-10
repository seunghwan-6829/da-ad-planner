"use client";

/* 네이버 카페 자동화 — 카페별 성질(말투/주제)에 맞춘 AI 초안 → 내가 수정 → [발행 대기]
   → 내 PC 발행 에이전트(publish-agent.bat)가 로그인된 웨일 프로필로 실제 카페에 자동 등록. */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bot,
  Coffee,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { aiFetch } from "@/lib/ai-fetch";

type Cafe = {
  id: string;
  name: string;
  cafe_url: string;
  board_name: string;
  tone: string;
  topics: string;
  notes: string;
  enabled: boolean;
};

type Post = {
  id: string;
  cafe_id: string;
  title: string;
  body: string;
  status: "draft" | "queued" | "publishing" | "published" | "failed";
  published_at: string | null;
  published_url: string | null;
  error: string | null;
  created_at: string;
  nc_cafes?: { id: string; name: string } | null;
};

const STATUS_LABEL: Record<Post["status"], string> = {
  draft: "초안",
  queued: "발행 대기",
  publishing: "발행 중",
  published: "발행 완료",
  failed: "실패",
};
const STATUS_CHIP: Record<Post["status"], string> = {
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  queued: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  publishing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  published: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300",
};

const inputCls =
  "w-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200";

/* ── 카페 추가/수정 모달 ── */
function CafeModal({
  cafe,
  onClose,
  onSaved,
  onDeleted,
}: {
  cafe: Cafe | null; // null = 신규
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [f, setF] = useState({
    name: cafe?.name || "",
    cafe_url: cafe?.cafe_url || "",
    board_name: cafe?.board_name || "",
    tone: cafe?.tone || "",
    topics: cafe?.topics || "",
    notes: cafe?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!f.name.trim() || !/cafe\.naver\.com\//i.test(f.cafe_url)) {
      alert("카페 이름과 cafe.naver.com 주소를 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/naver-cafe/cafes", {
        method: cafe ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cafe ? { id: cafe.id, ...f } : f),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error || "저장 실패 (nc_cafes 테이블 생성 여부 확인)");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!cafe) return;
    if (!confirm(`"${cafe.name}" 카페와 그 글 기록을 모두 삭제할까요?`)) return;
    const r = await fetch(`/api/naver-cafe/cafes?id=${cafe.id}`, { method: "DELETE" });
    if (r.ok) {
      onDeleted();
      onClose();
    } else alert("삭제 실패");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <h3 className="text-sm font-bold dark:text-gray-100">{cafe ? "카페 설정 수정" : "카페 추가"}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">카페 이름 *</label>
              <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="예: 강남맘 카페" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">게시판 이름</label>
              <input value={f.board_name} onChange={(e) => setF({ ...f, board_name: e.target.value })} placeholder="비우면 기본 게시판" className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">카페 주소 *</label>
            <input value={f.cafe_url} onChange={(e) => setF({ ...f, cafe_url: e.target.value })} placeholder="https://cafe.naver.com/..." className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">카페 성질 / 말투</label>
            <textarea value={f.tone} onChange={(e) => setF({ ...f, tone: e.target.value })} rows={2} placeholder="예: 3040 육아맘 커뮤니티. 존댓말, 이모지 적당히, 솔직 후기 톤 선호" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">주로 다룰 주제</label>
            <textarea value={f.topics} onChange={(e) => setF({ ...f, topics: e.target.value })} rows={2} placeholder="예: 초등 학습지 비교, 공부 습관, 학원 정보" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500 dark:text-gray-400">주의사항</label>
            <textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} placeholder="예: 직접 링크 금지, 브랜드명 직접 언급 금지" className={inputCls} />
          </div>
        </div>
        <div className="flex items-center justify-between border-t p-4 dark:border-gray-800">
          {cafe ? (
            <button onClick={remove} className="flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40">
              <Trash2 className="h-3.5 w-3.5" /> 삭제
            </button>
          ) : (
            <span />
          )}
          <button onClick={save} disabled={saving} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 글 수정 모달 ── */
function PostModal({
  post,
  onClose,
  onChanged,
}: {
  post: Post;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [title, setTitle] = useState(post.title);
  const [body, setBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const editable = post.status === "draft" || post.status === "failed" || post.status === "queued";

  async function patch(p: { title?: string; body?: string; status?: "draft" | "queued" }) {
    setBusy(true);
    try {
      const r = await fetch("/api/naver-cafe/posts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, ...p }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        alert(j.error || "저장 실패");
        return false;
      }
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-4 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[post.status]}`}>{STATUS_LABEL[post.status]}</span>
            <span className="text-sm font-bold dark:text-gray-100">{post.nc_cafes?.name}</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {post.status === "failed" && post.error ? (
            <p className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">실패 원인: {post.error}</p>
          ) : null}
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} placeholder="제목" className={inputCls} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={14} placeholder="본문" className={inputCls} />
        </div>
        <div className="flex items-center justify-end gap-2 border-t p-4 dark:border-gray-800">
          {post.published_url && (
            <a href={post.published_url} target="_blank" rel="noopener noreferrer" className="mr-auto flex items-center gap-1 text-xs text-blue-500 hover:underline">
              <ExternalLink className="h-3.5 w-3.5" /> 발행된 글 보기
            </a>
          )}
          {editable && (
            <>
              <button
                onClick={async () => {
                  if (await patch({ title, body, status: "draft" })) onClose();
                }}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Save className="h-3.5 w-3.5" /> 초안으로 저장
              </button>
              <button
                onClick={async () => {
                  if (await patch({ title, body, status: "queued" })) onClose();
                }}
                disabled={busy}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> 발행 대기로
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── 메인 ── */
export default function NaverCafePage() {
  const { profile } = useAuth();
  const [cafes, setCafes] = useState<Cafe[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null);
  const [loadErr, setLoadErr] = useState("");

  // 작성 폼
  const [selCafe, setSelCafe] = useState("");
  const [topic, setTopic] = useState("");
  const [extra, setExtra] = useState("");
  const [genBusy, setGenBusy] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);

  const [cafeModal, setCafeModal] = useState<Cafe | null | "new">(null);
  const [postModal, setPostModal] = useState<Post | null>(null);
  const [fStatus, setFStatus] = useState<"all" | Post["status"]>("all");

  const loadAll = useCallback(() => {
    fetch("/api/naver-cafe/cafes")
      .then(async (r) => {
        const j = await r.json().catch(() => []);
        if (!r.ok) throw new Error((j as { error?: string }).error);
        setCafes(j as Cafe[]);
        setLoadErr("");
      })
      .catch(() => setLoadErr("데이터를 불러오지 못했어요. nc_cafes / nc_posts 테이블이 생성됐는지 확인해 주세요."));
    fetch("/api/naver-cafe/posts")
      .then((r) => (r.ok ? r.json() : []))
      .then((j) => setPosts(j as Post[]))
      .catch(() => {});
    fetch("/api/naver-cafe/agent")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setAgentOnline(!!j.online))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 15_000); // 발행 진행 상태 갱신
    return () => clearInterval(t);
  }, [loadAll]);

  useEffect(() => {
    if (!selCafe && cafes.length) setSelCafe(cafes[0].id);
  }, [cafes, selCafe]);

  const cafe = cafes.find((c) => c.id === selCafe) || null;

  async function generate() {
    if (!cafe) {
      alert("먼저 카페를 추가/선택해 주세요.");
      return;
    }
    if (!topic.trim()) {
      alert("글 주제를 입력해 주세요.");
      return;
    }
    setGenBusy(true);
    try {
      const r = await aiFetch("/api/ai/cafe-draft", {
        method: "POST",
        body: JSON.stringify({ cafe: { name: cafe.name, tone: cafe.tone, topics: cafe.topics, notes: cafe.notes }, topic, extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error || "초안 생성 실패");
        return;
      }
      setDraftTitle(j.title || "");
      setDraftBody(j.body || "");
    } finally {
      setGenBusy(false);
    }
  }

  async function saveDraft(status: "draft" | "queued") {
    if (!cafe) return;
    if (!draftTitle.trim()) {
      alert("제목이 비어 있어요.");
      return;
    }
    setSaveBusy(true);
    try {
      const r = await fetch("/api/naver-cafe/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cafe_id: cafe.id, title: draftTitle, body: draftBody, status, created_by: profile?.email ?? null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(j.error || "저장 실패");
        return;
      }
      setDraftTitle("");
      setDraftBody("");
      setTopic("");
      setExtra("");
      loadAll();
    } finally {
      setSaveBusy(false);
    }
  }

  async function quickPatch(post: Post, p: { status?: "draft" | "queued" }) {
    await fetch("/api/naver-cafe/posts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: post.id, ...p }),
    });
    loadAll();
  }

  async function removePost(post: Post) {
    if (!confirm("이 글을 삭제할까요?")) return;
    await fetch(`/api/naver-cafe/posts?id=${post.id}`, { method: "DELETE" });
    loadAll();
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: posts.length, draft: 0, queued: 0, publishing: 0, published: 0, failed: 0 };
    for (const p of posts) c[p.status]++;
    return c;
  }, [posts]);
  const shown = fStatus === "all" ? posts : posts.filter((p) => p.status === fStatus);

  return (
    <div className="p-6">
      {/* 헤더 + 에이전트 상태 */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold dark:text-gray-100">
            <Coffee className="h-6 w-6 text-primary" /> 네이버 카페 자동화
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            카페 성질에 맞춘 AI 초안 → 내가 수정 → 발행 대기 → 내 PC 에이전트가 자동 등록
          </p>
        </div>
        <div
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${
            agentOnline
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
              : "border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
          }`}
          title={agentOnline ? "발행 대기 글이 자동으로 등록됩니다" : "내 PC에서 naver-cafe-agent/publish-agent.bat 을 실행하면 자동 발행됩니다"}
        >
          <Bot className="h-4 w-4" />
          발행 에이전트 {agentOnline == null ? "확인 중…" : agentOnline ? "온라인" : "오프라인 (publish-agent.bat 실행)"}
        </div>
      </div>

      {loadErr && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>
      )}

      {/* 카페 관리 */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold dark:text-gray-100">가입한 카페 ({cafes.length})</h2>
          <button onClick={() => setCafeModal("new")} className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white">
            <Plus className="h-3.5 w-3.5" /> 카페 추가
          </button>
        </div>
        {cafes.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">카페를 추가하고 성질(말투/주제)을 설정하면, AI 초안이 그 카페 톤에 맞게 생성돼요.</p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {cafes.map((c) => (
              <button
                key={c.id}
                onClick={() => setCafeModal(c)}
                className="group rounded-xl border border-gray-200 p-3 text-left transition hover:border-primary/50 hover:shadow-sm dark:border-gray-700"
              >
                <div className="flex items-center justify-between">
                  <p className="truncate text-sm font-semibold dark:text-gray-200">{c.name}</p>
                  <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-300 group-hover:text-primary" />
                </div>
                <p className="mt-1 truncate text-[11px] text-gray-400">{c.cafe_url.replace(/^https?:\/\//, "")}{c.board_name ? ` · ${c.board_name}` : ""}</p>
                <p className="mt-1.5 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{c.tone || "말투/성질 미설정"}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 글 작성 */}
      <div className="mb-5 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <h2 className="mb-3 text-sm font-bold dark:text-gray-100">글 작성</h2>
        <div className="mb-3 grid gap-2 md:grid-cols-[200px_1fr_auto]">
          <select value={selCafe} onChange={(e) => setSelCafe(e.target.value)} className={inputCls}>
            {cafes.length === 0 && <option value="">카페를 먼저 추가하세요</option>}
            {cafes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="글 주제 (예: 초등 수학 학습지 3개월 써본 솔직 후기)" className={inputCls} />
          <button
            onClick={generate}
            disabled={genBusy}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {genBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {genBusy ? "생성 중…" : "AI 초안 생성"}
          </button>
        </div>
        <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="추가 요청(선택) — 예: 가격 언급하지 말고, 아이 반응 위주로" className={`${inputCls} mb-3`} />
        {(draftTitle || draftBody) && (
          <div className="space-y-2 rounded-xl border border-dashed border-primary/40 bg-primary/[0.03] p-3 dark:bg-primary/[0.06]">
            <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="제목" className={inputCls} />
            <textarea value={draftBody} onChange={(e) => setDraftBody(e.target.value)} rows={10} placeholder="본문 (수정해서 발행하세요)" className={inputCls} />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => saveDraft("draft")}
                disabled={saveBusy}
                className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <Save className="h-3.5 w-3.5" /> 초안 저장
              </button>
              <button
                onClick={() => saveDraft("queued")}
                disabled={saveBusy}
                title={agentOnline ? "에이전트가 곧 자동 등록합니다" : "에이전트가 켜지면 자동 등록됩니다"}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> 발행 대기
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 글 목록 */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold dark:text-gray-100">글 목록</h2>
          <div className="flex flex-wrap gap-1">
            {(["all", "draft", "queued", "publishing", "published", "failed"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFStatus(s)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  fStatus === s ? "bg-primary text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
                }`}
              >
                {s === "all" ? "전체" : STATUS_LABEL[s]} {counts[s] ?? 0}
              </button>
            ))}
          </div>
        </div>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-400">글이 없어요. 위에서 AI 초안을 만들어 시작해 보세요.</p>
        ) : (
          <div className="divide-y dark:divide-gray-800">
            {shown.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[p.status]}`}>{STATUS_LABEL[p.status]}</span>
                <button onClick={() => setPostModal(p)} className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-medium hover:text-primary dark:text-gray-200">{p.title}</p>
                  <p className="truncate text-[11px] text-gray-400">
                    {p.nc_cafes?.name} · {new Date(p.created_at).toLocaleString("ko-KR")}
                    {p.status === "failed" && p.error ? ` · ${p.error.slice(0, 60)}` : ""}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  {p.status === "draft" && (
                    <button onClick={() => quickPatch(p, { status: "queued" })} className="flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-white">
                      <Send className="h-3 w-3" /> 발행 대기
                    </button>
                  )}
                  {p.status === "queued" && (
                    <button onClick={() => quickPatch(p, { status: "draft" })} className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                      대기 취소
                    </button>
                  )}
                  {p.status === "publishing" && <Loader2 className="h-4 w-4 animate-spin text-amber-500" />}
                  {p.status === "failed" && (
                    <button onClick={() => quickPatch(p, { status: "queued" })} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                      <RefreshCw className="h-3 w-3" /> 재시도
                    </button>
                  )}
                  {p.published_url && (
                    <a href={p.published_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                      <ExternalLink className="h-3 w-3" /> 글 보기
                    </a>
                  )}
                  {p.status !== "publishing" && (
                    <button onClick={() => removePost(p)} className="rounded-lg p-1 text-gray-300 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {cafeModal && (
        <CafeModal
          cafe={cafeModal === "new" ? null : cafeModal}
          onClose={() => setCafeModal(null)}
          onSaved={loadAll}
          onDeleted={loadAll}
        />
      )}
      {postModal && <PostModal post={postModal} onClose={() => setPostModal(null)} onChanged={loadAll} />}
    </div>
  );
}
