"use client";

import { useEffect, useState } from "react";
import { Check, ListPlus, Loader2, X } from "lucide-react";
import { getClients, type Client } from "@/lib/api/clients";

/* 크롤러 상세 모달 공용 "제작 리스트 담기" 버튼.
   누르면 클라이언트 선택 플로팅이 떠서 "어느 클라이언트 제작용인지" 고른 뒤 보드에 쌓인다.
   (클라이언트 목록은 '기획안 제작'의 클라이언트 추가/삭제에 그대로 연동 — 열 때마다 새로 조회) */
export function AddToProductionButton({
  source,
  refId,
  brand,
  thumb,
  mediaType,
  createdBy,
}: {
  source: "meta" | "google" | "owned";
  refId: string;
  brand?: string | null;
  thumb?: string | null;
  mediaType?: string | null;
  createdBy?: string | null;
}) {
  const [state, setState] = useState<"idle" | "picking" | "adding" | "added">("idle");
  const [clients, setClients] = useState<Client[] | null>(null);

  // 다른 소재로 모달이 재사용될 때 상태 초기화
  useEffect(() => {
    setState("idle");
  }, [source, refId]);

  function openPicker() {
    setState("picking");
    // 열 때마다 최신 클라이언트 목록(기획안 제작에서 추가/삭제 즉시 반영)
    getClients()
      .then((cs) => setClients(cs || []))
      .catch(() => setClients([]));
  }

  async function add(clientId: string | null) {
    setState("adding");
    try {
      const r = await fetch("/api/production-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          ref_id: refId,
          brand,
          thumb,
          media_type: mediaType,
          client_id: clientId,
          created_by: createdBy ?? null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j.ok || j.dupe)) {
        setState("added"); // 신규든 중복이든 "담겨 있음"이 사실
        return;
      }
      alert(j.error || "제작 리스트 담기에 실패했어요. (production_list 테이블/client_id 컬럼 확인)");
      setState("idle");
    } catch {
      alert("네트워크 오류로 담지 못했어요.");
      setState("idle");
    }
  }

  const added = state === "added";
  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (state === "idle") openPicker();
        }}
        title={added ? "제작 리스트에 담겨 있어요" : "제작 리스트에 담기 (제작 도구 > 제작 리스트)"}
        className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
          added
            ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
        }`}
      >
        {added ? <Check className="h-3.5 w-3.5" /> : <ListPlus className="h-3.5 w-3.5" />}
        {state === "adding" ? "담는 중…" : added ? "담김" : "제작 리스트"}
      </button>

      {/* 어느 클라이언트로 보낼지 선택하는 플로팅 */}
      {(state === "picking" || state === "adding") && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4" onClick={(e) => { e.stopPropagation(); if (state === "picking") setState("idle"); }}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b p-3.5 dark:border-gray-800">
              <p className="text-sm font-bold dark:text-gray-100">어느 클라이언트 제작용인가요?</p>
              <button onClick={() => setState("idle")} disabled={state === "adding"} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2.5">
              {clients === null ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
              ) : (
                <div className="space-y-1">
                  {clients.map((c) => (
                    <button
                      key={c.id}
                      disabled={state === "adding"}
                      onClick={() => add(c.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color || "#94a3b8" }} />
                      <span className="truncate">{c.name}</span>
                    </button>
                  ))}
                  {clients.length === 0 && <p className="px-3 py-4 text-center text-xs text-gray-400">클라이언트가 없어요. 기획안 제작에서 추가해 주세요.</p>}
                  <button
                    disabled={state === "adding"}
                    onClick={() => add(null)}
                    className="mt-1 flex w-full items-center gap-2.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                  >
                    클라이언트 미지정으로 담기
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
