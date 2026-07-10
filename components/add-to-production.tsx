"use client";

import { useEffect, useState } from "react";
import { Check, ListPlus } from "lucide-react";

/* 크롤러 상세 모달 공용 "제작 리스트 담기" 버튼.
   누르면 /production-list 보드에 스냅샷(브랜드·썸네일)과 함께 쌓인다. 이미 담긴 소재면 '담김'으로 표시. */
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
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");

  // 다른 소재로 모달이 재사용될 때 상태 초기화
  useEffect(() => {
    setState("idle");
  }, [source, refId]);

  async function add() {
    if (state !== "idle") return;
    setState("adding");
    try {
      const r = await fetch("/api/production-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, ref_id: refId, brand, thumb, media_type: mediaType, created_by: createdBy ?? null }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && (j.ok || j.dupe)) {
        setState("added"); // 신규든 중복이든 "담겨 있음"이 사실
        return;
      }
      alert(j.error || "제작 리스트 담기에 실패했어요. (production_list 테이블 생성 여부 확인)");
      setState("idle");
    } catch {
      alert("네트워크 오류로 담지 못했어요.");
      setState("idle");
    }
  }

  const added = state === "added";
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        add();
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
  );
}
