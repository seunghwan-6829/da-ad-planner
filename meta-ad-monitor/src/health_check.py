"""DOM 헬스체크: 알려진 대상에서 광고가 정상적으로 추출되는지 확인.

추출 개수가 임계치(min_expected) 미만이면 'broken' 으로 본다.
→ DOM이 바뀐 신호. heal 을 돌릴 때다.
"""
from __future__ import annotations

from . import scraper


def check_target(
    target: dict, selectors: dict, country: str, min_expected: int = 3
) -> tuple[int, bool]:
    """반환: (추출된 광고 수, 정상 여부)"""
    ads = scraper.scrape_target(target, selectors, country, max_scrolls=4)
    count = len(ads)
    ok = count >= min_expected
    return count, ok
