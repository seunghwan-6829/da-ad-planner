"""클라우드 크롤러 진입점 (GitHub Actions 가 매일 실행).

Supabase am_targets 에서 enabled 타겟을 읽어 크롤링하고,
결과를 am_ads 에 누적한다.

    python -m src.run_cloud
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
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

    # 로컬(사장님 PC) 실행 옵션:
    #  - CRAWL_HEADFUL=1   → 브라우저 창을 띄워(headful) 집 IP로 크롤. 메타가 봇 차단을 덜 해 더 많은 광고를 내준다.
    #  - CRAWL_MAX_SCROLLS → 스크롤 횟수(기본 80). 광고 많은 브랜드일수록 크게.
    headful = (os.environ.get("CRAWL_HEADFUL") or "").strip().lower() in ("1", "true", "yes")
    max_scrolls = int(os.environ.get("CRAWL_MAX_SCROLLS") or "80")

    # CRAWL_TARGET_ID 가 있으면 그 브랜드 1개만 즉시 크롤(브랜드 추가 직후 트리거용).
    target_id = (os.environ.get("CRAWL_TARGET_ID") or "").strip()
    # 단일 브랜드 dispatch는 매트릭스 청크 0에서만 실행(나머지 청크 작업은 바로 종료).
    if target_id and int(os.environ.get("CRAWL_CHUNK") or "0") != 0:
        print("단일 브랜드 크롤은 청크 0에서만 수행 — 이 청크는 건너뜀")
        return 0
    if target_id:
        t = supabase_store.fetch_target(client, target_id)
        targets = [t] if t else []
        if not targets:
            print(f"target_id={target_id} 를 찾을 수 없습니다.")
            return 0
        print(f"단일 브랜드 즉시 크롤: {targets[0].get('label')} ({target_id})")
    else:
        targets = supabase_store.fetch_enabled_targets(client)
        # CRAWL_SINCE_DAYS: 최근 N일 내 추가된 브랜드만 크롤(신규 브랜드만 로컬에서 전체 크롤할 때).
        since_days = int(os.environ.get("CRAWL_SINCE_DAYS") or "0")
        if since_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)

            def _is_new(t: dict) -> bool:
                v = t.get("created_at")
                if not v:
                    return False  # 생성일 모르면 '신규'로 보지 않음(오래된 브랜드 재크롤 방지)
                try:
                    return datetime.fromisoformat(str(v).replace("Z", "+00:00")) >= cutoff
                except Exception:
                    return False

            before = len(targets)
            targets = [t for t in targets if _is_new(t)]
            print(f"최근 {since_days}일 내 추가된 브랜드만: {len(targets)}/{before}개")
        # CRAWL_MAX_COUNT: 현재 광고 수가 N개 이하인 브랜드만 크롤(=아직 다 못 가져온 브랜드).
        # 클라우드 30개 제한에 걸린 브랜드만 골라 로컬(집 IP)에서 전량 보충할 때 사용. 이미 많이 쌓인 브랜드는 건너뜀.
        max_count = int(os.environ.get("CRAWL_MAX_COUNT") or "0")
        if max_count > 0:
            ad_counts = supabase_store.fetch_ad_counts(client)
            before = len(targets)
            targets = [t for t in targets if ad_counts.get(t.get("id"), 0) <= max_count]
            print(f"광고 {max_count}개 이하(미완) 브랜드만: {len(targets)}/{before}개")
        # 브랜드가 많으면(예: 82개) 한 작업에서 다 돌면 45분 한도를 넘는다.
        # CRAWL_CHUNKS/CRAWL_CHUNK 로 enabled 타겟을 N등분해 병렬 작업이 나눠 처리.
        chunks = int(os.environ.get("CRAWL_CHUNKS") or "0")
        chunk = int(os.environ.get("CRAWL_CHUNK") or "0")
        if chunks > 1:
            targets = sorted(targets, key=lambda t: str(t.get("id") or ""))
            targets = [t for i, t in enumerate(targets) if i % chunks == chunk]
            print(f"청크 {chunk + 1}/{chunks}: 이 작업이 맡은 {len(targets)}개 크롤")
    if not targets:
        print("enabled 타겟이 없습니다. 대시보드에서 업체를 추가하세요.")
        return 0

    grand_new = 0
    for t in targets:
        country = t.get("country", "KR")
        try:
            ads = scraper.scrape_target(t, selectors, country, headful=headful, max_scrolls=max_scrolls)
            new, total = supabase_store.save_ads(client, t, ads)
            grand_new += new
            status = "OK" if total > 0 else "EMPTY"
            supabase_store.record_health(client, t.get("id"), total, status)
            print(f"[{t.get('label')}] 추출 {total}건, 신규 {new}건 ({status})")
        except Exception as e:  # 한 타겟 실패해도 나머지는 계속
            print(f"[{t.get('label')}] 실패: {e}", file=sys.stderr)
            supabase_store.record_health(client, t.get("id"), 0, "ERROR")

    # 전체(정기) 크롤일 때만, 그리고 청크 0(작업 1개)에서만 종료 스윕 1회 실행(중복/오탐 방지).
    if not target_id and int(os.environ.get("CRAWL_CHUNK") or "0") == 0:
        ended = supabase_store.sweep_stale_ended(client)
        if ended:
            print(f"오래 미관측 {ended}건 종료 표기")

    print(f"\n총 신규 {grand_new}건 누적.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
