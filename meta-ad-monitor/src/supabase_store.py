"""Supabase(Postgres) 저장소. 클라우드 모드(run_cloud)에서 사용.

- 타겟 목록은 am_targets 에서 읽는다 (대시보드에서 추가한 업체).
- 광고는 am_ads 에 library_id 기준 upsert 로 누적한다.
- 접근은 service_role 키 사용(RLS 우회). 절대 클라이언트에 노출 금지.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from supabase import Client, create_client


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


def save_ads(client: Client, target: dict, ads: list[dict]) -> tuple[int, int]:
    """반환: (신규 개수, 추출 총 개수). first_seen_at 은 신규일 때만 기록되도록
    payload 에서 제외 → 기존 광고는 last_seen_at 만 갱신됨."""
    scraped_ids = [a["library_id"] for a in ads if a.get("library_id")]
    if not scraped_ids:
        return 0, 0

    existing: set[str] = set()
    res = (
        client.table("am_ads")
        .select("library_id")
        .in_("library_id", scraped_ids)
        .execute()
    )
    existing = {r["library_id"] for r in (res.data or [])}

    now = datetime.now(timezone.utc).isoformat()
    payload = [
        {
            "library_id": a["library_id"],
            "target_id": target.get("id"),
            "page_name": a.get("page_name"),
            "started_on": a.get("started_on"),
            "ad_text": a.get("ad_text"),
            "media_type": a.get("media_type"),
            "media_url": a.get("media_url"),
            "last_seen_at": now,
        }
        for a in ads
        if a.get("library_id")
    ]
    client.table("am_ads").upsert(payload, on_conflict="library_id").execute()

    new = len(set(scraped_ids) - existing)
    return new, len(scraped_ids)


def record_health(client: Client, target_id: str, count: int, status: str) -> None:
    client.table("am_health_checks").insert(
        {"target_id": target_id, "extracted_count": count, "status": status}
    ).execute()
