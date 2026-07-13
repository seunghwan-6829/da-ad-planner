"use client";

/* 기획 메모장 스튜디오 (기획안 제작 > [기획 메모장])
   - 목록: 좌측 폴더 사이드바(전체/미분류/폴더별 + 폴더 추가·이름변경·삭제) + 우측 폴더 메모 카드
   - 에디터: 큰 메인 작성란 + 실시간 AI 베리에이션 3개 + 폴더 이동 드롭다운
   - 실시간 저장(서버 디바운스 + localStorage 미러) → 이동/새로고침/크래시에도 유실 없음
   - 수정 후 저장 안 하고 나가면 '저장 후 닫기 / 취소' 팝업(수정 없으면 안 뜸) */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Folder, FolderPlus, FileText, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { aiFetch } from "@/lib/ai-fetch";

type Variation = { kind: string; text: string };
type Memo = { id: string; folder_id: string | null; title: string; content: string; variations: Variation[]; created_at: string; updated_at: string };
type MemoFolder = { id: string; name: string; color: string; sort_order: number };

const draftKey = (id: string) => `plan-memo-draft-${id}`;
const FOLDER_COLORS = ["#6366F1", "#EF4444", "#F59E0B", "#22C55E", "#06B6D4", "#EC4899", "#8B5CF6", "#64748B"];

export function PlanMemoStudio({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const owner = profile?.email || "";

  const [view, setView] = useState<"list" | "editor">("list");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [folders, setFolders] = useState<MemoFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [sel, setSel] = useState<"all" | "none" | string>("all"); // 선택 폴더

  // 폴더 편집 상태
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const loadAll = useCallback(() => {
    if (!owner) return;
    setLoading(true);
    Promise.all([
      fetch(`/api/plan-memos?owner=${encodeURIComponent(owner)}`).then((r) => (r.ok ? r.json() : Promise.reject())),
      fetch(`/api/plan-memos/folders?owner=${encodeURIComponent(owner)}`).then((r) => (r.ok ? r.json() : { folders: [] })),
    ])
      .then(([ms, fs]) => {
        setMemos(ms as Memo[]);
        setFolders((fs.folders as MemoFolder[]) || []);
        setLoadErr("");
      })
      .catch(() => setLoadErr("메모를 불러오지 못했어요. db/plan-memos.sql(폴더 포함)이 실행됐는지 확인해 주세요."))
      .finally(() => setLoading(false));
  }, [owner]);
  useEffect(() => { loadAll(); }, [loadAll]);

  // 폴더별 카운트(클라이언트 계산)
  const counts = useMemo(() => {
    const c: Record<string, number> = { __all__: memos.length, __none__: 0 };
    for (const m of memos) { const k = m.folder_id || "__none__"; c[k] = (c[k] || 0) + 1; }
    return c;
  }, [memos]);
  const shownMemos = useMemo(() => {
    if (sel === "all") return memos;
    if (sel === "none") return memos.filter((m) => !m.folder_id);
    return memos.filter((m) => m.folder_id === sel);
  }, [memos, sel]);
  const selName = sel === "all" ? "전체 메모" : sel === "none" ? "미분류" : folders.find((f) => f.id === sel)?.name || "폴더";

  // ── 폴더 CRUD ──
  async function addFolder() {
    const name = newFolderName.trim();
    if (!name) { setAddingFolder(false); return; }
    const color = FOLDER_COLORS[folders.length % FOLDER_COLORS.length];
    const r = await fetch("/api/plan-memos/folders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, name, color, sort_order: folders.length }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.error || "폴더 생성 실패 (plan_memo_folders 테이블 확인)"); return; }
    setNewFolderName(""); setAddingFolder(false);
    loadAll();
    if (j.folder?.id) setSel(j.folder.id);
  }
  async function renameFolder(id: string) {
    const name = renameVal.trim();
    setRenaming(null);
    if (!name) return;
    await fetch("/api/plan-memos/folders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, owner, name }) });
    loadAll();
  }
  async function deleteFolder(f: MemoFolder, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`"${f.name}" 폴더를 삭제할까요? (안의 메모는 미분류로 남아요)`)) return;
    await fetch(`/api/plan-memos/folders?id=${f.id}&owner=${encodeURIComponent(owner)}`, { method: "DELETE" });
    if (sel === f.id) setSel("all");
    loadAll();
  }

  // ── 에디터 상태 ──
  const [active, setActive] = useState<Memo | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [variations, setVariations] = useState<Variation[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("saved");
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiErr, setAiErr] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [exitTo, setExitTo] = useState<null | "list" | "close">(null);

  const savedRef = useRef({ title: "", content: "", folderId: null as string | null });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAiContent = useRef("");
  const activeIdRef = useRef<string | null>(null);

  const dirty = useMemo(
    () => title !== savedRef.current.title || content !== savedRef.current.content || folderId !== savedRef.current.folderId,
    [title, content, folderId],
  );
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const saveNow = useCallback(
    async (opts?: { silent?: boolean }) => {
      const id = activeIdRef.current;
      if (!id || !owner) return;
      if (!opts?.silent) setSaveState("saving");
      try {
        const r = await fetch("/api/plan-memos", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, owner, title, content, variations, folder_id: folderId }) });
        if (r.ok) {
          savedRef.current = { title, content, folderId };
          try { localStorage.removeItem(draftKey(id)); } catch {}
          if (!opts?.silent) setSaveState("saved");
          return true;
        }
      } catch {}
      if (!opts?.silent) setSaveState("idle");
      return false;
    },
    [owner, title, content, variations, folderId],
  );

  useEffect(() => {
    const id = activeIdRef.current;
    if (!id || view !== "editor") return;
    if (title === savedRef.current.title && content === savedRef.current.content && folderId === savedRef.current.folderId) return;
    try { localStorage.setItem(draftKey(id), JSON.stringify({ title, content, variations, folderId, t: Date.now() })); } catch {}
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveNow(); }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [title, content, variations, folderId, view, saveNow]);

  const genVariations = useCallback(async () => {
    const c = content.trim();
    if (c.length < 10 || c === lastAiContent.current) return;
    lastAiContent.current = c;
    setAiState("loading"); setAiErr("");
    try {
      const r = await aiFetch("/api/ai/memo-variations", { method: "POST", body: JSON.stringify({ content: c }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setAiState("error"); setAiErr(j.error || "베리에이션 생성 실패"); return; }
      if (Array.isArray(j.variations) && j.variations.length) setVariations(j.variations);
      setAiState("idle");
    } catch { setAiState("error"); setAiErr("네트워크 오류"); }
  }, [content]);

  useEffect(() => {
    if (view !== "editor") return;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => { genVariations(); }, 2500);
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current); };
  }, [content, view, genVariations]);

  useEffect(() => {
    if (view !== "editor") return;
    const flush = () => { if (dirtyRef.current) saveNow({ silent: true }); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBeforeUnload);
    const beat = setInterval(flush, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(beat);
      flush();
    };
  }, [view, saveNow]);

  function openMemo(m: Memo) {
    let t = m.title, c = m.content, v = Array.isArray(m.variations) ? m.variations : [], fid = m.folder_id ?? null;
    try {
      const raw = localStorage.getItem(draftKey(m.id));
      if (raw) {
        const d = JSON.parse(raw);
        if (d && typeof d.content === "string" && new Date(m.updated_at).getTime() < (d.t || 0)) {
          t = d.title ?? t; c = d.content; v = Array.isArray(d.variations) ? d.variations : v; fid = d.folderId ?? fid;
        }
      }
    } catch {}
    activeIdRef.current = m.id;
    setActive(m); setTitle(t); setContent(c); setVariations(v); setFolderId(fid);
    savedRef.current = { title: m.title, content: m.content, folderId: m.folder_id ?? null };
    lastAiContent.current = "";
    setSaveState(t !== m.title || c !== m.content || fid !== (m.folder_id ?? null) ? "saving" : "saved");
    setAiState("idle");
    setView("editor");
  }

  async function newMemo() {
    if (!owner) { alert("로그인이 필요해요."); return; }
    const targetFolder = sel !== "all" && sel !== "none" ? sel : null; // 선택된 폴더에 생성
    try {
      const r = await fetch("/api/plan-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, title: "무제 메모", folder_id: targetFolder }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.memo) { alert(j.error || "생성 실패 (plan_memos 테이블 확인)"); return; }
      openMemo(j.memo as Memo);
    } catch { alert("네트워크 오류로 생성하지 못했어요."); }
  }

  async function removeMemo(m: Memo, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`"${m.title || "무제 메모"}"를 삭제할까요?`)) return;
    await fetch(`/api/plan-memos?id=${m.id}&owner=${encodeURIComponent(owner)}`, { method: "DELETE" });
    try { localStorage.removeItem(draftKey(m.id)); } catch {}
    loadAll();
  }

  function requestExit(target: "list" | "close") { if (dirtyRef.current) setExitTo(target); else doExit(target); }
  function doExit(target: "list" | "close") {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    activeIdRef.current = null; setExitTo(null);
    if (target === "close") { onClose(); return; }
    setActive(null); setView("list"); loadAll();
  }
  async function saveAndExit() { if (saveTimer.current) clearTimeout(saveTimer.current); await saveNow(); doExit(exitTo || "list"); }
  function closeStudio() { if (view === "editor") requestExit("close"); else onClose(); }

  // 사이드바에서 폴더 선택(에디터 중이면 조용히 자동저장 후 목록으로). 언제든 바로 이동.
  async function navFolder(target: "all" | "none" | string) {
    if (view === "editor") {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveNow({ silent: true });
      activeIdRef.current = null;
      setActive(null);
      setView("list");
    }
    setSel(target);
    loadAll();
  }
  // 에디터 → 목록(현재 폴더 유지, 조용히 저장)
  async function goListKeep() {
    if (view === "editor") {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveNow({ silent: true });
      activeIdRef.current = null;
      setActive(null);
    }
    setView("list");
    loadAll();
  }

  const applyToMain = (v: Variation) => setContent(v.text);
  const copyVar = async (v: Variation, idx: number) => { try { await navigator.clipboard.writeText(v.text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1400); } catch {} };
  const folderColor = (id: string | null) => folders.find((f) => f.id === id)?.color || "#94a3b8";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          {view === "editor" && (
            <button onClick={goListKeep} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <ArrowLeft className="h-3.5 w-3.5" /> 목록
            </button>
          )}
          <div className="flex items-center gap-2 text-sm font-bold dark:text-gray-100"><FileText className="h-5 w-5 text-primary" /> 기획 메모장</div>
        </div>
        <button onClick={closeStudio} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-5 w-5" /></button>
      </div>

      {/* 본문: 항상 좌측 폴더 사이드바 + 우측 콘텐츠(목록/에디터) */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── 좌: 폴더 사이드바(목록·에디터 공통, 언제든 이동) ── */}
        <div className="flex w-60 shrink-0 flex-col border-r bg-gray-50/50 dark:border-gray-800 dark:bg-gray-900/40">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-xs font-bold uppercase text-gray-400">폴더</span>
            <button onClick={() => { setAddingFolder(true); setNewFolderName(""); }} title="새 폴더" className="rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800"><FolderPlus className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
            <FolderRow label="전체 메모" count={counts.__all__ || 0} icon={<FileText className="h-4 w-4" />} active={view === "list" && sel === "all"} onClick={() => navFolder("all")} />
            <FolderRow label="미분류" count={counts.__none__ || 0} icon={<Folder className="h-4 w-4" />} active={view === "list" && sel === "none"} onClick={() => navFolder("none")} />
            <div className="my-1.5 border-t dark:border-gray-800" />
            {folders.map((f) => (
              <div key={f.id} className="group relative">
                {renaming === f.id ? (
                  <input
                    autoFocus value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => renameFolder(f.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") renameFolder(f.id); if (e.key === "Escape") setRenaming(null); }}
                    className="w-full rounded-lg border border-primary px-2.5 py-2 text-sm outline-none dark:bg-gray-800 dark:text-gray-100"
                  />
                ) : (
                  <button onClick={() => navFolder(f.id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${view === "list" && sel === f.id ? "bg-primary/10 font-semibold text-primary" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: f.color }} />
                    <span className="min-w-0 flex-1 truncate text-left">{f.name}</span>
                    <span className="shrink-0 text-xs text-gray-400">{counts[f.id] || 0}</span>
                    <span onClick={(e) => { e.stopPropagation(); setRenaming(f.id); setRenameVal(f.name); }} className="hidden shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-700 group-hover:inline-flex dark:hover:text-gray-200"><Pencil className="h-3 w-3" /></span>
                    <span onClick={(e) => deleteFolder(f, e)} className="hidden shrink-0 rounded p-0.5 text-gray-400 hover:text-red-500 group-hover:inline-flex"><Trash2 className="h-3 w-3" /></span>
                  </button>
                )}
              </div>
            ))}
            {addingFolder && (
              <input
                autoFocus value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onBlur={addFolder}
                onKeyDown={(e) => { if (e.key === "Enter") addFolder(); if (e.key === "Escape") setAddingFolder(false); }}
                placeholder="폴더 이름"
                className="w-full rounded-lg border border-primary px-2.5 py-2 text-sm outline-none dark:bg-gray-800 dark:text-gray-100"
              />
            )}
          </div>
          {/* 사이드바 하단: 신규 메모장(항상) */}
          <div className="border-t p-3 dark:border-gray-800">
            <button onClick={newMemo} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> 신규 메모장</button>
          </div>
        </div>

        {/* ── 우: 콘텐츠 ── */}
        <div className="flex-1 overflow-y-auto">
          {view === "list" ? (
            /* 메모 그리드 (여백 줘서 가로폭 정돈) */
            <div className="mx-auto max-w-5xl px-8 py-6">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold dark:text-gray-100">{selName}</h1>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">쓰는 동안 자동 저장 · AI가 살짝 다른 버전 3개를 실시간 제안</p>
                </div>
                <button onClick={newMemo} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"><Plus className="h-4 w-4" /> 신규 메모장</button>
              </div>

              {loadErr && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>}

              {loading ? (
                <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : shownMemos.length === 0 ? (
                <button onClick={newMemo} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"><Plus className="h-7 w-7" /> {sel !== "all" && sel !== "none" ? "이 폴더에 첫 메모 만들기" : "첫 메모를 시작해 보세요"}</button>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  {shownMemos.map((m) => (
                    <button key={m.id} onClick={() => openMemo(m)} className="group flex h-44 flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary/40 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                      <div className="flex items-start justify-between gap-2">
                        <p className="line-clamp-1 text-sm font-bold dark:text-gray-100">{m.title || "무제 메모"}</p>
                        <span onClick={(e) => removeMemo(m, e)} className="rounded p-1 text-gray-300 opacity-0 transition group-hover:opacity-100 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></span>
                      </div>
                      <p className="mt-1.5 line-clamp-4 flex-1 whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400">{m.content || "(빈 메모)"}</p>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-gray-400">
                        {m.folder_id && sel === "all" && (<><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: folderColor(m.folder_id) }} /><span className="truncate">{folders.find((f) => f.id === m.folder_id)?.name}</span><span>·</span></>)}
                        <span>{new Date(m.updated_at).toLocaleDateString("ko-KR")}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* 에디터: 여백 준 중앙 정렬 · 본문(크게) + 우측 베리에이션 3개(항상 꽉 차 보이게) */
            <div className="mx-auto flex h-full max-w-6xl flex-col px-8 py-5">
              <div className="mb-4 flex shrink-0 items-center gap-3">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="메모 제목" className="flex-1 bg-transparent text-xl font-bold outline-none placeholder:text-gray-300 dark:text-gray-100" />
                <select value={folderId || ""} onChange={(e) => setFolderId(e.target.value || null)} title="이 메모의 폴더" className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                  <option value="">미분류</option>
                  {folders.map((f) => (<option key={f.id} value={f.id}>{f.name}</option>))}
                </select>
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  {saveState === "saving" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> 저장 중…</>) : (<><Check className="h-3.5 w-3.5 text-emerald-500" /> 저장됨</>)}
                </span>
              </div>

              <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[1.8fr_1fr]">
                {/* 메인 작성란(크게) */}
                <div className="flex min-h-0 flex-col rounded-2xl border border-gray-200 dark:border-gray-800">
                  <div className="border-b px-4 py-2.5 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">내 기획 (대본/이미지 기획 자유롭게)</div>
                  <textarea value={content} onChange={(e) => setContent(e.target.value)} autoFocus placeholder="여기에 기획을 실시간으로 적어보세요. 잠시 멈추면 오른쪽에 살짝 다른 버전 3개가 자동으로 생겨요." className="flex-1 resize-none rounded-b-2xl bg-transparent p-5 text-[15px] leading-relaxed outline-none dark:text-gray-100" />
                </div>

                {/* 우측 베리에이션 3개 — 항상 같은 높이로 꽉 차게(3등분) */}
                <div className="flex min-h-0 flex-col">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-xs font-bold text-primary"><Sparkles className="h-3.5 w-3.5" /> AI 실시간 베리에이션</span>
                    <button onClick={genVariations} disabled={aiState === "loading"} title="지금 내용으로 다시 생성" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                      {aiState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 새로고침
                    </button>
                  </div>
                  {aiState === "error" && <div className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{aiErr}</div>}
                  <div className="grid min-h-0 flex-1 grid-rows-3 gap-3">
                    {[0, 1, 2].map((i) => {
                      const v = variations[i];
                      return (
                        <div key={i} className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-900/50">
                          <div className="mb-1.5 flex shrink-0 items-center justify-between">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">{v?.kind || ["후킹 강화", "톤 변형", "구성 변형"][i]}</span>
                            {v && (
                              <div className="flex items-center gap-1">
                                <button onClick={() => copyVar(v, i)} title="복사" className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">{copiedIdx === i ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}</button>
                                <button onClick={() => applyToMain(v)} title="본문으로 적용" className="rounded px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10">적용</button>
                              </div>
                            )}
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto">
                            {v ? (
                              <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700 dark:text-gray-300">{v.text}</p>
                            ) : aiState === "loading" ? (
                              <div className="flex h-full items-center justify-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div>
                            ) : (
                              <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-gray-400">본문을 10자 이상 쓰면 이 자리에 자동으로 생겨요</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {exitTo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setExitTo(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-bold dark:text-gray-100">저장하지 않은 변경이 있어요</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">저장하고 닫을까요?</p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setExitTo(null)} className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">취소</button>
              <button onClick={saveAndExit} className="rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-white">저장 후 닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FolderRow({ label, count, icon, active, onClick }: { label: string; count: number; icon: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm ${active ? "bg-primary/10 font-semibold text-primary" : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
      <span className="shrink-0 text-gray-400">{icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="shrink-0 text-xs text-gray-400">{count}</span>
    </button>
  );
}
