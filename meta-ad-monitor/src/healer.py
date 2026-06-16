"""셀프 힐링: DOM이 바뀌어 추출이 깨졌을 때, 페이지 HTML을 Claude에게 보내
새 셀렉터/정규식을 제안받는다.

- 결과는 config/selectors.json 에 바로 덮어쓰지 않고, 백업 후 적용한다.
- 모델: claude-opus-4-8 (구조화 출력 + 적응형 사고)
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path

import anthropic
from pydantic import BaseModel

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "selectors.json"
MAX_HTML_CHARS = 200_000  # 너무 길면 핵심 영역만 보냄


# --- Claude 가 채워줄 구조화 출력 스키마 ---
class FieldPattern(BaseModel):
    regex: str
    korean_regex: str


class MediaSelectors(BaseModel):
    image_selector: str
    video_selector: str


class ProposedSelectors(BaseModel):
    card_selector: str
    library_id: FieldPattern
    started_on: FieldPattern
    media: MediaSelectors
    confidence: float  # 0.0 ~ 1.0
    reasoning: str


def _clean_html(html: str) -> str:
    """script/style/svg 같은 잡음을 걷어내 토큰을 아낀다."""
    html = re.sub(r"<script\b[^>]*>.*?</script>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<style\b[^>]*>.*?</style>", "", html, flags=re.DOTALL | re.IGNORECASE)
    html = re.sub(r"<svg\b[^>]*>.*?</svg>", "", html, flags=re.DOTALL | re.IGNORECASE)
    if len(html) > MAX_HTML_CHARS:
        html = html[:MAX_HTML_CHARS]
    return html


PROMPT = """\
너는 웹 스크래퍼 유지보수 도우미야. 아래는 메타(페이스북) 광고 라이브러리
페이지의 HTML 스냅샷이야. 이 HTML에서 개별 "광고 카드"를 선택하는 CSS
셀렉터와, 각 카드 안에서 다음 정보를 뽑는 정규식을 찾아줘.

추출 대상:
- library_id: "Library ID: 123456789" 또는 "라이브러리 ID: 123456789" 형태의 숫자
- started_on: "Started running on ..." 또는 "게재 시작일: ..." 형태의 날짜
- 미디어: 광고 이미지(img)와 영상(video)을 선택하는 셀렉터

요구사항:
- card_selector: 광고 1개를 감싸는 컨테이너를 선택하는 CSS 셀렉터. 너무 넓거나
  좁지 않게, 광고 카드 단위로 잡아야 한다. 여러 후보를 콤마로 묶어도 된다.
- 정규식은 파이썬 re 모듈 기준. 캡처 그룹 1번이 추출할 값이어야 한다.
- 확신이 낮으면 confidence를 낮게 주고, reasoning에 근거를 적어라.

현재 쓰던(깨진) 셀렉터 설정:
{current}

--- HTML 스냅샷 시작 ---
{html}
--- HTML 스냅샷 끝 ---
"""


def propose_selectors(snapshot_path: Path, current: dict) -> ProposedSelectors:
    client = anthropic.Anthropic()
    html = _clean_html(Path(snapshot_path).read_text(encoding="utf-8", errors="ignore"))

    prompt = PROMPT.format(current=json.dumps(current, ensure_ascii=False, indent=2), html=html)

    # 적응형 사고 + 구조화 출력으로 깔끔한 JSON을 받는다.
    resp = client.messages.parse(
        model="claude-opus-4-8",
        max_tokens=4000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        messages=[{"role": "user", "content": prompt}],
        output_format=ProposedSelectors,
    )
    proposed = resp.parsed_output
    if proposed is None:
        raise RuntimeError("Claude 응답을 파싱하지 못했습니다 (refusal 또는 형식 오류).")
    return proposed


def apply_selectors(proposed: ProposedSelectors) -> Path:
    """백업 후 config/selectors.json 을 새 셀렉터로 교체. 백업 경로 반환."""
    current = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = CONFIG_PATH.with_name(f"selectors.backup.{ts}.json")
    shutil.copy2(CONFIG_PATH, backup)

    updated = {
        **current,
        "version": int(current.get("version", 1)) + 1,
        "updated_at": datetime.now().strftime("%Y-%m-%d"),
        "card_selector": proposed.card_selector,
        "fields": {
            "library_id": proposed.library_id.model_dump(),
            "started_on": proposed.started_on.model_dump(),
        },
        "media": proposed.media.model_dump(),
    }
    CONFIG_PATH.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return backup
