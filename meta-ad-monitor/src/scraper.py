"""Playwright 기반 메타 광고 라이브러리 크롤러.

[추출 전략] 메타의 CSS 클래스명은 난독화돼 자주 바뀌지만, "Library ID:" /
"게재 시작일" 같은 텍스트 라벨은 사용자에게 보이는 문구라 안정적이다.
그래서 깨지기 쉬운 CSS 셀렉터 대신, 텍스트(Library ID)를 앵커로 찾아
미디어가 있는 상위 컨테이너까지 올라가 추출한다. → DOM이 바뀌어도 잘 버팀.

정규식/미디어 셀렉터는 config/selectors.json 에서 주입한다(= heal 대상).
"""
from __future__ import annotations

import os
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

    // 캐러셀 후보 이미지 수집. 단, 로고/프로필 같은 "작게 렌더된" 이미지는 제외한다.
    // (단일 이미지 광고가 로고+크리에이티브로 2장이 되어 슬라이드로 오인되는 문제 방지)
    let imgs = [];
    if (container.querySelectorAll) {
      const cands = Array.from(container.querySelectorAll(imgSel));
      const big = cands.filter(e => {
        const r = e.getBoundingClientRect();
        return r.width >= 100 && r.height >= 100;   // 광고 크리에이티브만(아바타/로고 제외)
      });
      const chosen = big.length ? big : cands;       // 큰 이미지가 하나도 없으면 폴백
      imgs = chosen.map(e => e.getAttribute('src')).filter(s => s && /^https?:/.test(s));
    }
    const uniqueImgs = Array.from(new Set(imgs));

    // 랜딩 페이지: 카드 내 링크에서 목적지 추출.
    //  · l.facebook.com/l.php?u=<encoded> (메타 링크 시밍) → u 파라미터를 디코드해 실제 목적지
    //  · 그 외엔 페이스북 외부 직접 링크
    let landing = null;
    if (container.querySelectorAll) {
      for (const an of container.querySelectorAll('a[href]')) {
        const href = an.getAttribute('href') || '';
        if (!/^https?:\/\//.test(href)) continue;
        const um = href.match(/[?&]u=([^&]+)/);
        if (/facebook\.com\/l\.php/.test(href) && um) {
          try { landing = decodeURIComponent(um[1]); } catch (e) { landing = um[1]; }
          // 중첩 인코딩 대비 한 번 더
          if (landing && /%3A%2F%2F/i.test(landing)) { try { landing = decodeURIComponent(landing); } catch (e) {} }
          break;
        }
        if (!/facebook\.com/.test(href)) { landing = href; break; }
      }
    }

    let media_url = null, media_type = null, media_urls = null;
    if (vid && vid.getAttribute('src')) {
      media_url = vid.getAttribute('src'); media_type = 'video';
    } else if (uniqueImgs.length > 1) {
      media_urls = uniqueImgs.slice(0, 10); media_url = uniqueImgs[0]; media_type = 'carousel';
    } else if (uniqueImgs.length === 1) {
      media_url = uniqueImgs[0]; media_type = 'image';
    }

    results[a.libId] = {
      library_id: a.libId,
      started_on: firstMatch(ctext, startRes),
      ad_text: ctext.slice(0, 1000),
      media_url, media_type, media_urls,
      landing_url: landing,
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


# 점진 스크롤: 맨 아래로 점프하지 않고 "한 화면씩"만 내린다.
# (한 칸 내림 → 호출자가 광고 ID 수집 → 또 한 칸 내림 … 반복. 천천히 내려가며 lazy-load를 안정적으로 트리거)
_SCROLL_JS = """() => {
  const step = Math.max(700, Math.floor(window.innerHeight * 0.9));  // 약 한 화면
  // 광고 라이브러리는 내부 div 스크롤을 쓰기도 하므로 가장 큰 스크롤 컨테이너도 같이 한 칸 내린다.
  let best = null, bestH = 0;
  for (const d of document.querySelectorAll('div')) {
    if (d.scrollHeight > d.clientHeight + 300 && d.clientHeight > 300 && d.scrollHeight > bestH) {
      bestH = d.scrollHeight; best = d;
    }
  }
  if (best) {
    try { best.scrollTop = best.scrollTop + step; } catch (e) {}
    try { best.dispatchEvent(new Event('scroll')); } catch (e) {}
  }
  try { window.scrollBy(0, step); } catch (e) {}
  try { if (document.scrollingElement) document.scrollingElement.scrollTop += step; } catch (e) {}
  try { window.dispatchEvent(new Event('scroll')); } catch (e) {}
  return document.body.scrollHeight;
}"""


def scrape_target(
    target: dict,
    selectors: dict,
    country: str,
    headful: bool = False,
    max_scrolls: int = 80,
) -> list[dict]:
    url = build_url(target, country)
    label = target.get("label", "?")
    proxy_server = (os.environ.get("PROXY_SERVER") or "").strip()

    def _attempt(use_proxy: bool) -> dict:
        ads: dict[str, dict] = {}
        with sync_playwright() as p:
            # 자동화 티 숨김 + 백그라운드 스로틀링 차단(headful 창이 뒤에 있어도 스크롤/lazy-load가 멈추지 않게 → 끝까지 수집).
            browser = p.chromium.launch(
                headless=not headful,
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                    "--disable-features=CalculateNativeWinOcclusion",
                ],
                ignore_default_args=["--enable-automation"],
            )
            ctx_kwargs = dict(
                locale="ko-KR",
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
                ),
            )
            # headful(로컬)은 실제 창 크기를 쓴다 → 사람처럼 마우스 휠로 자연스럽게 스크롤되고 lazy-load가 정상 트리거됨.
            # headless(클라우드)는 뷰포트를 고정.
            if headful:
                ctx_kwargs["no_viewport"] = True
            else:
                ctx_kwargs["viewport"] = {"width": 1366, "height": 1000}
            # 레지던셜 프록시(일반 IP)로 거치면 메타가 봇 차단을 안 해 전 광고를 내준다.
            if use_proxy and proxy_server:
                proxy = {"server": proxy_server}
                if os.environ.get("PROXY_USERNAME"):
                    proxy["username"] = os.environ["PROXY_USERNAME"]
                if os.environ.get("PROXY_PASSWORD"):
                    proxy["password"] = os.environ["PROXY_PASSWORD"]
                ctx_kwargs["proxy"] = proxy
                print(f"  프록시 사용: {proxy_server}")
            ctx = browser.new_context(**ctx_kwargs)
            # stealth: 자동화 신호(navigator.webdriver 등)를 숨겨 메타가 광고를 더 많이 내주게 한다.
            try:
                ctx.add_init_script(
                    "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
                    "Object.defineProperty(navigator,'languages',{get:()=>['ko-KR','ko','en-US','en']});"
                    "Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});"
                    "window.chrome={runtime:{}};"
                )
            except Exception:
                pass
            # 프록시 모드에서만 대역폭 절약(영상/폰트 차단). 직접 접속(프록시 없음)에선
            # 라우트 가로채기가 추출을 불안정하게 만들 수 있어 간섭하지 않는다.
            if use_proxy and proxy_server:
                try:
                    ctx.route(
                        "**/*",
                        lambda route: route.abort()
                        if route.request.resource_type in ("media", "font")
                        else route.continue_(),
                    )
                except Exception:
                    pass
            page = ctx.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            _human_pause(2.0, 4.0)

            # 무한스크롤: 페이지 맨 아래로 계속 내리며 매번 추출해 합친다.
            # (가상화로 화면 밖 카드가 DOM에서 사라질 수 있어 매 스텝 추출 + dedup)
            # 더 이상 늘지 않으면(끝 도달) 몇 번 확인 후 종료.
            prev_count = -1
            stagnant = 0
            for i in range(max_scrolls):
                for ad in extract_ads(page, selectors):
                    ad["target_label"] = label
                    ad["page_name"] = target.get("page_id") or target.get("query")
                    ads[ad["library_id"]] = ad

                cur = len(ads)
                # 진행상황 출력: 수가 늘 때 + 멈춰있을 때 주기적으로(스크롤이 먹는지 콘솔에서 바로 보임)
                if cur != prev_count or stagnant % 4 == 0:
                    print(f"  [{label}] 스크롤 {i + 1}/{max_scrolls} → {cur}건", flush=True)

                if cur == prev_count:
                    stagnant += 1
                    # 12번 연속(=약 30~40초) 안 늘어야 끝으로 판단. 느린 로드에 일찍 포기하지 않게 관대하게.
                    if stagnant >= 12:
                        print(f"  [{label}] {cur}건에서 더 안 늘어 종료", flush=True)
                        break
                else:
                    stagnant = 0
                prev_count = cur

                # 실제 마우스 휠로 한 화면씩 내림 → JS scrollTo 가 안 먹는 페이지(내부 스크롤 컨테이너)에서도
                # 진짜로 스크롤되어 lazy-load 가 트리거된다. (사람이 휠 굴리는 것과 동일)
                try:
                    page.mouse.move(680, 500)
                    page.mouse.wheel(0, 1200)
                except Exception:
                    pass
                page.evaluate(_SCROLL_JS)  # 내부 컨테이너 보조 스크롤
                _human_pause(2.2, 3.5)  # 다음 배치 로드 대기(넉넉히)

            browser.close()
        return ads

    # 프록시 설정 시 우선 시도 → 실패하면 직접 접속으로 폴백(크롤이 0건으로 깨지지 않게).
    ads: dict = {}
    if proxy_server:
        try:
            ads = _attempt(True)
        except Exception as e:
            print(f"  프록시 크롤 실패({e}) → 직접 접속으로 폴백")
            ads = {}
    if not ads:
        try:
            ads = _attempt(False)
        except Exception as e:
            print(f"  크롤 실패: {e}")
            ads = {}

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
