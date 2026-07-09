"""크롤된 소재(이미지/영상)를 Supabase Storage(meta-ad-media)에 다운로드 보관한다.

- 메타 CDN URL 은 만료되므로, 파일을 받아 우리 스토리지에 올리고 영구 URL 로 교체한다.
- 영상은 ffmpeg 로 포스터+프레임을 추출해 함께 올린다(영상 내용 AI 분석용).
- 모든 단계는 실패해도 크롤 자체가 죽지 않도록 방어한다(원본 CDN URL 유지, downloaded=False).
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import tempfile
import time

import requests

BUCKET = "meta-ad-media"
_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Referer": "https://www.facebook.com/",
}


def _download(url: str, attempts: int = 3) -> bytes | None:
    for i in range(attempts):
        try:
            r = requests.get(url, headers=_HEADERS, timeout=90)
            if r.status_code == 200 and r.content:
                return r.content
            print(f"  다운로드 응답 이상({r.status_code})")
            return None
        except Exception as e:
            if i == attempts - 1:
                print(f"  다운로드 실패: {e}")
            else:
                time.sleep(1.0 * (i + 1))
    return None


def _public_url(client, path: str) -> str | None:
    try:
        res = client.storage.from_(BUCKET).get_public_url(path)
        if isinstance(res, str):
            return res
        if isinstance(res, dict):
            return res.get("publicUrl") or (res.get("data") or {}).get("publicUrl")
    except Exception as e:
        print(f"  public url 실패: {e}")
    return None


def _upload(client, path: str, data: bytes, content_type: str, attempts: int = 3) -> str | None:
    opts = {"content-type": content_type, "upsert": "true"}
    for i in range(attempts):
        try:
            client.storage.from_(BUCKET).upload(path, data, opts)
            return _public_url(client, path)
        except Exception:
            # 이미 존재 등 → update 로 한 번 시도
            try:
                client.storage.from_(BUCKET).update(path, data, opts)
                return _public_url(client, path)
            except Exception as e2:
                if i == attempts - 1:
                    print(f"  업로드 실패({path}): {e2}")
                    return None
                time.sleep(1.0 * (i + 1))  # 일시적 연결 끊김 → 백오프 후 재시도
    return None


def _extract_frames(client, lib: str, video: bytes, n: int = 5) -> list[str]:
    """영상 바이트에서 ffmpeg 로 n개 프레임을 추출해 업로드하고 URL 리스트 반환."""
    urls: list[str] = []
    try:
        with tempfile.TemporaryDirectory() as d:
            vp = os.path.join(d, "v.mp4")
            with open(vp, "wb") as f:
                f.write(video)

            dur = 0.0
            try:
                out = subprocess.run(
                    ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", vp],
                    capture_output=True, text=True, timeout=60,
                )
                dur = float(json.loads(out.stdout)["format"]["duration"])
            except Exception:
                dur = 0.0

            for i in range(n):
                t = (dur * (i + 0.5) / n) if dur > 0 else float(i)
                fp = os.path.join(d, f"f{i}.jpg")
                try:
                    subprocess.run(
                        ["ffmpeg", "-y", "-ss", str(t), "-i", vp, "-frames:v", "1", "-q:v", "3", fp],
                        capture_output=True, timeout=60,
                    )
                except Exception:
                    continue
                if os.path.exists(fp) and os.path.getsize(fp) > 0:
                    with open(fp, "rb") as f:
                        b = f.read()
                    u = _upload(client, f"{lib}/frame-{i}.jpg", b, "image/jpeg")
                    if u:
                        urls.append(u)
    except Exception as e:
        print(f"  프레임 추출 실패({lib}): {e}")
    return urls


def ensure_media(client, ad: dict) -> None:
    """ad 의 미디어를 다운로드/업로드하고 ad['media_url'|'media_urls'|'poster_url'|'frames'|'media_path'|'downloaded']
    를 우리 영구 URL 로 교체(in-place). 실패 시 원본 유지, downloaded 안 켜짐."""
    lib = ad.get("library_id")
    if not lib:
        return
    mtype = ad.get("media_type")
    try:
        if mtype == "video" and ad.get("media_url"):
            data = _download(ad["media_url"])
            if not data:
                return
            our = _upload(client, f"{lib}/video.mp4", data, "video/mp4")
            if not our:
                return
            ad["media_url"] = our
            ad["media_path"] = f"{lib}/"
            frames = _extract_frames(client, lib, data)
            if frames:
                ad["poster_url"] = frames[0]
                ad["frames"] = frames
            ad["downloaded"] = True
        else:
            urls = ad.get("media_urls") or ([ad["media_url"]] if ad.get("media_url") else [])
            our_urls: list[str] = []
            seen_hashes: set[str] = set()  # 같은 이미지(바이트 동일) 중복 제거 → 단일 이미지가 '슬라이드'로 부풀지 않게
            for u in urls[:12]:
                d = _download(u)
                if not d:
                    continue
                h = hashlib.md5(d).hexdigest()
                if h in seen_hashes:
                    continue
                seen_hashes.add(h)
                idx = len(our_urls)
                ou = _upload(client, f"{lib}/img-{idx}.jpg", d, "image/jpeg")
                if ou:
                    our_urls.append(ou)
            if our_urls:
                ad["media_url"] = our_urls[0]
                ad["media_urls"] = our_urls if len(our_urls) > 1 else None
                # 중복 제거 후 실제 고유 이미지 수로 유형 재판정(1장이면 이미지, 2장 이상이면 캐러셀)
                ad["media_type"] = "carousel" if len(our_urls) > 1 else "image"
                ad["media_path"] = f"{lib}/"
                ad["downloaded"] = True
    except Exception as e:
        print(f"  미디어 보관 실패({lib}): {e}")
