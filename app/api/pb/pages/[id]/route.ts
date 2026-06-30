import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

type PagePayload = {
  id: number;
  siteId: string;
  pageName: string;
  url: string;
  captureUrl: string;
  matchingType: string;
  status: string;
  trackingReady: boolean;
  loginRequired: boolean;
  mobileOnly: boolean;
  weeklyReport: boolean;
  pv: number;
  startDate: string;
  endDate: string;
  groupName: string;
  note: string;
};

function isValidUrl(value: string) {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const json = (await request.json().catch(() => null)) as PagePayload | null;

  if (!json?.pageName?.trim() || !json.url?.trim()) {
    return NextResponse.json({ ok: false, error: "페이지명과 URL은 필수입니다." }, { status: 400 });
  }

  if (!isValidUrl(json.url) || !isValidUrl(json.captureUrl)) {
    return NextResponse.json({ ok: false, error: "올바른 URL 형식으로 입력해주세요." }, { status: 400 });
  }

  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const { error } = await supabase
    .from("pb_managed_pages")
    .update({
      site_id: json.siteId,
      page_name: json.pageName.trim(),
      url: json.url.trim(),
      capture_url: json.captureUrl.trim(),
      matching_type: json.matchingType,
      status: json.status,
      tracking_ready: json.trackingReady,
      login_required: json.loginRequired,
      mobile_only: json.mobileOnly,
      weekly_report: json.weeklyReport,
      pv: json.pv,
      start_date: json.startDate === "-" ? null : json.startDate,
      end_date: json.endDate === "종료 없음" ? null : json.endDate,
      group_name: json.groupName.trim() || "기본 그룹",
      note: json.note.trim()
    })
    .eq("id", Number(id));

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const { error } = await supabase.from("pb_managed_pages").delete().eq("id", Number(id));

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
