"""다운로드 안 된(downloaded=false) 광고의 미디어만 다시 받아 영구 보관(무료, Apify 호출 없음).

연결 충돌 등으로 업로드가 실패해 임시 CDN URL 로만 남은 광고를, DB 에 저장된 CDN URL 에서
다시 받아 우리 스토리지로 보관한다. 메타 CDN URL 은 만료되므로 수집 직후 빨리 돌릴수록 성공률이 높다.

    python -m src.refill_media

환경변수(.env): SUPABASE_URL, SUPABASE_SERVICE_KEY (필수)
  MEDIA_WORKERS (선택) 동시 다운로드 수(기본 6)
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

from . import media, supabase_store

ROOT = Path(__file__).resolve().parent.parent


def _fetch_pending(client) -> list[dict]:
    """downloaded=false 인 광고를 페이지네이션으로 전부 수집(미디어 필드만)."""
    rows: list[dict] = []
    frm, page = 0, 1000
    while True:
        res = (
            client.table("am_ads")
            .select("library_id, media_type, media_url, media_urls")
            .eq("downloaded", False)
            .range(frm, frm + page - 1)
            .execute()
        )
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page:
            break
        frm += page
    return rows


def main() -> int:
    load_dotenv(ROOT / ".env")
    client = supabase_store.get_client()
    pending = _fetch_pending(client)
    if not pending:
        print("보관 안 된 광고가 없습니다. (전부 다운로드 완료)")
        return 0

    total = len(pending)
    print(f"미보관 광고 {total}건 → 미디어 재다운로드 시작…", flush=True)
    workers = max(1, int(os.environ.get("MEDIA_WORKERS") or "6"))
    done = 0

    def _store_one(ad: dict) -> None:
        # 워커마다 자기 전용 Supabase 클라이언트(연결 충돌 방지)
        media.ensure_media(supabase_store._media_client(), ad)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_store_one, a) for a in pending]
        for _ in as_completed(futures):
            done += 1
            if done % 20 == 0 or done == total:
                print(f"  미디어 {done}/{total} 처리…", flush=True)

    now = datetime.now(timezone.utc).isoformat()
    ok = [a for a in pending if a.get("downloaded")]
    if ok:
        client.table("am_ads").upsert(
            [
                {
                    "library_id": a.get("library_id"),
                    "media_url": a.get("media_url"),
                    "media_urls": a.get("media_urls"),
                    "poster_url": a.get("poster_url"),
                    "frames": a.get("frames"),
                    "media_path": a.get("media_path"),
                    "downloaded": True,
                    "last_seen_at": now,
                }
                for a in ok
            ],
            on_conflict="library_id",
        ).execute()
    fail = total - len(ok)
    print(f"\n완료: {len(ok)}/{total} 건 영구 보관.", flush=True)
    if fail:
        print(f"  {fail}건은 실패(대개 CDN 만료). apify-import 재실행 시 새 URL 로 복구됩니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
