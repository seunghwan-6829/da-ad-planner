import { NextResponse } from "next/server";
import { getWorkspaceData } from "@/lib/pb/home-data";
import { supabaseAdmin } from "@/lib/supabase-admin";

type CreateSitePayload = {
  url?: string;
};

type ExistingSiteRow = {
  id: string;
  name: string;
  url: string | null;
  logo_url: string | null;
  tracking_verified: boolean | null;
  tracking_checked_at: string | null;
  last_tested_at: string | null;
  trashed_at: string | null;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeProjectUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  url.hostname = url.hostname.replace(/^www\./, "").toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function buildStableSiteId(value: string) {
  const normalized = normalizeProjectUrl(value);
  const parsed = new URL(normalized);
  const basis = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
  let hash = 0;
  for (const char of basis) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hashSuffix = hash.toString(36).slice(0, 6);
  return `${slugify(basis) || "site"}_${hashSuffix}`.slice(0, 56);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start") ?? undefined;
  const end = searchParams.get("end") ?? undefined;
  const preset = searchParams.get("preset");
  const data = await getWorkspaceData(true, start, end, preset);
  return NextResponse.json({ ok: true, ...data });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as CreateSitePayload | null;

  if (!payload?.url?.trim()) {
    return NextResponse.json({ ok: false, error: "사이트 URL을 입력해주세요." }, { status: 400 });
  }

  if (!isValidUrl(payload.url.trim())) {
    return NextResponse.json({ ok: false, error: "올바른 URL 형식으로 입력해주세요." }, { status: 400 });
  }

  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const normalizedUrl = normalizeProjectUrl(payload.url);
  const parsedUrl = new URL(normalizedUrl);
  const hostname = parsedUrl.hostname.replace(/^www\./, "");
  const id = buildStableSiteId(normalizedUrl);

  const { data: duplicated } = await supabase.from("pb_sites").select("*").eq("url", normalizedUrl);
  const existingSite = ((duplicated as ExistingSiteRow[] | null) ?? [])[0];

  if (existingSite && !existingSite.trashed_at) {
    return NextResponse.json({ ok: false, error: "이미 등록된 프로젝트입니다." }, { status: 409 });
  }

  if (existingSite?.trashed_at) {
    const { data, error } = await supabase
      .from("pb_sites")
      .update({
        name: hostname,
        url: normalizedUrl,
        logo_url: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
        tracking_verified: false,
        tracking_checked_at: null,
        last_tested_at: null,
        trashed_at: null
      })
      .eq("id", existingSite.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: error?.message ?? "휴지통 프로젝트를 복구하지 못했습니다." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, site: data, restored: true });
  }

  const { data, error } = await supabase
    .from("pb_sites")
    .insert({
      id,
      name: hostname,
      url: normalizedUrl,
      logo_url: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
      tracking_verified: false,
      tracking_checked_at: null,
      last_tested_at: null,
      trashed_at: null
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message?.includes("head_code")
          ? "Supabase sites 테이블에 예전 스키마가 남아 있습니다. 페이지를 새로고침한 뒤 다시 시도해주세요."
          : error?.message ?? "프로젝트를 등록하지 못했습니다."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, site: data });
}
