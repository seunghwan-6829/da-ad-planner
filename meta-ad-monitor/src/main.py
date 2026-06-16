"""진입점. collect / healthcheck / heal / stats 명령을 제공한다.

    python -m src.main collect [--headful]
    python -m src.main healthcheck
    python -m src.main heal [--target LABEL] [--apply]
    python -m src.main stats
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

from . import health_check, scraper, storage

ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT / "config"


def load_json(name: str) -> dict:
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))


def enabled_targets(targets_cfg: dict) -> list[dict]:
    return [t for t in targets_cfg.get("targets", []) if t.get("enabled")]


def cmd_collect(args) -> int:
    targets_cfg = load_json("targets.json")
    selectors = load_json("selectors.json")
    country = targets_cfg.get("country", "KR")
    targets = enabled_targets(targets_cfg)
    if not targets:
        print("enabled=true 인 추적 대상이 없습니다. config/targets.json 을 채우세요.")
        return 1

    conn = storage.connect()
    total_new = total_dup = 0
    for target in targets:
        ads = scraper.scrape_target(target, selectors, country, headful=args.headful)
        new, dup = storage.save_ads(conn, ads)
        total_new += new
        total_dup += dup
        print(f"  → 신규 {new}건, 중복 {dup}건 저장")

    print(f"\n완료: 신규 {total_new}건 누적, 중복 {total_dup}건 갱신.")
    return 0


def cmd_healthcheck(args) -> int:
    targets_cfg = load_json("targets.json")
    selectors = load_json("selectors.json")
    country = targets_cfg.get("country", "KR")
    targets = enabled_targets(targets_cfg)
    if not targets:
        print("점검할 대상이 없습니다.")
        return 1

    conn = storage.connect()
    broken = []
    for target in targets:
        count, ok = health_check.check_target(target, selectors, country)
        status = "OK" if ok else "BROKEN"
        storage.record_health(conn, target.get("label", "?"), count, status)
        print(f"  [{target.get('label')}] {count}개 → {status}")
        if not ok:
            broken.append(target.get("label"))

    if broken:
        print(f"\n⚠️  깨진 대상: {broken}")
        print("   → DOM이 바뀐 것 같습니다. 다음을 실행하세요:")
        print(f"     python -m src.main heal --target {broken[0]}")
        return 2

    print("\n모든 대상 정상.")
    return 0


def cmd_heal(args) -> int:
    load_dotenv(ROOT / ".env")
    from . import healer  # anthropic import 지연 (heal 때만 필요)

    targets_cfg = load_json("targets.json")
    selectors = load_json("selectors.json")
    country = targets_cfg.get("country", "KR")
    targets = enabled_targets(targets_cfg)

    target = None
    if args.target:
        target = next((t for t in targets if t.get("label") == args.target), None)
    elif targets:
        target = targets[0]
    if not target:
        print("힐링할 대상을 찾을 수 없습니다. --target LABEL 로 지정하세요.")
        return 1

    print(f"[{target.get('label')}] 스냅샷 수집 중...")
    snapshot = scraper.capture_snapshot(target, country, headful=args.headful)

    print("Claude에게 새 셀렉터 제안 요청 중... (잠시 걸립니다)")
    proposed = healer.propose_selectors(snapshot, selectors)

    print("\n=== Claude 제안 ===")
    print(f"확신도: {proposed.confidence:.2f}")
    print(f"근거: {proposed.reasoning}")
    print(f"card_selector: {proposed.card_selector}")
    print(f"library_id.regex: {proposed.library_id.regex}")
    print(f"started_on.regex: {proposed.started_on.regex}")

    if not args.apply:
        print("\n(미리보기 모드) 적용하려면 --apply 를 붙여 다시 실행하세요.")
        return 0

    backup = healer.apply_selectors(proposed)
    print(f"\n적용 완료. 백업: {backup}")
    print("→ 'python -m src.main healthcheck' 로 정상 추출되는지 확인하세요.")
    return 0


def cmd_stats(args) -> int:
    conn = storage.connect()
    s = storage.stats(conn)
    print(f"누적 광고: {s['total']}건\n")
    print("대상별:")
    for row in s["by_target"]:
        print(f"  {row['target_label']}: {row['c']}건")
    print("\n최근 발견 10건:")
    for row in s["latest"]:
        print(f"  {row['page_name']} | {row['started_on']} | {row['first_seen_at']}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="메타 광고 라이브러리 모니터")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("collect", help="광고 수집")
    p.add_argument("--headful", action="store_true", help="브라우저 띄워서 보기")
    p.set_defaults(func=cmd_collect)

    p = sub.add_parser("healthcheck", help="DOM 정상 여부 점검")
    p.set_defaults(func=cmd_healthcheck)

    p = sub.add_parser("heal", help="AI로 셀렉터 수정 제안/적용")
    p.add_argument("--target", help="대상 label")
    p.add_argument("--apply", action="store_true", help="제안을 실제로 적용")
    p.add_argument("--headful", action="store_true")
    p.set_defaults(func=cmd_heal)

    p = sub.add_parser("stats", help="누적 통계")
    p.set_defaults(func=cmd_stats)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
