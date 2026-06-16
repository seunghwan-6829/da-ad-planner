"use client";

import { useEffect, useState, useCallback } from "react";

type Target = {
  id: string;
  label: string;
  category: string | null;
  type: "page" | "keyword";
  page_id: string | null;
  query: string | null;
  country: string;
  enabled: boolean;
};

type Ad = {
  library_id: string;
  page_name: string | null;
  started_on: string | null;
  ad_text: string | null;
  media_type: string | null;
  media_url: string | null;
  first_seen_at: string;
};

function parsePageId(input: string): string {
  const m = input.match(/view_all_page_id=(\d+)/);
  if (m) return m[1];
  const onlyDigits = input.trim();
  return /^\d+$/.test(onlyDigits) ? onlyDigits : input.trim();
}

function isNew(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 24 * 3600 * 1000;
}

export default function Home() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [ads, setAds] = useState<Ad[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);

  // 추가 폼
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("");
  const [type, setType] = useState<"page" | "keyword">("page");
  const [pageInput, setPageInput] = useState("");
  const [query, setQuery] = useState("");
  const [country, setCountry] = useState("KR");

  // 편집 상태
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<Target> & { pageInput?: string }>({});

  const loadTargets = useCallback(async () => {
    const [tRes, sRes] = await Promise.all([
      fetch("/api/targets"),
      fetch("/api/stats"),
    ]);
    if (tRes.ok) setTargets(await tRes.json());
    if (sRes.ok) setCounts((await sRes.json()).counts ?? {});
  }, []);

  const loadAds = useCallback(async (targetId: string | null) => {
    setLoading(true);
    const url = targetId ? `/api/ads?target_id=${targetId}` : "/api/ads";
    const res = await fetch(url);
    if (res.ok) setAds(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTargets();
    loadAds(null);
  }, [loadTargets, loadAds]);

  async function addTarget(e: React.FormEvent) {
    e.preventDefault();
    const body =
      type === "page"
        ? { label, category, type, page_id: parsePageId(pageInput), country }
        : { label, category, type, query, country };
    const res = await fetch("/api/targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert("추가 실패: " + (j.error ?? res.status));
      return;
    }
    setLabel("");
    setCategory("");
    setPageInput("");
    setQuery("");
    loadTargets();
  }

  async function patchTarget(id: string, patch: Record<string, unknown>) {
    await fetch(`/api/targets/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    loadTargets();
  }

  function startEdit(t: Target) {
    setEditingId(t.id);
    setEdit({
      label: t.label,
      category: t.category ?? "",
      type: t.type,
      pageInput: t.page_id ?? "",
      query: t.query ?? "",
      country: t.country,
    });
  }

  async function saveEdit(id: string) {
    const patch: Record<string, unknown> = {
      label: edit.label,
      category: edit.category,
      type: edit.type,
      country: edit.country,
    };
    if (edit.type === "page") patch.page_id = parsePageId(edit.pageInput ?? "");
    else patch.query = edit.query;
    await patchTarget(id, patch);
    setEditingId(null);
  }

  async function remove(t: Target) {
    if (!confirm(`'${t.label}' 삭제할까요? (쌓인 광고는 유지됩니다)`)) return;
    await fetch(`/api/targets/${t.id}`, { method: "DELETE" });
    if (selected === t.id) {
      setSelected(null);
      loadAds(null);
    }
    loadTargets();
  }

  function selectTarget(id: string | null) {
    setSelected(id);
    setSummary(null);
    loadAds(id);
  }

  async function summarize() {
    setSummarizing(true);
    setSummary(null);
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_id: selected }),
    });
    const j = await res.json().catch(() => ({}));
    setSummary(res.ok ? j.summary : "요약 실패: " + (j.error ?? res.status));
    setSummarizing(false);
  }

  function exportCsv() {
    const header = [
      "library_id",
      "page_name",
      "started_on",
      "media_type",
      "media_url",
      "first_seen_at",
      "ad_text",
    ];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = ads.map((a) =>
      [
        a.library_id,
        a.page_name,
        a.started_on,
        a.media_type,
        a.media_url,
        a.first_seen_at,
        a.ad_text,
      ]
        .map(esc)
        .join(",")
    );
    const blob = new Blob(["﻿" + [header.join(","), ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 카테고리(대분류)별 그룹핑
  const groups: Record<string, Target[]> = {};
  for (const t of targets) {
    const key = (t.category || "").trim() || "미분류";
    (groups[key] ||= []).push(t);
  }

  return (
    <div className="container">
      <h1>📊 메타 광고 크롤러</h1>
      <p className="muted">
        브랜드를 대분류로 묶어 관리하고, 매일 자동 수집된 경쟁사 광고를 분석합니다.
      </p>

      {/* 브랜드 추가 */}
      <form className="card" onSubmit={addTarget}>
        <div className="row" style={{ marginBottom: 10 }}>
          <strong>브랜드 추가</strong>
        </div>
        <div className="row">
          <input
            placeholder="브랜드 이름"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            style={{ flex: "1 1 160px" }}
          />
          <input
            placeholder="대분류 (예: 화장품)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{ flex: "1 1 140px" }}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "page" | "keyword")}
          >
            <option value="page">페이지</option>
            <option value="keyword">키워드</option>
          </select>
          {type === "page" ? (
            <input
              placeholder="광고 라이브러리 URL 또는 page_id"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              style={{ flex: "2 1 280px" }}
            />
          ) : (
            <input
              placeholder="검색어"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: "2 1 280px" }}
            />
          )}
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            style={{ width: 64 }}
            title="국가코드"
          />
          <button type="submit">추가</button>
        </div>
      </form>

      {/* 브랜드 목록 (대분류별) */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <strong>추적 중인 브랜드</strong>
          <span
            className={`count-badge ${selected === null ? "" : ""}`}
            style={{ cursor: "pointer" }}
            onClick={() => selectTarget(null)}
          >
            전체 보기
          </span>
        </div>

        {targets.length === 0 && (
          <p className="muted">아직 없음 — 위에서 추가하세요.</p>
        )}

        {Object.keys(groups)
          .sort()
          .map((cat) => (
            <div key={cat}>
              <div className="cat-title">{cat}</div>
              {groups[cat].map((t) =>
                editingId === t.id ? (
                  <div className="brand-row active" key={t.id}>
                    <input
                      value={edit.label ?? ""}
                      onChange={(e) =>
                        setEdit({ ...edit, label: e.target.value })
                      }
                      placeholder="이름"
                      style={{ flex: "1 1 120px" }}
                    />
                    <input
                      value={edit.category ?? ""}
                      onChange={(e) =>
                        setEdit({ ...edit, category: e.target.value })
                      }
                      placeholder="대분류"
                      style={{ width: 110 }}
                    />
                    <select
                      value={edit.type}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          type: e.target.value as "page" | "keyword",
                        })
                      }
                    >
                      <option value="page">페이지</option>
                      <option value="keyword">키워드</option>
                    </select>
                    {edit.type === "page" ? (
                      <input
                        value={edit.pageInput ?? ""}
                        onChange={(e) =>
                          setEdit({ ...edit, pageInput: e.target.value })
                        }
                        placeholder="URL 또는 page_id"
                        style={{ flex: "1 1 180px" }}
                      />
                    ) : (
                      <input
                        value={edit.query ?? ""}
                        onChange={(e) =>
                          setEdit({ ...edit, query: e.target.value })
                        }
                        placeholder="검색어"
                        style={{ flex: "1 1 180px" }}
                      />
                    )}
                    <input
                      value={edit.country ?? "KR"}
                      onChange={(e) =>
                        setEdit({ ...edit, country: e.target.value })
                      }
                      style={{ width: 56 }}
                    />
                    <button onClick={() => saveEdit(t.id)}>저장</button>
                    <button
                      className="secondary"
                      onClick={() => setEditingId(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <div
                    className={`brand-row ${selected === t.id ? "active" : ""}`}
                    key={t.id}
                  >
                    <span
                      className="brand-name"
                      onClick={() => selectTarget(t.id)}
                    >
                      {t.enabled ? "🟢" : "⚪"} {t.label}
                    </span>
                    <span className="count-badge">{counts[t.id] ?? 0}건</span>
                    <button
                      className="secondary"
                      style={{ padding: "4px 8px" }}
                      onClick={() => startEdit(t)}
                    >
                      편집
                    </button>
                    <button
                      className="secondary"
                      style={{ padding: "4px 8px" }}
                      onClick={() =>
                        patchTarget(t.id, { enabled: !t.enabled })
                      }
                    >
                      {t.enabled ? "끄기" : "켜기"}
                    </button>
                    <button
                      className="danger"
                      style={{ padding: "4px 8px" }}
                      onClick={() => remove(t)}
                    >
                      삭제
                    </button>
                  </div>
                )
              )}
            </div>
          ))}
      </div>

      {/* 광고 */}
      <div
        className="row"
        style={{ marginBottom: 10, justifyContent: "space-between" }}
      >
        <strong>
          {selected
            ? targets.find((t) => t.id === selected)?.label + " 광고"
            : "전체 광고"}{" "}
          {loading ? "(불러오는 중...)" : `(${ads.length})`}
        </strong>
        <div className="row">
          <button
            className="secondary"
            onClick={exportCsv}
            disabled={ads.length === 0}
          >
            CSV
          </button>
          <button onClick={summarize} disabled={summarizing || ads.length === 0}>
            {summarizing ? "🧠 요약 중..." : "🧠 AI 요약"}
          </button>
        </div>
      </div>

      {summary && (
        <div
          className="card"
          style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}
        >
          {summary}
        </div>
      )}

      <div className="ads-grid">
        {ads.map((ad) => (
          <div className="ad" key={ad.library_id}>
            {isNew(ad.first_seen_at) && <span className="badge new">신규</span>}
            {ad.media_type && (
              <span className="badge kind">
                {ad.media_type === "video" ? "🎬 영상" : "🖼️ 이미지"}
              </span>
            )}
            {ad.media_type === "video" && ad.media_url ? (
              <video src={ad.media_url} muted />
            ) : ad.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ad.media_url} alt="" />
            ) : null}
            <div className="body">
              <div className="meta">
                시작일: {ad.started_on ?? "—"}
                <br />
                ID: {ad.library_id}
              </div>
              <div className="text">{ad.ad_text}</div>
            </div>
          </div>
        ))}
        {!loading && ads.length === 0 && (
          <span className="muted">
            아직 수집된 광고가 없습니다. 크롤러가 한 번 실행되면 채워집니다.
          </span>
        )}
      </div>
    </div>
  );
}
