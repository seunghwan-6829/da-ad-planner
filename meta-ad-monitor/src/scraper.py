"""Playwright 기반 메타 광고 라이브러리 크롤러.

[추출 전략] 메타의 CSS 클래스명은 난독화돼 자주 바뀌지만, "Library ID:" /
"게재 시작일" 같은 텍스트 라벨은 사용자에게 보이는 문구라 안정적이다.
그래서 깨지기 쉬운 CSS 셀렉터 대신, 텍스트(Library ID)를 앵커로 찾아
미디어가 있는 상위 컨테이너까지 올라가 추출한다. → DOM이 바뀌어도 잘 버팀.

정규식/미디어 셀렉터는 config/selectors.json 에서 주입한다(= heal 대상).
"""
from __future__ import annotations

import random
import time
from pathlib import Path
from urllib.parse import urlencode

from playwright.sync_api import sync_playwright

SNAPSHOT_DIR = Path(__file__).resolve().parent.parent / "snapshots"
AD_LIBRARY_BASE = "https://www.facebook.com/ads/library/"

# 브라우저 안에서 실행되는 추출 스크립트.
# cfg.lib / cfg.start = 정규식 source 문자열 배열. cfg.imgSel / cfg.vidSel = CSS.
_EXTRACT_JS = r"""
(cfg) => {
  const libRes = cfg.lib.filter(Boolean).map(p => new RegExp(p, 'i'));
  const startRes = cfg.start.filter(Boolean).map(p => new RegExp(p, 'i'));
  const { imgSel, vidSel, maxClimb } = cfg;

  const firstMatch = (text, res) => {
    for (const re of res) { const m = text.match(re); if (m) return (m[1] || '').trim(); }
    return null;
  };

  // 1) Library ID 텍스트를 포함하는 "가장 안쪽" 요소를 찾는다(자식이 또 포함하면 패스).
  const anchors = [];
  for (const el of document.querySelectorAll('div, span')) {
    const tc = el.textContent || '';
    let libId = null;
    for (const re of libRes) { const m = tc.match(re); if (m) { libId = m[1]; break; } }
    if (!libId) continue;
    const childHas = Array.from(el.children).some(
      c => libRes.some(re => re.test(c.textContent || ''))
    );
    if (childHas) continue;            // 더 안쪽 자식이 있으면 그쪽이 앵커
    anchors.push({ el, libId });
  }

  // 2) 앵커에서 위로 올라가 이미지/영상이 들어있는 카드 컨테이너를 찾는다.
  const results = {};
  for (const a of anchors) {
    if (results[a.libId]) continue;
    let node = a.el, container = a.el;
    for (let i = 0; i < (maxClimb || 8); i++) {
      if (node.querySelector && (node.querySelector(imgSel) || node.querySelector(vidSel))) {
        container = node; break;
      }
      if (!node.parentElement) break;
      node = node.parentElement; container = node;
    }
    const ctext = container.innerText || '';
    const vid = container.querySelector ? container.querySelector(vidSel) : null;
    const img = container.querySelector ? container.querySelector(imgSel) : null;
    let media_url = null, media_type = null;
    if (vid && vid.getAttribute('src')) { media_url = vid.getAttribute('src'); media_type = 'video'; }
    else if (img && img.getAttribute('src')) { media_url = img.getAttribute('src'); media_type = 'image'; }
    results[a.libId] = {
      library_id: a.libId,
      started_on: firstMatch(ctext, startRes),
      ad_text: ctext.slice(0, 1000),
      media_url, media_type,
    };
  }
  return Object.values(results);
}
"""


def build_url(target: dict, country: str) -> str:
    params = {"active_status": "active", "ad_type": "all", "country": country}
    if target.get("type") == "page":
        params["view_all_page_id"] = target["page_id"]
    else:
        params["q"] = target.get("query", "")
        params["search_type"] = "keyword_unordered"
    return f"{AD_LIBRARY_BASE}?{urlencode(params)}"


def _human_pause(lo: float = 0.8, hi: float = 2.2) -> None:
    """사람처럼 보이게 약간 랜덤하게 쉰다(차단 회피)."""
    time.sleep(random.uniform(lo, hi))


def _cfg(selectors: dict) -> dict:
    f = selectors["fields"]
    return {
        "lib": [f["library_id"].get("regex"), f["library_id"].get("korean_regex")],
        "start": [f["started_on"].get("regex"), f["started_on"].get("korean_regex")],
        "imgSel": selectors["media"]["image_selector"],
        "vidSel": selectors["media"]["video_selector"],
        "maxClimb": 8,
    }


def extract_ads(page, selectors: dict) -> list[dict]:
    """현재 페이지에서 광고들을 추출(브라우저 내 JS 실행)."""
    try:
        return page.evaluate(_EXTRACT_JS, _cfg(selectors)) or []
    except Exception as e:
        print(f"  추출 중 오류: {e}")
        return []


def scrape_target(
    target: dict,
    selectors: dict,
    country: str,
    headful: bool = False,
    max_scrolls: int = 8,
) -> list[dict]:
    url = build_url(target, country)
    label = target.get("label", "?")
    ads: dict[str, dict] = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        ctx = browser.new_context(
            locale="ko-KR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
        )
        page = ctx.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        _human_pause(2.0, 4.0)

        # 무한스크롤: 조금씩 내리며 광고를 더 로드하고, 매번 추출해 합친다.
        for _ in range(max_scrolls):
            for ad in extract_ads(page, selectors):
                ad["target_label"] = label
                ad["page_name"] = target.get("page_id") or target.get("query")
                ads[ad["library_id"]] = ad
            page.mouse.wheel(0, 3000)
            _human_pause()

        browser.close()

    print(f"  [{label}] {len(ads)}개 광고 추출")
    return list(ads.values())


def capture_snapshot(target: dict, country: str, headful: bool = False) -> Path:
    """heal 용: 현재 페이지 HTML을 통째로 저장하고 경로를 반환."""
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    url = build_url(target, country)
    out = SNAPSHOT_DIR / f"{target.get('label', 'page')}-{int(time.time())}.html"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headful)
        page = browser.new_context(locale="ko-KR").new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        _human_pause(3.0, 5.0)
        page.mouse.wheel(0, 4000)
        _human_pause()
        out.write_text(page.content(), encoding="utf-8")
        browser.close()

    print(f"  스냅샷 저장: {out}")
    return out
