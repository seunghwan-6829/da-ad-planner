"""기존에 URL로만 저장돼 있던 소재를 우리 Supabase Storage 로 일괄 다운로드 보관(backfill).

    python -m src.backfill_media

- am_ads 에서 downloaded=false 인 소재를 batch 만큼 가져와 media.ensure_media 로 받아 올린다.
- 영상은 프레임도 추출한다.
- 이미 CDN URL 이 만료된(주로 종료된) 소재는 다운로드 실패 → 그냥 건너뜀(크래시 X).
- BATCH 단위로 처리하니, 남으면 워크플로를 다시 실행하면 이어서 보관된다.
"""
from __future__ import annotations

import sys

from . import media, supabase_store

BATCH = 500


def main() -> int:
    client = supabase_store.get_client()

    res = (
        client.table("am_ads")
        .select("library_id, media_type, media_url, media_urls")
        .eq("downloaded", False)
        .order("first_seen_at", desc=True)
        .limit(BATCH)
        .execute()
    )
    rows = [r for r in (res.data or []) if r.get("media_url")]
    if not rows:
        print("보관할(미다운로드) 소재가 없습니다.")
        return 0

    done = 0
    for r in rows:
        ad = {
            "library_id": r["library_id"],
            "media_type": r.get("media_type"),
            "media_url": r.get("media_url"),
            "media_urls": r.get("media_urls"),
        }
        media.ensure_media(client, ad)
        if ad.get("downloaded"):
            client.table("am_ads").update(
                {
                    "media_url": ad.get("media_url"),
                    "media_urls": ad.get("media_urls"),
                    "poster_url": ad.get("poster_url"),
                    "frames": ad.get("frames"),
                    "media_path": ad.get("media_path"),
                    "downloaded": True,
                }
            ).eq("library_id", r["library_id"]).execute()
            done += 1
            print(f"  보관 완료: {r['library_id']}")
        else:
            print(f"  보관 실패(만료 가능): {r['library_id']}")

    print(f"\n이번 실행 {done}/{len(rows)}건 보관 (BATCH={BATCH}). 남은 게 있으면 워크플로를 다시 실행하세요.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
