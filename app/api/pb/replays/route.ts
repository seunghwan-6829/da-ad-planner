import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* 세션 리플레이 조회(보호 라우트 — middleware 가 로그인/권한 검사).
   GET ?site=<id>      → 세션(방문) 단위로 묶은 목록: 방문자(몇 번째 방문)·유입 경로·페이지 여정·기기·총 길이
   GET ?id=<replayId>  → 재생용 전체 이벤트(청크 seq 순 연결)
   DELETE ?session=<sessionKey> → 그 방문의 리플레이 전부 삭제(청크 포함)

   유입 경로: 트래커 수정 없이 만든다 —
     · UTM 은 리플레이의 url 쿼리에서 직접 파싱(utm_source/medium)
     · 없으면 같은 session_id 의 첫 page_view 이벤트(pb_analytics_events)의 referrer 로 판별
   방문자 '몇 번째 방문': pb_replays 전체에서 그 방문자의 세션 순번(작은 볼륨이라 집계 저렴). */

export const dynamic = "force-dynamic";

const REF_LABELS: [RegExp, string][] = [
  [/naver/i, "네이버"],
  [/google/i, "구글"],
  [/instagram/i, "인스타그램"],
  [/facebook|fb\.me|meta\./i, "페이스북"],
  [/youtube|youtu\.be/i, "유튜브"],
  [/kakao/i, "카카오"],
  [/daum/i, "다음"],
];

function refLabel(referrer: string | null | undefined): string | null {
  const r = String(referrer || "").trim();
  if (!r || r === "direct" || r === "manual_test") return null;
  let host = r;
  try { host = new URL(r).hostname.replace(/^www\./, ""); } catch {}
  for (const [re, label] of REF_LABELS) if (re.test(host)) return label;
  return host || null;
}

function sourceFromUrl(url: string | null | undefined): { label: string; kind: "utm" | "ref" | "direct" } | null {
  try {
    const u = new URL(String(url || ""));
    const s = u.searchParams.get("utm_source");
    if (s) {
      const m = u.searchParams.get("utm_medium");
      return { label: `${s}${m ? `/${m}` : ""}`, kind: "utm" };
    }
  } catch {}
  return null;
}

type ReplayRow = {
  id: string;
  site_id: string;
  session_id: string | null;
  visitor_id: string | null;
  path: string | null;
  url: string | null;
  device_type: string | null;
  duration_ms: number | null;
  event_count: number | null;
  created_at: string;
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const site = searchParams.get("site");

  // ── 재생용 상세(이벤트 전체) ──
  if (id) {
    const { data: meta } = await supabaseAdmin.from("pb_replays").select("*").eq("id", id).maybeSingle();
    if (!meta) return NextResponse.json({ ok: false, error: "리플레이를 찾을 수 없어요." }, { status: 404 });
    const { data: chunks, error } = await supabaseAdmin
      .from("pb_replay_chunks")
      .select("seq, events")
      .eq("replay_id", id)
      .order("seq", { ascending: true });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    const events = (chunks ?? []).flatMap((c) => (Array.isArray(c.events) ? c.events : []));
    return NextResponse.json({ ok: true, meta, events });
  }

  // ── 목록: 세션(방문) 단위 그룹 ──
  let q = supabaseAdmin
    .from("pb_replays")
    .select("id, site_id, session_id, visitor_id, path, url, device_type, duration_ms, event_count, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  if (site) q = q.eq("site_id", site);
  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ ok: true, sessions: [], siteNames: {}, tableMissing: true });
  }

  const replays = (rows ?? []) as ReplayRow[];

  // 같은 세션의 첫 page_view 이벤트에서 referrer 를 가져온다(트래커 무수정 유입 판별).
  const sessionIds = [...new Set(replays.map((r) => r.session_id).filter(Boolean))] as string[];
  const refBySession = new Map<string, string | null>();
  if (sessionIds.length) {
    const { data: events } = await supabaseAdmin
      .from("pb_analytics_events")
      .select("session_id, referrer, created_at")
      .in("session_id", sessionIds)
      .eq("event_type", "page_view")
      .order("created_at", { ascending: true })
      .limit(2000);
    for (const ev of events ?? []) {
      const sid = (ev as { session_id: string }).session_id;
      if (!refBySession.has(sid)) refBySession.set(sid, (ev as { referrer: string | null }).referrer ?? null);
    }
  }

  /* 방문자별 '몇 번째 방문' — pb_replays 전체(사이트 무관 아님: 같은 필터 기준)를 가볍게 훑어
     방문자의 세션들을 시간순 정렬 → 이 세션이 몇 번째인지. 볼륨이 작아 한 번의 select 로 충분. */
  const visitorSeq = new Map<string, string[]>(); // visitor_id → 시간순 session_id 목록
  {
    let vq = supabaseAdmin
      .from("pb_replays")
      .select("visitor_id, session_id, created_at")
      .order("created_at", { ascending: true })
      .limit(3000);
    if (site) vq = vq.eq("site_id", site);
    const { data: all } = await vq;
    for (const r of all ?? []) {
      const v = (r as { visitor_id: string | null }).visitor_id;
      const s = (r as { session_id: string | null }).session_id;
      if (!v || !s) continue;
      const list = visitorSeq.get(v) ?? [];
      if (!list.includes(s)) list.push(s);
      visitorSeq.set(v, list);
    }
  }

  // 세션으로 그룹 — 페이지 여정(시간순), 총 길이, 유입 라벨, 방문 순번.
  type SessionOut = {
    session_key: string;
    site_id: string;
    visitor_id: string | null;
    visit_no: number;
    visit_total: number;
    source_label: string;
    source_kind: "utm" | "ref" | "direct";
    device_type: string | null;
    started_at: string;
    total_duration_ms: number;
    pages: { replay_id: string; path: string; duration_ms: number; created_at: string }[];
  };
  const bySession = new Map<string, SessionOut>();
  for (const r of [...replays].reverse()) { // 오래된 것부터 넣어 여정이 시간순이 되게
    const key = r.session_id || r.id;
    let s = bySession.get(key);
    if (!s) {
      const utm = sourceFromUrl(r.url);
      const ref = refLabel(r.session_id ? refBySession.get(r.session_id) : null);
      const seq = r.visitor_id ? (visitorSeq.get(r.visitor_id) ?? []) : [];
      const no = r.session_id ? seq.indexOf(r.session_id) + 1 : 0;
      s = {
        session_key: key,
        site_id: r.site_id,
        visitor_id: r.visitor_id,
        visit_no: no > 0 ? no : 1,
        visit_total: Math.max(seq.length, 1),
        source_label: utm ? utm.label : ref ?? "직접 유입",
        source_kind: utm ? "utm" : ref ? "ref" : "direct",
        device_type: r.device_type,
        started_at: r.created_at,
        total_duration_ms: 0,
        pages: [],
      };
      bySession.set(key, s);
    }
    s.total_duration_ms += Math.max(0, r.duration_ms || 0);
    s.pages.push({ replay_id: r.id, path: r.path || "/", duration_ms: r.duration_ms || 0, created_at: r.created_at });
  }
  const sessions = [...bySession.values()].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

  const { data: sites } = await supabaseAdmin.from("pb_sites").select("id, name, url");
  const siteNames: Record<string, string> = {};
  for (const s of sites ?? []) siteNames[s.id] = s.name || s.url || s.id;

  return NextResponse.json({ ok: true, sessions, siteNames });
}

// 세션(방문) 단위 삭제 — 그 방문의 리플레이·청크를 전부 지운다(목록 정리용).
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionKey = searchParams.get("session");
  if (!sessionKey) return NextResponse.json({ ok: false, error: "session 필요" }, { status: 400 });

  // session_id 매칭이 기본, (아주 예전 데이터로) session_id 없는 단건은 id 로도 매칭.
  const { data: metas } = await supabaseAdmin
    .from("pb_replays")
    .select("id")
    .or(`session_id.eq.${sessionKey},id.eq.${sessionKey}`);
  const ids = (metas ?? []).map((m) => (m as { id: string }).id);
  if (!ids.length) return NextResponse.json({ ok: true, deleted: 0 });

  await supabaseAdmin.from("pb_replay_chunks").delete().in("replay_id", ids);
  const { error } = await supabaseAdmin.from("pb_replays").delete().in("id", ids);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deleted: ids.length });
}
