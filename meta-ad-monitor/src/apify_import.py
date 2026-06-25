"""Apify(curious_coder/facebook-ads-library-scraper)로 광고 전량을 수집해 Supabase 에 저장.

메타가 자동 크롤(Playwright)을 30개로 막아서, Apify 의 전문 스크래퍼가 봇차단을 대신 뚫고
광고를 전량 가져온다. 결과는 기존 save_ads 로 저장(미디어 다운로드+중복제거 그대로 재사용).

    python -m src.apify_import

환경변수(.env):
  APIFY_TOKEN        (필수) Apify 콘솔 → Settings → API & Integrations 의 Personal API token
  APIFY_ACTOR        (선택) 기본 XtaWFhbtfxyzqrFmd (curious_coder/facebook-ads-library-scraper)
  APIFY_COUNT        (선택) 브랜드당 최대 수집 개수(기본 1000)
  CRAWL_SINCE_DAYS   (선택) 최근 N일 내 추가된 브랜드만(crawl-new 와 동일 동작)
  CRAWL_TARGET_ID    (선택) 특정 브랜드 1개만
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

from . import scraper, supabase_store

ROOT = Path(__file__).resolve().parent.parent
APIFY_BASE = "https://api.apify.com/v2"


def _http(method: str, url: str, body: dict | None = None, timeout: int = 120):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def run_apify(actor: str, token: str, actor_input: dict) -> list[dict]:
    """Apify actor 를 비동기 실행 → 완료까지 폴링 → 데이터셋 아이템 반환(긴 스크랩에도 안전)."""
    start = _http("POST", f"{APIFY_BASE}/acts/{actor}/runs?token={token}", actor_input, timeout=60)
    run = start.get("data") or {}
    run_id = run.get("id")
    dataset_id = run.get("defaultDatasetId")
    if not run_id:
        raise RuntimeError(f"Apify 실행 시작 실패: {start}")

    # 완료까지 폴링(최대 약 20분)
    for _ in range(240):
        time.sleep(5)
        st = (_http("GET", f"{APIFY_BASE}/actor-runs/{run_id}?token={token}", timeout=60).get("data") or {})
        status = st.get("status")
        if status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
            if status != "SUCCEEDED":
                print(f"  Apify 실행 종료 상태: {status}", file=sys.stderr)
            dataset_id = st.get("defaultDatasetId") or dataset_id
            break

    items: list[dict] = []
    offset = 0
    while True:
        page = _http(
            "GET",
            f"{APIFY_BASE}/datasets/{dataset_id}/items?token={token}&clean=true&offset={offset}&limit=1000",
            timeout=120,
        )
        if not isinstance(page, list) or not page:
            break
        items.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return items


def parse_item(it: dict) -> dict | None:
    """Apify 출력(메타 광고 노드)을 save_ads 가 기대하는 형태로 변환."""
    lib = it.get("ad_archive_id") or it.get("adArchiveID") or it.get("adid")
    if not lib:
        return None
    snap = it.get("snapshot") or {}
    page_name = it.get("page_name") or snap.get("page_name") or snap.get("current_page_name")

    started = None
    sd = it.get("start_date") or it.get("startDate") or snap.get("creation_time")
    try:
        if isinstance(sd, (int, float)) and sd > 0:
            started = datetime.fromtimestamp(sd, tz=timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        started = None

    body = snap.get("body")
    if isinstance(body, dict):
        ad_text = body.get("text")
    elif isinstance(body, str):
        ad_text = body
    else:
        ad_text = None

    def img_url(d):
        return (d.get("original_image_url") or d.get("resized_image_url") or d.get("image_url")) if isinstance(d, dict) else None

    imgs = snap.get("images") or []
    vids = snap.get("videos") or []
    cards = snap.get("cards") or []

    media_url = media_type = None
    media_urls = None
    if vids and isinstance(vids[0], dict):
        media_url = vids[0].get("video_hd_url") or vids[0].get("video_sd_url")
        media_type = "video"
    elif len(imgs) > 1:
        urls = [u for u in (img_url(d) for d in imgs) if u]
        if urls:
            media_urls = urls[:10]
            media_url = urls[0]
            media_type = "carousel"
    elif imgs:
        media_url = img_url(imgs[0])
        media_type = "image" if media_url else None
    elif cards and isinstance(cards[0], dict):
        c = cards[0]
        vurl = c.get("video_hd_url") or c.get("video_sd_url")
        media_url = vurl or img_url(c)
        media_type = "video" if vurl else ("image" if media_url else None)
        if len(cards) > 1 and not vurl:
            curls = [u for u in (img_url(x) for x in cards) if u]
            if len(curls) > 1:
                media_urls = curls[:10]
                media_url = curls[0]
                media_type = "carousel"

    landing = snap.get("link_url") or (cards[0].get("link_url") if cards and isinstance(cards[0], dict) else None)

    return {
        "library_id": str(lib),
        "page_name": page_name,
        "started_on": started,
        "ad_text": ad_text,
        "media_url": media_url,
        "media_type": media_type,
        "media_urls": media_urls,
        "landing_url": landing,
    }


def _select_targets(client):
    target_id = (os.environ.get("CRAWL_TARGET_ID") or "").strip()
    if target_id:
        t = supabase_store.fetch_target(client, target_id)
        return [t] if t else []
    targets = supabase_store.fetch_enabled_targets(client)
    since_days = int(os.environ.get("CRAWL_SINCE_DAYS") or "0")
    if since_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=since_days)

        def _is_new(t):
            v = t.get("created_at")
            if not v:
                return False
            try:
                return datetime.fromisoformat(str(v).replace("Z", "+00:00")) >= cutoff
            except Exception:
                return False

        before = len(targets)
        targets = [t for t in targets if _is_new(t)]
        print(f"최근 {since_days}일 내 추가된 브랜드만: {len(targets)}/{before}개")
    return targets


def main() -> int:
    load_dotenv(ROOT / ".env")
    token = (os.environ.get("APIFY_TOKEN") or "").strip()
    if not token:
        print("APIFY_TOKEN 이 .env 에 없습니다. Apify 콘솔 → Settings → API & Integrations 에서 토큰을 복사해 넣어주세요.", file=sys.stderr)
        return 1

    actor = (os.environ.get("APIFY_ACTOR") or "XtaWFhbtfxyzqrFmd").strip()
    count = int(os.environ.get("APIFY_COUNT") or "1000")

    client = supabase_store.get_client()
    targets = _select_targets(client)
    if not targets:
        print("대상 브랜드가 없습니다.")
        return 0

    grand_new = 0
    for t in targets:
        label = t.get("label", "?")
        url = scraper.build_url(t, t.get("country", "KR"))
        actor_input = {
            "urls": [{"url": url}],
            "count": count,
            "scrapeAdDetails": True,
            "scrapePageAds.activeStatus": "active",
            "scrapePageAds.countryCode": t.get("country", "KR") or "KR",
            "scrapePageAds.sortBy": "impressions_desc",
        }
        try:
            print(f"[{label}] Apify 수집 시작 …", flush=True)
            items = run_apify(actor, token, actor_input)
            ads = [a for a in (parse_item(x) for x in items) if a and a.get("library_id")]
            new, total = supabase_store.save_ads(client, t, ads)
            grand_new += new
            supabase_store.record_health(client, t.get("id"), total, "OK" if total else "EMPTY")
            print(f"[{label}] Apify 원본 {len(items)}건 → 저장 {total}건(신규 {new})", flush=True)
        except Exception as e:
            print(f"[{label}] 실패: {e}", file=sys.stderr)
            supabase_store.record_health(client, t.get("id"), 0, "ERROR")

    print(f"\n총 신규 {grand_new}건 누적.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
