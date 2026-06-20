"""Supabase(Postgres) 저장소. 클라우드 모드(run_cloud)에서 사용.

- 타겟 목록은 am_targets 에서 읽는다 (대시보드에서 추가한 업체).
- 광고는 am_ads 에 library_id 기준 upsert 로 누적한다.
- 접근은 service_role 키 사용(RLS 우회). 절대 클라이언트에 노출 금지.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from supabase import Client, create_client

from . import media


def get_client() -> Client:
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 필요합니다 "
            "(.env 또는 GitHub Actions secrets)."
        )
    return create_client(url, key)


def fetch_enabled_targets(client: Client) -> list[dict]:
    res = client.table("am_targets").select("*").eq("enabled", True).execute()
    return res.data or []


def fetch_target(client: Client, target_id: str) -> dict | None:
    """단일 브랜드(즉시 크롤용). enabled 여부와 무관하게 id 로 조회."""
    res = client.table("am_targets").select("*").eq("id", target_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def fetch_ad_counts(client: Client) -> dict[str, int]:
    """브랜드(target_id)별 현재 누적 광고 수. PostgREST 기본 상한(보통 1000행)을
    .range() 페이지네이션으로 넘겨 정확히 센다."""
    counts: dict[str, int] = {}
    page = 1000
    frm = 0
    while True:
        res = client.table("am_ads").select("target_id").range(frm, frm + page - 1).execute()
        rows = res.data or []
        for r in rows:
            tid = r.get("target_id")
            if tid:
                counts[tid] = counts.get(tid, 0) + 1
        if len(rows) < page:
            break
        frm += page
    return counts


def save_ads(client: Client, target: dict, ads: list[dict]) -> tuple[int, int]:
    """반환: (신규 개수, 추출 총 개수). first_seen_at 은 신규일 때만 기록되도록
    payload 에서 제외 → 기존 광고는 last_seen_at 만 갱신됨."""
    scraped_ids = [a["library_id"] for a in ads if a.get("library_id")]
    if not scraped_ids:
        return 0, 0

    # 기존 행(이미 보관된 미디어 보존 + 중복 다운로드 방지)
    res = (
        client.table("am_ads")
        .select("library_id, media_url, media_urls, poster_url, frames, media_path, downloaded")
        .in_("library_id", scraped_ids)
        .execute()
    )
    existing_map = {r["library_id"]: r for r in (res.data or [])}
    existing = set(existing_map.keys())

    now = datetime.now(timezone.utc).isoformat()
    payload = []
    for a in ads:
        lib = a.get("library_id")
        if not lib:
            continue
        ex = existing_map.get(lib)
        if ex and ex.get("downloaded"):
            # 이미 우리 스토리지에 보관됨 → 재다운로드 X, 저장된 영구 미디어 그대로 유지
            media_fields = {
                "media_url": ex.get("media_url"),
                "media_urls": ex.get("media_urls"),
                "poster_url": ex.get("poster_url"),
                "frames": ex.get("frames"),
                "media_path": ex.get("media_path"),
                "downloaded": True,
            }
        else:
            # 신규(또는 아직 미보관) → 파일 다운로드해 스토리지에 보관(실패 시 CDN URL 유지)
            media.ensure_media(client, a)
            media_fields = {
                "media_url": a.get("media_url"),
                "media_urls": a.get("media_urls"),
                "poster_url": a.get("poster_url"),
                "frames": a.get("frames"),
                "media_path": a.get("media_path"),
                "downloaded": bool(a.get("downloaded")),
            }
        payload.append(
            {
                "library_id": lib,
                "target_id": target.get("id"),
                "page_name": a.get("page_name"),
                "started_on": a.get("started_on"),
                "ad_text": a.get("ad_text"),
                "media_type": a.get("media_type"),
                "landing_url": a.get("landing_url"),
                "status": "active",
                "ended_at": None,
                "last_seen_at": now,
                **media_fields,
            }
        )
    client.table("am_ads").upsert(payload, on_conflict="library_id").execute()

    # ⚠️ '종료' 표기는 여기서 하지 않는다.
    #   메타가 headless 크롤에 광고를 매번 다른 부분집합(30~40개)만 내주기 때문에,
    #   "이번에 안 보임=종료"로 찍으면 멀쩡한 광고가 오종료된다(부분 수집 오탐).
    #   대신 run_cloud 가 정기(전체) 크롤 끝에 sweep_stale_ended() 로
    #   "오래(기본 12일) 안 보인" 광고만 종료 처리한다. last_seen_at 은 매 크롤 갱신됨.

    new = len(set(scraped_ids) - existing)
    return new, len(scraped_ids)


def sweep_stale_ended(client: Client, days: int = 12) -> int:
    """오래(기본 12일) 안 보인 active 광고만 '종료'로 표기. 부분 수집 오탐 방지용.
    매 크롤에서 본 광고는 last_seen_at 이 갱신되므로, 진짜 사라진 광고만 점차 종료된다."""
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    now = datetime.now(timezone.utc).isoformat()
    try:
        res = (
            client.table("am_ads")
            .update({"status": "ended", "ended_at": now})
            .eq("status", "active")
            .lt("last_seen_at", cutoff)
            .execute()
        )
        return len(res.data or [])
    except Exception as e:
        print(f"  종료 스윕 건너뜀: {e}")
        return 0


def record_health(client: Client, target_id: str, count: int, status: str) -> None:
    client.table("am_health_checks").insert(
        {"target_id": target_id, "extracted_count": count, "status": status}
    ).execute()
