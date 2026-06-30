import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type VerifyPayload = {
  siteId?: string;
  url: string;
  matchingType: string;
};

function matchesUrl(eventUrl: string, pageUrl: string, matchingType: string) {
  if (matchingType === "Exact Match") {
    return eventUrl === pageUrl;
  }

  if (matchingType === "Contains") {
    return eventUrl.includes(pageUrl);
  }

  return eventUrl.startsWith(pageUrl);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as VerifyPayload | null;
  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  if (!payload?.siteId || !payload?.url || !payload.matchingType) {
    return NextResponse.json({ ok: false, error: "트래킹 확인에 필요한 URL 정보가 없습니다." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("pb_analytics_events")
    .select("url,path,event_type,created_at")
    .eq("site_id", payload.siteId)
    .eq("event_type", "page_view")
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const matched = (data ?? []).filter((event) => {
    const eventUrl = event.url ?? event.path ?? "";
    return matchesUrl(eventUrl, payload.url, payload.matchingType);
  });

  const pv = matched.length;
  const trackingReady = pv > 0;
  const latestEventAt = matched[0]?.created_at ?? null;

  const { error: updateError } = await supabase
    .from("pb_managed_pages")
    .update({ tracking_ready: trackingReady, pv })
    .eq("id", Number(id));

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    trackingReady,
    pv,
    latestEventAt,
    message: trackingReady
      ? "최근 page_view 수집이 확인되었습니다."
      : "아직 page_view 수집이 확인되지 않았습니다."
  });
}
