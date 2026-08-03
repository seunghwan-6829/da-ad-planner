import { ReplayListClient } from "@/components/pb/ReplayListClient";

// 세션 리플레이 — 방문자 화면을 영상처럼 재생. /data-tracking/* 라 middleware(데이터 추적 권한)가 서버에서 지킨다.
export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

export default async function ReplaysPage({ searchParams }: Props) {
  const resolved = (await searchParams) ?? {};
  const project = typeof resolved.project === "string" ? resolved.project : undefined;
  return <ReplayListClient initialSite={project} />;
}
