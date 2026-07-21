"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* 광고 관리자(메타·구글) 스타일 기간 선택기.
   왼쪽에 자주 쓰는 기간, 오른쪽에 2개월 달력, 아래에 취소/업데이트.
   기존의 [칩 3개 + 날짜입력 2개 + 적용버튼]을 대체한다.

   설계 메모
   - 모든 날짜 계산은 **서울(KST) 기준**. 보는 사람 PC 시간대가 달라도 결과가 흔들리지 않게
     yyyy-mm-dd 문자열 + Date.UTC 로만 계산한다(로컬 타임존·서머타임 영향 0).
   - 서버(lib/pb/*-data.ts)의 기간 타입은 TODAY|7D|30D|CUSTOM 뿐이라, 그 밖의 기간은
     실제 시작/종료일을 그대로 넘긴다(CUSTOM). 서버 수정 없이 기간 종류만 늘어난다.
   - '최근 7일/30일'은 **오늘 포함**(today-6 ~ today). 기존 화면이 쓰던 정의를 그대로 유지해
     예전 숫자와 어긋나지 않게 했다.
   - 미래 날짜는 선택 불가(데이터가 없는 구간이라 고르면 혼란만 준다). */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

const ymdToUTC = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1);
};
const utcToYmd = (t: number) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const addDays = (s: string, n: number) => utcToYmd(ymdToUTC(s) + n * 86400000);
/** 오늘(서울 기준) */
const kstToday = () => utcToYmd(Date.now() + KST_OFFSET_MS);
/** 월요일=0 인 요일 인덱스 */
const dowMon0 = (s: string) => (new Date(ymdToUTC(s)).getUTCDay() + 6) % 7;
const startOfWeek = (s: string) => addDays(s, -dowMon0(s));
const startOfMonth = (s: string) => `${s.slice(0, 7)}-01`;
const endOfMonth = (s: string) => {
  const [y, m] = s.split("-").map(Number);
  return utcToYmd(Date.UTC(y, m, 0));
};
/** 2026. 7. 1. 형태 */
const fmtKo = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return `${y}. ${m}. ${d}.`;
};

export type DateRange = { startDate: string; endDate: string };

type Preset = { key: string; label: string; range: (today: string) => DateRange };

const PRESETS: Preset[] = [
  { key: "TODAY", label: "오늘", range: (t) => ({ startDate: t, endDate: t }) },
  { key: "YESTERDAY", label: "어제", range: (t) => ({ startDate: addDays(t, -1), endDate: addDays(t, -1) }) },
  { key: "TODAY_YESTERDAY", label: "오늘과 어제", range: (t) => ({ startDate: addDays(t, -1), endDate: t }) },
  { key: "7D", label: "최근 7일", range: (t) => ({ startDate: addDays(t, -6), endDate: t }) },
  { key: "14D", label: "최근 14일", range: (t) => ({ startDate: addDays(t, -13), endDate: t }) },
  { key: "28D", label: "최근 28일", range: (t) => ({ startDate: addDays(t, -27), endDate: t }) },
  { key: "30D", label: "최근 30일", range: (t) => ({ startDate: addDays(t, -29), endDate: t }) },
  { key: "THIS_WEEK", label: "이번 주", range: (t) => ({ startDate: startOfWeek(t), endDate: t }) },
  { key: "LAST_WEEK", label: "지난주", range: (t) => ({ startDate: addDays(startOfWeek(t), -7), endDate: addDays(startOfWeek(t), -1) }) },
  { key: "THIS_MONTH", label: "이번 달", range: (t) => ({ startDate: startOfMonth(t), endDate: t }) },
  {
    key: "LAST_MONTH",
    label: "지난달",
    range: (t) => {
      const lastEnd = addDays(startOfMonth(t), -1);
      return { startDate: startOfMonth(lastEnd), endDate: lastEnd };
    },
  },
];

/** 서버가 아는 기간 종류로 환산(그 외는 CUSTOM). 숫자 정의가 같은 것만 매핑한다. */
export function toServerPreset(key: string): "TODAY" | "7D" | "30D" | "CUSTOM" {
  if (key === "TODAY" || key === "7D" || key === "30D") return key;
  return "CUSTOM";
}

const RECENT_KEY = "pb.dateRange.recent";
type RecentItem = { startDate: string; endDate: string; label: string };

function loadRecent(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? (raw.filter((r) => r?.startDate && r?.endDate).slice(0, 4) as RecentItem[]) : [];
  } catch {
    return [];
  }
}
function saveRecent(item: RecentItem) {
  if (typeof window === "undefined") return;
  try {
    const list = loadRecent().filter((r) => !(r.startDate === item.startDate && r.endDate === item.endDate));
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...list].slice(0, 4)));
  } catch {
    /* 저장 실패는 무시 — 기능에 영향 없음 */
  }
}

function MonthGrid({
  year,
  month, // 1-12
  today,
  start,
  end,
  hover,
  onPick,
  onHover,
}: {
  year: number;
  month: number;
  today: string;
  start: string | null;
  end: string | null;
  hover: string | null;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
}) {
  const first = `${year}-${pad(month)}-01`;
  const lead = dowMon0(first);
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // 앞쪽 빈칸 + 실제 날짜. 6주 그리드까지 가지 않고 필요한 만큼만 그린다.
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: total }, (_, i) => `${year}-${pad(month)}-${pad(i + 1)}`)];

  // 아직 종료일을 안 고른 상태에서는 마우스 위치까지를 미리 칠해준다.
  const previewEnd = end ?? (start && hover && hover >= start ? hover : null);

  return (
    <div className="pb-drp-month">
      <div className="pb-drp-dow">
        {["월", "화", "수", "목", "금", "토", "일"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="pb-drp-grid">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} className="pb-drp-cell empty" />;
          const future = d > today;
          const isStart = !!start && d === start;
          const isEnd = !!previewEnd && d === previewEnd;
          const inRange = !!start && !!previewEnd && d > start && d < previewEnd;
          const cls = [
            "pb-drp-cell",
            future ? "disabled" : "",
            isStart || isEnd ? "edge" : "",
            inRange ? "inrange" : "",
            isStart && isEnd ? "single" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button
              key={d}
              type="button"
              className={cls}
              disabled={future}
              onClick={() => onPick(d)}
              onMouseEnter={() => onHover(d)}
              aria-label={fmtKo(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({
  startDate,
  endDate,
  onApply,
  disabled,
  align = "right",
}: {
  startDate: string;
  endDate: string;
  onApply: (range: DateRange, presetKey: string) => void;
  disabled?: boolean;
  align?: "left" | "right";
}) {
  const today = useMemo(() => kstToday(), []);
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState<string | null>(startDate);
  const [draftEnd, setDraftEnd] = useState<string | null>(endDate);
  const [hover, setHover] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  // 왼쪽 달력이 보여줄 달(오른쪽은 그 다음 달)
  const [viewYear, setViewYear] = useState(Number(endDate.slice(0, 4)));
  const [viewMonth, setViewMonth] = useState(Number(endDate.slice(5, 7)));
  const rootRef = useRef<HTMLDivElement>(null);

  // 열 때마다 현재 적용값으로 초기화 — 취소하면 아무것도 안 바뀌게.
  const reset = useCallback(() => {
    setDraftStart(startDate);
    setDraftEnd(endDate);
    setHover(null);
    setViewYear(Number(endDate.slice(0, 4)));
    setViewMonth(Number(endDate.slice(5, 7)));
  }, [startDate, endDate]);

  useEffect(() => {
    if (!open) return;
    setRecent(loadRecent());
    reset();
  }, [open, reset]);

  // 바깥 클릭 / Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 지금 적용돼 있는 기간이 어떤 프리셋과 같은지 되짚어 표시(새로고침해도 선택이 유지된다).
  const activePreset = useMemo(() => {
    const hit = PRESETS.find((p) => {
      const r = p.range(today);
      return r.startDate === draftStart && r.endDate === draftEnd;
    });
    return hit?.key ?? "CUSTOM";
  }, [draftStart, draftEnd, today]);

  function pickDay(d: string) {
    // 시작만 정해진 상태에서 그 이후를 고르면 종료일. 그 외에는 새 시작일.
    if (draftStart && !draftEnd && d >= draftStart) {
      setDraftEnd(d);
      return;
    }
    setDraftStart(d);
    setDraftEnd(null);
    setHover(null);
  }

  function applyPreset(p: Preset) {
    const r = p.range(today);
    setDraftStart(r.startDate);
    setDraftEnd(r.endDate);
    setViewYear(Number(r.endDate.slice(0, 4)));
    setViewMonth(Number(r.endDate.slice(5, 7)));
  }

  function shiftMonth(delta: number) {
    const t = Date.UTC(viewYear, viewMonth - 1 + delta, 1);
    setViewYear(new Date(t).getUTCFullYear());
    setViewMonth(new Date(t).getUTCMonth() + 1);
  }

  function commit() {
    if (!draftStart) return;
    const range: DateRange = { startDate: draftStart, endDate: draftEnd ?? draftStart };
    const label = PRESETS.find((p) => p.key === activePreset)?.label ?? `${fmtKo(range.startDate)}~${fmtKo(range.endDate)}`;
    saveRecent({ ...range, label });
    setOpen(false);
    onApply(range, activePreset);
  }

  const rightMonthT = Date.UTC(viewYear, viewMonth, 1);
  const rightYear = new Date(rightMonthT).getUTCFullYear();
  const rightMonth = new Date(rightMonthT).getUTCMonth() + 1;
  const canGoNext = `${rightYear}-${pad(rightMonth)}-01` <= startOfMonth(today);

  const triggerLabel = startDate === endDate ? fmtKo(startDate) : `${fmtKo(startDate)}~${fmtKo(endDate)}`;
  const years = useMemo(() => {
    const now = Number(today.slice(0, 4));
    return Array.from({ length: 6 }, (_, i) => now - 4 + i);
  }, [today]);

  return (
    <div className={`pb-drp ${align === "left" ? "align-left" : ""}`} ref={rootRef}>
      <button type="button" className="pb-drp-trigger" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-haspopup="dialog" aria-expanded={open}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M8 3v4M16 3v4M3 10h18" />
        </svg>
        <span>{triggerLabel}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="pb-drp-pop" role="dialog" aria-label="기간 선택">
          <div className="pb-drp-body">
            <div className="pb-drp-presets">
              {recent.length ? (
                <>
                  <p className="pb-drp-presets-title">최근에 사용한 기간</p>
                  {recent.map((r) => (
                    <button
                      key={`${r.startDate}_${r.endDate}`}
                      type="button"
                      className={`pb-drp-preset ${draftStart === r.startDate && draftEnd === r.endDate ? "active" : ""}`}
                      onClick={() => {
                        setDraftStart(r.startDate);
                        setDraftEnd(r.endDate);
                        setViewYear(Number(r.endDate.slice(0, 4)));
                        setViewMonth(Number(r.endDate.slice(5, 7)));
                      }}
                    >
                      <span className="pb-drp-radio" aria-hidden="true" />
                      {r.label}
                    </button>
                  ))}
                  <div className="pb-drp-presets-sep" />
                </>
              ) : null}
              {PRESETS.map((p) => (
                <button key={p.key} type="button" className={`pb-drp-preset ${activePreset === p.key ? "active" : ""}`} onClick={() => applyPreset(p)}>
                  <span className="pb-drp-radio" aria-hidden="true" />
                  {p.label}
                </button>
              ))}
            </div>

            <div className="pb-drp-cal">
              <div className="pb-drp-cal-head">
                <button type="button" className="pb-drp-nav" onClick={() => shiftMonth(-1)} aria-label="이전 달">
                  ‹
                </button>
                <div className="pb-drp-cal-titles">
                  <div className="pb-drp-selects">
                    <select value={viewMonth} onChange={(e) => setViewMonth(Number(e.target.value))} aria-label="월 선택">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <option key={m} value={m}>{`${m}월`}</option>
                      ))}
                    </select>
                    <select value={viewYear} onChange={(e) => setViewYear(Number(e.target.value))} aria-label="연도 선택">
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pb-drp-selects pb-drp-selects-right">
                    <span>{`${rightMonth}월`}</span>
                    <span>{rightYear}</span>
                  </div>
                </div>
                <button type="button" className="pb-drp-nav" onClick={() => shiftMonth(1)} disabled={!canGoNext} aria-label="다음 달">
                  ›
                </button>
              </div>

              <div className="pb-drp-months" onMouseLeave={() => setHover(null)}>
                <MonthGrid year={viewYear} month={viewMonth} today={today} start={draftStart} end={draftEnd} hover={hover} onPick={pickDay} onHover={setHover} />
                <MonthGrid year={rightYear} month={rightMonth} today={today} start={draftStart} end={draftEnd} hover={hover} onPick={pickDay} onHover={setHover} />
              </div>

              <div className="pb-drp-selected">
                <span>{draftStart ? fmtKo(draftStart) : "시작일 선택"}</span>
                <em>–</em>
                <span>{draftEnd ? fmtKo(draftEnd) : draftStart ? "종료일 선택" : ""}</span>
              </div>
            </div>
          </div>

          <div className="pb-drp-foot">
            <p>날짜는 서울 시간 기준으로 표시됩니다</p>
            <div className="pb-drp-foot-actions">
              <button type="button" className="pb-drp-btn" onClick={() => setOpen(false)}>
                취소
              </button>
              <button type="button" className="pb-drp-btn primary" onClick={commit} disabled={!draftStart}>
                업데이트
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
