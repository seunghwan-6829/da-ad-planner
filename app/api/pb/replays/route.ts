import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/* 세션 리플레이 조회(보호 라우트 — middleware 가 로그인/권한 검사).
   GET ?site=<id>            → 최근 리플레이 목록(메타만, 가벼움) + 사이트 이름 맵
   GET ?id=<replayId>        → 재생용 전체 이벤트(청크 seq 순 연결)
   ⚠️ 수집(/api/pb/replay)은 익명 공개지만, 이 읽기 라우트는 예외 목록에 없어 서버가 막는다. */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const site = searchParams.get("site");

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

  let q = supabaseAdmin
    .from("pb_replays")
    .select("id, site_id, path, device_type, duration_ms, event_count, chunk_count, created_at")
    .order("created_at", { ascending: false })
    .limit(120);
  if (site) q = q.eq("site_id", site);
  const { data: rows, error } = await q;
  if (error) {
    // 테이블 미생성(마이그레이션 전) → 빈 목록 + 안내
    return NextResponse.json({ ok: true, replays: [], siteNames: {}, tableMissing: true });
  }

  const { data: sites } = await supabaseAdmin.from("pb_sites").select("id, name, url");
  const siteNames: Record<string, string> = {};
  for (const s of sites ?? []) siteNames[s.id] = s.name || s.url || s.id;

  return NextResponse.json({ ok: true, replays: rows ?? [], siteNames });
}
