"use client";

/* 기획 메모장 스튜디오 (기획안 제작 > [기획 메모장])
   - 목록 화면: 최근/저장한 메모 카드 + [신규 메모장]
   - 에디터 화면: 큰 메인 작성란 + 실시간 AI 베리에이션 3개(살짝 다른 느낌으로 디벨롭)
   - 실시간 저장(서버 디바운스 + localStorage 미러 이중화 → 이동/새로고침/크래시에도 유실 없음)
   - 수정 후 저장 안 하고 나가면 '저장 후 닫기 / 취소' 팝업(수정 없으면 안 뜸) */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, FileText, Loader2, Plus, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { aiFetch } from "@/lib/ai-fetch";

type Variation = { kind: string; text: string };
type Memo = {
  id: string;
  title: string;
  content: string;
  variations: Variation[];
  created_at: string;
  updated_at: string;
};

const draftKey = (id: string) => `plan-memo-draft-${id}`;

export function PlanMemoStudio({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth();
  const owner = profile?.email || "";

  const [view, setView] = useState<"list" | "editor">("list");
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  const loadList = useCallback(() => {
    if (!owner) return;
    setLoading(true);
    fetch(`/api/plan-memos?owner=${encodeURIComponent(owner)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => []);
        if (!r.ok) throw new Error((j as { error?: string }).error);
        setMemos(j as Memo[]);
        setLoadErr("");
      })
      .catch(() => setLoadErr("메모를 불러오지 못했어요. db/plan-memos.sql 이 실행됐는지 확인해 주세요."))
      .finally(() => setLoading(false));
  }, [owner]);
  useEffect(() => {
    loadList();
  }, [loadList]);

  // ── 에디터 상태 ──
  const [active, setActive] = useState<Memo | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [variations, setVariations] = useState<Variation[]>([]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("saved");
  const [aiState, setAiState] = useState<"idle" | "loading" | "error">("idle");
  const [aiErr, setAiErr] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [exitTo, setExitTo] = useState<null | "list" | "close">(null); // 미저장 팝업 대상

  // 저장된 스냅샷(더티 판정용)
  const savedRef = useRef({ title: "", content: "", variations: "[]" });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAiContent = useRef("");
  const activeIdRef = useRef<string | null>(null);

  const dirty = useMemo(
    () => title !== savedRef.current.title || content !== savedRef.current.content,
    [title, content],
  );
  // dirty 를 이벤트 핸들러에서도 최신값으로 읽도록 ref 미러
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // 서버 저장(즉시). 성공하면 스냅샷 갱신 + 로컬 초안 제거.
  const saveNow = useCallback(
    async (opts?: { silent?: boolean }) => {
      const id = activeIdRef.current;
      if (!id || !owner) return;
      if (!opts?.silent) setSaveState("saving");
      const payload = { id, owner, title, content, variations };
      try {
        const r = await fetch("/api/plan-memos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (r.ok) {
          savedRef.current = { title, content, variations: JSON.stringify(variations) };
          try { localStorage.removeItem(draftKey(id)); } catch {}
          if (!opts?.silent) setSaveState("saved");
          return true;
        }
      } catch {}
      if (!opts?.silent) setSaveState("idle");
      return false;
    },
    [owner, title, content, variations],
  );

  // 내용 변경 → 로컬 즉시 미러(유실 0) + 700ms 디바운스 서버 저장
  useEffect(() => {
    const id = activeIdRef.current;
    if (!id || view !== "editor") return;
    // 초기 로드로 스냅샷과 같으면 저장 트리거 안 함
    if (title === savedRef.current.title && content === savedRef.current.content && JSON.stringify(variations) === savedRef.current.variations) return;
    try { localStorage.setItem(draftKey(id), JSON.stringify({ title, content, variations, t: Date.now() })); } catch {}
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveNow(); }, 700);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [title, content, variations, view, saveNow]);

  // 실시간 베리에이션: 2.5초 멈추면 자동 생성(내용 바뀌었고 10자 이상일 때만)
  const genVariations = useCallback(async () => {
    const c = content.trim();
    if (c.length < 10) return;
    if (c === lastAiContent.current) return;
    lastAiContent.current = c;
    setAiState("loading");
    setAiErr("");
    try {
      const r = await aiFetch("/api/ai/memo-variations", { method: "POST", body: JSON.stringify({ content: c }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setAiState("error");
        setAiErr(j.error || "베리에이션 생성 실패");
        return;
      }
      if (Array.isArray(j.variations) && j.variations.length) setVariations(j.variations);
      setAiState("idle");
    } catch {
      setAiState("error");
      setAiErr("네트워크 오류");
    }
  }, [content]);

  useEffect(() => {
    if (view !== "editor") return;
    if (aiTimer.current) clearTimeout(aiTimer.current);
    aiTimer.current = setTimeout(() => { genVariations(); }, 2500);
    return () => { if (aiTimer.current) clearTimeout(aiTimer.current); };
  }, [content, view, genVariations]);

  // 탭 숨김/이탈 시 즉시 저장(디바운스 대기분 유실 방지) + 브라우저 이탈 경고
  useEffect(() => {
    if (view !== "editor") return;
    const flush = () => { if (dirtyRef.current) saveNow({ silent: true }); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) { e.preventDefault(); e.returnValue = ""; }
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("beforeunload", onBeforeUnload);
    const beat = setInterval(flush, 5000); // 벨트+멜빵: 5초마다 미저장분 flush
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
      clearInterval(beat);
      flush(); // 언마운트 시에도 저장
    };
  }, [view, saveNow]);

  // 메모 열기: 서버 내용 로드 + 로컬 초안이 더 최신이면(크래시 등) 그걸로 복원
  function openMemo(m: Memo) {
    let t = m.title, c = m.content, v = Array.isArray(m.variations) ? m.variations : [];
    try {
      const raw = localStorage.getItem(draftKey(m.id));
      if (raw) {
        const d = JSON.parse(raw);
        // 초안이 서버보다 나중(미저장분)이면 복원
        if (d && typeof d.content === "string" && new Date(m.updated_at).getTime() < (d.t || 0)) {
          t = d.title ?? t; c = d.content; v = Array.isArray(d.variations) ? d.variations : v;
        }
      }
    } catch {}
    activeIdRef.current = m.id;
    setActive(m);
    setTitle(t);
    setContent(c);
    setVariations(v);
    savedRef.current = { title: m.title, content: m.content, variations: JSON.stringify(m.variations || []) };
    lastAiContent.current = "";
    setSaveState(t !== m.title || c !== m.content ? "saving" : "saved");
    setAiState("idle");
    setView("editor");
  }

  async function newMemo() {
    if (!owner) { alert("로그인이 필요해요."); return; }
    try {
      const r = await fetch("/api/plan-memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ owner, title: "무제 메모" }) });
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
    loadList();
  }

  // 에디터 나가기 요청(목록으로 or 스튜디오 닫기): 더티면 팝업, 아니면 바로.
  function requestExit(target: "list" | "close") {
    if (dirtyRef.current) { setExitTo(target); return; }
    doExit(target);
  }
  function doExit(target: "list" | "close") {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    activeIdRef.current = null;
    setExitTo(null);
    if (target === "close") { onClose(); return; }
    setActive(null);
    setView("list");
    loadList();
  }
  async function saveAndExit() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await saveNow();
    doExit(exitTo || "list");
  }

  // 스튜디오 자체 닫기(X): 에디터 중이면 가드 통과, 목록이면 바로.
  function closeStudio() {
    if (view === "editor") requestExit("close");
    else onClose();
  }

  const applyToMain = (v: Variation) => { setContent(v.text); };
  const copyVar = async (v: Variation, idx: number) => {
    try { await navigator.clipboard.writeText(v.text); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1400); } catch {}
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950">
      {/* 헤더 */}
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4 dark:border-gray-800">
        <div className="flex items-center gap-2.5">
          {view === "editor" && (
            <button onClick={() => requestExit("list")} className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
              <ArrowLeft className="h-3.5 w-3.5" /> 목록
            </button>
          )}
          <div className="flex items-center gap-2 text-sm font-bold dark:text-gray-100">
            <FileText className="h-5 w-5 text-primary" /> 기획 메모장
          </div>
        </div>
        <button onClick={closeStudio} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
          <X className="h-5 w-5" />
        </button>
      </div>

      {view === "list" ? (
        /* ── 목록 화면 ── */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold dark:text-gray-100">최근 작업</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">쓰는 동안 자동 저장되고, AI가 살짝 다른 버전을 실시간으로 만들어줘요.</p>
            </div>
            <button onClick={newMemo} className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">
              <Plus className="h-4 w-4" /> 신규 메모장
            </button>
          </div>

          {loadErr && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{loadErr}</div>}

          {loading ? (
            <div className="flex h-40 items-center justify-center text-gray-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : memos.length === 0 ? (
            <button onClick={newMemo} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900">
              <Plus className="h-7 w-7" /> 첫 메모를 시작해 보세요
            </button>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {memos.map((m) => (
                <button key={m.id} onClick={() => openMemo(m)} className="group flex h-44 flex-col rounded-2xl border border-gray-200 bg-white p-4 text-left transition hover:border-primary/40 hover:shadow-md dark:border-gray-800 dark:bg-gray-900">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-1 text-sm font-bold dark:text-gray-100">{m.title || "무제 메모"}</p>
                    <span onClick={(e) => removeMemo(m, e)} className="rounded p-1 text-gray-300 opacity-0 transition group-hover:opacity-100 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></span>
                  </div>
                  <p className="mt-1.5 line-clamp-4 flex-1 whitespace-pre-wrap text-xs text-gray-500 dark:text-gray-400">{m.content || "(빈 메모)"}</p>
                  <p className="mt-2 text-[11px] text-gray-400">{new Date(m.updated_at).toLocaleString("ko-KR")}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── 에디터 화면 ── */
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* 제목 + 저장상태 */}
          <div className="flex shrink-0 items-center gap-3 border-b px-6 py-3 dark:border-gray-800">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="메모 제목"
              className="flex-1 bg-transparent text-lg font-bold outline-none placeholder:text-gray-300 dark:text-gray-100"
            />
            <span className="flex items-center gap-1 text-xs text-gray-400">
              {saveState === "saving" ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> 저장 중…</>) : (<><Check className="h-3.5 w-3.5 text-emerald-500" /> 저장됨</>)}
            </span>
          </div>

          <div className="grid flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[1.7fr_1fr]">
            {/* 메인 작성란(크게) */}
            <div className="flex min-h-0 flex-col rounded-2xl border border-gray-200 dark:border-gray-800">
              <div className="border-b px-4 py-2 text-xs font-semibold text-gray-500 dark:border-gray-800 dark:text-gray-400">내 기획 (대본/이미지 기획 자유롭게)</div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                autoFocus
                placeholder="여기에 기획을 실시간으로 적어보세요. 잠시 멈추면 오른쪽에 살짝 다른 버전 3개가 자동으로 생겨요."
                className="flex-1 resize-none rounded-b-2xl bg-transparent p-4 text-[15px] leading-relaxed outline-none dark:text-gray-100"
              />
            </div>

            {/* 실시간 베리에이션 3개(작게) */}
            <div className="flex min-h-0 flex-col">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-bold text-primary"><Sparkles className="h-3.5 w-3.5" /> AI 실시간 베리에이션</span>
                <button onClick={genVariations} disabled={aiState === "loading"} title="지금 내용으로 다시 생성" className="flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800">
                  {aiState === "loading" ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} 새로고침
                </button>
              </div>
              {aiState === "error" && <div className="mb-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">{aiErr}</div>}
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                {[0, 1, 2].map((i) => {
                  const v = variations[i];
                  return (
                    <div key={i} className="rounded-xl border border-gray-200 bg-gray-50/60 p-2.5 dark:border-gray-800 dark:bg-gray-900/60">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{v?.kind || ["후킹 강화", "톤 변형", "구성 변형"][i]}</span>
                        {v && (
                          <div className="flex items-center gap-1">
                            <button onClick={() => copyVar(v, i)} title="복사" className="rounded p-0.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">{copiedIdx === i ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}</button>
                            <button onClick={() => applyToMain(v)} title="본문으로 적용" className="rounded px-1.5 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/10">적용</button>
                          </div>
                        )}
                      </div>
                      {v ? (
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700 dark:text-gray-300">{v.text}</p>
                      ) : aiState === "loading" ? (
                        <div className="flex h-16 items-center justify-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /></div>
                      ) : (
                        <p className="py-3 text-center text-[11px] text-gray-400">본문을 10자 이상 쓰면 자동 생성돼요</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 미저장 종료 팝업 */}
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
