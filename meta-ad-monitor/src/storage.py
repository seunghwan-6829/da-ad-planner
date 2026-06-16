"""SQLite 저장소. 광고는 Library ID 기준으로 중복 제거되어 누적된다."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "ads.db"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    _init(conn)
    return conn


def _init(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS ads (
            library_id      TEXT PRIMARY KEY,
            target_label    TEXT,
            page_name       TEXT,
            started_on      TEXT,
            ad_text         TEXT,
            media_type      TEXT,
            media_url       TEXT,
            media_local     TEXT,
            first_seen_at   TEXT NOT NULL,
            last_seen_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS health_checks (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            ran_at          TEXT NOT NULL,
            target_label    TEXT,
            extracted_count INTEGER,
            status          TEXT
        );
        """
    )
    conn.commit()


def upsert_ad(conn: sqlite3.Connection, ad: dict) -> bool:
    """새 광고면 INSERT(True 반환), 기존 광고면 last_seen 갱신(False 반환)."""
    lib_id = ad.get("library_id")
    if not lib_id:
        return False

    now = _now()
    cur = conn.execute("SELECT library_id FROM ads WHERE library_id = ?", (lib_id,))
    exists = cur.fetchone() is not None

    if exists:
        conn.execute(
            "UPDATE ads SET last_seen_at = ?, media_local = COALESCE(?, media_local) "
            "WHERE library_id = ?",
            (now, ad.get("media_local"), lib_id),
        )
        return False

    conn.execute(
        """
        INSERT INTO ads (library_id, target_label, page_name, started_on, ad_text,
                         media_type, media_url, media_local, first_seen_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            lib_id,
            ad.get("target_label"),
            ad.get("page_name"),
            ad.get("started_on"),
            ad.get("ad_text"),
            ad.get("media_type"),
            ad.get("media_url"),
            ad.get("media_local"),
            now,
            now,
        ),
    )
    return True


def save_ads(conn: sqlite3.Connection, ads: Iterable[dict]) -> tuple[int, int]:
    """반환: (신규 개수, 중복 개수)"""
    new_count = dup_count = 0
    for ad in ads:
        if upsert_ad(conn, ad):
            new_count += 1
        else:
            dup_count += 1
    conn.commit()
    return new_count, dup_count


def record_health(conn: sqlite3.Connection, label: str, count: int, status: str) -> None:
    conn.execute(
        "INSERT INTO health_checks (ran_at, target_label, extracted_count, status) "
        "VALUES (?, ?, ?, ?)",
        (_now(), label, count, status),
    )
    conn.commit()


def stats(conn: sqlite3.Connection) -> dict:
    total = conn.execute("SELECT COUNT(*) FROM ads").fetchone()[0]
    by_target = conn.execute(
        "SELECT target_label, COUNT(*) c FROM ads GROUP BY target_label ORDER BY c DESC"
    ).fetchall()
    latest = conn.execute(
        "SELECT page_name, started_on, first_seen_at FROM ads "
        "ORDER BY first_seen_at DESC LIMIT 10"
    ).fetchall()
    return {
        "total": total,
        "by_target": [dict(r) for r in by_target],
        "latest": [dict(r) for r in latest],
    }
