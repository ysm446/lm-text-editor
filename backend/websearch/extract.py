"""URL 取得（httpx）と本文抽出（trafilatura）。"""

from __future__ import annotations

import re
from typing import Any

import httpx
import trafilatura

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    " (KHTML, like Gecko) Chrome/126.0 Safari/537.36 lm-text-editor"
)


async def fetch_and_extract(url: str) -> dict[str, Any]:
    """URL を取得して本文テキストとタイトルを返す。"""
    async with httpx.AsyncClient(
        timeout=30, follow_redirects=True, headers={"User-Agent": USER_AGENT}
    ) as client:
        res = await client.get(url)
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
