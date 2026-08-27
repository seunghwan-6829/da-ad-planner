import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isValidUrl } from '@/lib/validate/url'

type CreatePagePayload = {
  siteId: string;
  pageName: string;
  url: string;
  captureUrl?: string;
  matchingType: string;
  status: string;
  trackingReady?: boolean;
  loginRequired?: boolean;
  mobileOnly?: boolean;
  weeklyReport?: boolean;
  pv?: number;
  startDate?: string;
  endDate?: string;
  groupName?: string;
  note?: string;
};


export async function POST(request: Request) {
  const json = (await request.json().catch(() => null)) as CreatePagePayload | null;

  if (!json?.siteId || !json.pageName?.trim() || !json.url?.trim()) {
    return NextResponse.json({ ok: false, error: "사이트, 페이지명, URL은 필수입니다." }, { status: 400 });
  }

  if (!isValidUrl(json.url) || (json.captureUrl && !isValidUrl(json.captureUrl))) {
    return NextResponse.json({ ok: false, error: "올바른 URL 형식으로 입력해주세요." }, { status: 400 });
  }

  const supabase = supabaseAdmin;

  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase가 연결되지 않았습니다." }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("pb_managed_pages")
    .insert({
      site_id: json.siteId,
      page_name: json.pageName.trim(),
      url: json.url.trim(),
      capture_url: json.captureUrl?.trim() || json.url.trim(),
      matching_type: json.matchingType || "Starts Match",
      status: json.status || "진행 중",
      tracking_ready: json.trackingReady ?? false,
      login_required: json.loginRequired ?? false,
      mobile_only: json.mobileOnly ?? false,
      weekly_report: json.weeklyReport ?? false,
      pv: json.pv ?? 0,
      start_date: json.startDate || new Date().toISOString().slice(0, 10),
      end_date: json.endDate && json.endDate !== "종료 없음" ? json.endDate : null,
      group_name: json.groupName?.trim() || "기본 그룹",
      note: json.note?.trim() || ""
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "페이지를 생성하지 못했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    page: {
      id: data.id,
      siteId: data.site_id,
      pageName: data.page_name,
      url: data.url,
      captureUrl: data.capture_url ?? data.url,
      matchingType: data.matching_type,
      status: data.status,
      trackingReady: data.tracking_ready,
      loginRequired: data.login_required,
      mobileOnly: data.mobile_only,
      weeklyReport: data.weekly_report,
      pv: data.pv,
      startDate: data.start_date ?? "-",
      endDate: data.end_date ?? "종료 없음",
      groupName: data.group_name ?? "기본 그룹",
      note: data.note ?? ""
    }
  });
}
