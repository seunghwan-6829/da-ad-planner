import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidUrl } from '@/lib/validate/url'

type SiteActionPayload = {
  action?: "settings" | "trash" | "restore" | "delete_permanently" | "verify_head" | "test_view";
  name?: string;
  url?: string;
};

type SiteRow = {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
  tracking_verified: boolean | null;
  tracking_checked_at: string | null;
  last_tested_at: string | null;
  trashed_at: string | null;
};


function normalizeProjectUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function buildPath(urlValue: string) {
  try {
    const url = new URL(urlValue);
    return `${url.pathname || "/"}${url.search || ""}`;
  } catch {
    return "/";
  }
}

function extractSiteIdCandidates(html: string) {
  const candidates = new Set<string>();
  const siteIdRegex = /PULSEBOARD_SITE_ID\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(siteIdRegex)) {
    if (match[1]) candidates.add(match[1]);
  }
  return [...candidates];
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const payload = (await request.json().catch(() => null)) as SiteActionPayload | null;
  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const { data: site, error: siteError } = await supabase.from("pb_sites").select("*").eq("id", id).single();

  if (siteError || !site) {
    return NextResponse.json({ ok: false, error: siteError?.message ?? "프로젝트를 찾을 수 없습니다." }, { status: 404 });
  }

  const currentSite = site as SiteRow;

  if (payload?.action === "settings") {
    if (!payload.name?.trim() || !payload.url?.trim() || !isValidUrl(payload.url.trim())) {
      return NextResponse.json({ ok: false, error: "프로젝트 이름과 URL을 올바르게 입력해주세요." }, { status: 400 });
    }

    const normalizedUrl = normalizeProjectUrl(payload.url);
    const domain = new URL(normalizedUrl).hostname.replace(/^www\./, "");
    const { error } = await supabase
      .from("pb_sites")
      .update({
        name: payload.name.trim(),
        url: normalizedUrl,
        logo_url: `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
      })
      .eq("id", id);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  if (payload?.action === "trash") {
    const { error } = await supabase.from("pb_sites").update({ trashed_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload?.action === "restore") {
    const { error } = await supabase.from("pb_sites").update({ trashed_at: null }).eq("id", id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload?.action === "delete_permanently") {
    const { error } = await supabase.from("pb_sites").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (payload?.action === "verify_head") {
    if (!currentSite.url) {
      return NextResponse.json({ ok: false, error: "사이트 URL이 설정되지 않았습니다." }, { status: 400 });
    }

    try {
      const response = await fetch(currentSite.url, {
        headers: { "User-Agent": "PulseboardBot/1.0" },
        cache: "no-store"
      });
      const html = await response.text();
      const normalizedHtml = html.replace(/\s+/g, " ");
      const detectedSiteIds = extractSiteIdCandidates(normalizedHtml);
      const hasPulseboardSignature =
        /tracker\.js/i.test(normalizedHtml) ||
        /\/api\/collect/i.test(normalizedHtml) ||
        /PULSEBOARD_ENDPOINT/i.test(normalizedHtml) ||
        /pulseboard-analytics-livid\.vercel\.app/i.test(normalizedHtml);

      const exactSiteIdMatched = detectedSiteIds.includes(currentSite.id);
      const mismatchSiteId = detectedSiteIds.find((candidate) => candidate !== currentSite.id) ?? null;

      const recentSignalSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recentEvents } = await supabase
        .from("pb_analytics_events")
        .select("id", { count: "exact", head: false })
        .eq("site_id", id)
        .gte("created_at", recentSignalSince)
        .neq("referrer", "manual_test")
        .limit(1);

      const hasRecentSignals = Boolean(recentEvents?.length);
      const matched = (hasPulseboardSignature && exactSiteIdMatched) || hasRecentSignals;

      const { error } = await supabase
        .from("pb_sites")
        .update({
          tracking_verified: matched,
          tracking_checked_at: new Date().toISOString()
        })
        .eq("id", id);

      if (error) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }

      const reason = matched
        ? hasRecentSignals && !exactSiteIdMatched
          ? "signal_verified"
          : "head_verified"
        : mismatchSiteId
          ? "site_id_mismatch"
          : hasPulseboardSignature
            ? "site_id_missing"
            : "script_missing";

      return NextResponse.json({
        ok: true,
        matched,
        reason,
        detectedSiteId: mismatchSiteId,
        expectedSiteId: currentSite.id
      });
    } catch {
      return NextResponse.json({ ok: false, error: "외부 사이트를 확인하지 못했습니다." }, { status: 502 });
    }
  }

  if (payload?.action === "test_view") {
    if (!currentSite.url) {
      return NextResponse.json({ ok: false, error: "사이트 URL이 설정되지 않았습니다." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { error: eventError } = await supabase.from("pb_analytics_events").insert({
      site_id: id,
      session_id: `manual_session_${id}`,
      visitor_id: `manual_visitor_${id}`,
      event_type: "page_view",
      url: currentSite.url,
      path: buildPath(currentSite.url),
      referrer: "manual_test",
      device_type: "desktop",
      ip_address: `manual-test-${id}`,
      metadata: { source: "manual-test" },
      created_at: now
    });

    if (eventError) {
      return NextResponse.json({ ok: false, error: eventError.message }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("pb_sites")
      .update({ last_tested_at: now })
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: "지원하지 않는 작업입니다." }, { status: 400 });
}
