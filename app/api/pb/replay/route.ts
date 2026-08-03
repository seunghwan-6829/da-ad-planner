import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* 세션 리플레이 수집 — 고객사 사이트의 트래커(rrweb)가 화면 이벤트를 '청크'로 POST.
   /api/pb/collect 처럼 익명 공개 입구(CORS *, middleware 예외)여야 한다 — 방문자는 로그인이 없다.
   안전장치:
   - 쓰기(insert)만 있고 읽기는 전부 보호 라우트(/api/pb/replays)에 있다.
   - 청크당 이벤트 수·바이트 상한, 사이트당 하루 리플레이 개수 상한(초과 시 429 → 트래커가 녹화 중단).
   ⚠️ keepalive(64KB 제한) 때문에 트래커는 큰 청크를 세션 '도중'에 일반 fetch 로 보낸다. */

export const dynamic = "force-dynamic";

const MAX_EVENTS_PER_CHUNK = 1500;
const MAX_CHUNK_BYTES = 2_500_000; // ≈2.5MB (rrweb 첫 스냅샷이 큼)
const MAX_REPLAYS_PER_SITE_PER_DAY = 300;
const MAX_SEQ = 24;

type ReplayChunkPayload = {
  siteId: string;
  sessionId?: string;
  visitorId?: string;
  replayId: string;
  seq: number;
  path?: string;
  url?: string;
  deviceType?: string;
  durationMs?: number;
  events: unknown[];
};

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

function isPayload(v: unknown): v is ReplayChunkPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.siteId === "string" &&
    typeof p.replayId === "string" &&
    /^replay_[a-z0-9]{4,24}$/i.test(p.replayId as string) &&
    typeof p.seq === "number" &&
    Number.isInteger(p.seq) &&
    p.seq >= 0 &&
    Array.isArray(p.events)
  );
}

function kstTodayStartISO(): string {
  const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  return new Date(`${key}T00:00:00+09:00`).toISOString();
}

export async function POST(request: Request) {
  const raw = await request.text().catch(() => "");
  if (raw.length > MAX_CHUNK_BYTES) {
    return withCors(NextResponse.json({ ok: false, error: "chunk too large" }, { status: 413 }));
  }
  let json: unknown = null;
  try { json = JSON.parse(raw); } catch {}
  if (!isPayload(json)) {
    return withCors(NextResponse.json({ ok: false, error: "invalid replay payload" }, { status: 400 }));
  }
  const p = json;
  if (p.seq > MAX_SEQ || p.events.length > MAX_EVENTS_PER_CHUNK) {
    return withCors(NextResponse.json({ ok: false, error: "over limit" }, { status: 413 }));
  }

  const supabase = supabaseAdmin;
  if (!supabase) return withCors(NextResponse.json({ ok: true, stored: false }));

  // 등록된 사이트만 수집(쓰레기 site_id 로 무한 적재 방지)
  const { data: site } = await supabase.from("pb_sites").select("id").eq("id", p.siteId).maybeSingle();
  if (!site) return withCors(NextResponse.json({ ok: false, error: "unknown site" }, { status: 404 }));

  const { data: meta } = await supabase
    .from("pb_replays")
    .select("id, event_count, chunk_count")
    .eq("id", p.replayId)
    .maybeSingle();

  if (!meta) {
    // 새 리플레이 — 사이트당 하루 상한(트래커는 429를 받으면 녹화를 멈춘다)
    const { count } = await supabase
      .from("pb_replays")
      .select("id", { count: "exact", head: true })
      .eq("site_id", p.siteId)
      .gte("created_at", kstTodayStartISO());
    if ((count ?? 0) >= MAX_REPLAYS_PER_SITE_PER_DAY) {
      return withCors(NextResponse.json({ ok: false, error: "daily cap" }, { status: 429 }));
    }
    const { error: metaErr } = await supabase.from("pb_replays").insert({
      id: p.replayId,
      site_id: p.siteId,
      session_id: p.sessionId ?? null,
      visitor_id: p.visitorId ?? null,
      path: p.path ?? null,
      url: p.url ?? null,
      device_type: p.deviceType ?? null,
      duration_ms: Math.max(0, Math.round(p.durationMs ?? 0)),
      event_count: p.events.length,
      chunk_count: 1,
    });
    if (metaErr) return withCors(NextResponse.json({ ok: false, error: metaErr.message }, { status: 500 }));
  } else {
    await supabase
      .from("pb_replays")
      .update({
        duration_ms: Math.max(0, Math.round(p.durationMs ?? 0)),
        event_count: (meta.event_count ?? 0) + p.events.length,
        chunk_count: Math.max((meta.chunk_count ?? 0), p.seq + 1),
      })
      .eq("id", p.replayId);
  }

  const { error: chunkErr } = await supabase
    .from("pb_replay_chunks")
    .upsert({ replay_id: p.replayId, seq: p.seq, events: p.events }, { onConflict: "replay_id,seq" });
  if (chunkErr) return withCors(NextResponse.json({ ok: false, error: chunkErr.message }, { status: 500 }));

  return withCors(NextResponse.json({ ok: true, stored: true }));
}
