"""URL 取得（httpx）と本文抽出（trafilatura）。"""

from __future__ import annotations

import re
from typing import Any

import httpx
import trafilatura

_ACCEPT = (
    "text/html,application/xhtml+xml,application/xml;q=0.9,"
    "image/avif,image/webp,image/apng,*/*;q=0.8"
)
_ACCEPT_LANG = "ja,en-US;q=0.9,en;q=0.8"

# 既定はブラウザ相当の UA。多くのサイトは「ブラウザらしさ」で通す。
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        " (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": _ACCEPT,
    "Accept-Language": _ACCEPT_LANG,
}

# 正直な識別子 UA。Wikimedia のようにブラウザ偽装 UA を robot policy で 403 にし、
# 素性を名乗る UA なら通すサイト向けのフォールバック。
HONEST_HEADERS = {
    "User-Agent": "lm-text-editor/0.1 (local research assistant; +https://github.com/lm-text-editor)",
    "Accept": _ACCEPT,
    "Accept-Language": _ACCEPT_LANG,
}


async def fetch_and_extract(url: str) -> dict[str, Any]:
    """URL を取得して本文テキストとタイトルを返す。

    まずブラウザ相当の UA で取得し、403/429（ボット扱いの拒否）なら
    正直な識別子 UA で 1 回だけ再試行する。
    """
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        res = await client.get(url, headers=BROWSER_HEADERS)
        if res.status_code in (403, 429):
            res = await client.get(url, headers=HONEST_HEADERS)
        res.raise_for_status()
        html = res.text

    text = (
        trafilatura.extract(
            html,
            include_comments=False,
            include_tables=True,
            favor_precision=True,  # news-picker の知見: ノイズ削減優先
        )
        or ""
    )
    m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"\s+", " ", m.group(1)).strip() if m else url
    return {"url": url, "title": title, "text": text}
