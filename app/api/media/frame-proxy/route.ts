import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* 영상 프레임 캡처 폴백용 스트리밍 프록시.
   CORS 헤더가 없는 원본 CDN 영상을 같은 출처로 중계해 캔버스 캡처(오염 방지)가 가능하게 한다.
   Range 헤더를 그대로 전달하므로 캡처에 필요한 바이트만 오간다.
   영상 콘텐츠 타입만 통과 — 범용 프록시로 오남용되지 않게. */

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.includes(":")) return true; // localhost·IPv6
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IP 리터럴 전체 차단(내부망 SSRF 방지) — 영상 CDN은 항상 도메인
  return false;
}

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "잘못된 주소" }, { status: 400 });
  }
  if (target.protocol !== "https:" || isBlockedHost(target.hostname)) {
    return NextResponse.json({ error: "허용되지 않는 주소" }, { status: 400 });
  }

  const range = req.headers.get("range");
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      headers: {
        ...(range ? { range } : {}),
        "user-agent": req.headers.get("user-agent") ?? "Mozilla/5.0",
      },
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "원본 서버에 연결하지 못했어요" }, { status: 502 });
  }
  if (!(upstream.status === 200 || upstream.status === 206) || !upstream.body) {
    return NextResponse.json({ error: `원본 응답 ${upstream.status}` }, { status: 502 });
  }

  const type = upstream.headers.get("content-type") ?? "";
  if (!/^video\/|^application\/octet-stream/i.test(type)) {
    return NextResponse.json({ error: "영상이 아닌 콘텐츠" }, { status: 415 });
  }

  const headers = new Headers();
  for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(k);
    if (v) headers.set(k, v);
  }
  headers.set("cache-control", "private, max-age=300");
  return new Response(upstream.body, { status: upstream.status, headers });
}
