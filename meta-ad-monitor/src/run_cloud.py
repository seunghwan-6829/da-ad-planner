"""클라우드 크롤러 진입점 (GitHub Actions 가 매일 실행).

Supabase am_targets 에서 enabled 타겟을 읽어 크롤링하고,
결과를 am_ads 에 누적한다.

    python -m src.run_cloud
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from . import scraper, supabase_store

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    load_dotenv(ROOT / ".env")  # 로컬 테스트용. Actions 에선 secrets 가 주입됨.
    selectors = json.loads(
        (ROOT / "config" / "selectors.json").read_text(encoding="utf-8")
    )

    client = supabase_store.get_client()
    targets = supabase_store.fetch_enabled_targets(client)
    if not targets:
        print("enabled 타겟이 없습니다. 대시보드에서 업체를 추가하세요.")
        return 0

    grand_new = 0
    for t in targets:
        country = t.get("country", "KR")
        try:
            ads = scraper.scrape_target(t, selectors, country)
            new, total = supabase_store.save_ads(client, t, ads)
            grand_new += new
            status = "OK" if total > 0 else "EMPTY"
            supabase_store.record_health(client, t.get("id"), total, status)
            print(f"[{t.get('label')}] 추출 {total}건, 신규 {new}건 ({status})")
        except Exception as e:  # 한 타겟 실패해도 나머지는 계속
            print(f"[{t.get('label')}] 실패: {e}", file=sys.stderr)
            supabase_store.record_health(client, t.get("id"), 0, "ERROR")

    print(f"\n총 신규 {grand_new}건 누적.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
