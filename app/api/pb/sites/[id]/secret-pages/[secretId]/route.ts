import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidUrl } from '@/lib/validate/url'

type SecretPagePayload = {
  name?: string;
  url?: string;
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

function normalizePageKeyFromUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname !== "/" ? url.pathname.replace(/\/+$/, "") : "/";
    const preserved = new URLSearchParams();
    for (const [key, rawValue] of url.searchParams.entries()) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey === "idx" ||
        normalizedKey === "id" ||
        normalizedKey === "page" ||
        normalizedKey === "tab" ||
        normalizedKey === "category" ||
        normalizedKey === "sort" ||
        normalizedKey === "type" ||
        normalizedKey === "q"
      ) {
        preserved.set(key, rawValue);
      }
    }
    const search = preserved.toString();
    return `${path}${search ? `?${search}` : ""}` || "/";
  } catch {
    return "/";
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string; secretId: string }> }) {
  const { id, secretId } = await context.params;
  const payload = (await request.json().catch(() => null)) as SecretPagePayload | null;
  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  if (!payload?.name?.trim() || !payload?.url?.trim()) {
    return NextResponse.json({ ok: false, error: "페이지 이름과 URL을 입력해주세요." }, { status: 400 });
  }

  if (!isValidUrl(payload.url)) {
    return NextResponse.json({ ok: false, error: "올바른 URL 형식으로 입력해주세요." }, { status: 400 });
  }

  const normalizedUrl = normalizeProjectUrl(payload.url);
  const pageKey = normalizePageKeyFromUrl(normalizedUrl);

  const { data, error } = await supabase
    .from("pb_secret_pages")
    .update({
      name: payload.name.trim(),
      url: normalizedUrl,
      page_key: pageKey,
      updated_at: new Date().toISOString()
    })
    .eq("id", secretId)
    .eq("site_id", id)
    .select("id,site_id,name,url,page_key,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string; secretId: string }> }) {
  const { id, secretId } = await context.params;
  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const { error } = await supabase
    .from("pb_secret_pages")
    .delete()
    .eq("id", secretId)
    .eq("site_id", id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
