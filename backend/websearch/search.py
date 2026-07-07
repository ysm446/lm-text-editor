"""Web 検索と文章用 LLM によるクエリ分解（spec.md §9）。

検索プロバイダ: Tavily（API キーがあれば）→ ddgs / DuckDuckGo（キー不要）の順。
ddgs へのフォールバックは news-picker の search_web.py を流用。
クエリ分解は文章用 LLM（:8080）が起動していれば使い、いなければ元クエリのまま検索する。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

import httpx

from backend import paths, router
from backend.llm import client as llm_client
from backend.llm import think_parser

logger = logging.getLogger(__name__)

TAVILY_URL = "https://api.tavily.com/search"

QUERY_DECOMPOSE_SYSTEM = (
    "あなたは技術記事執筆のためのリサーチアシスタントです。"
    "与えられた調べものの依頼を、Web 検索エンジンに投げる検索クエリに分解してください。\n"
    "ルール:\n"
    "- 1〜3 個のクエリを出力する。1 行に 1 クエリ。\n"
    "- 技術用語は英語のほうがヒットしやすければ英語にする。\n"
    "- クエリ以外の説明・番号・記号は一切出力しない。"
)


def get_tavily_api_key() -> str | None:
    """環境変数 TAVILY_API_KEY または ~/.lm-text-editor/settings.json から取得。"""
    key = os.environ.get("TAVILY_API_KEY")
    if key:
        return key
    settings_path = paths.machine_root() / "settings.json"
    try:
        settings = json.loads(settings_path.read_text("utf-8"))
        return settings.get("tavily_api_key") or None
    except Exception:
        return None


async def decompose_query(query: str) -> list[str]:
    """文章用 LLM が起動していればクエリ分解、いなければ元クエリのまま。"""
    base_url = router.route("websearch")["base_url"]
    if not await llm_client.is_alive(base_url):
        return [query]
    try:
        raw = await llm_client.chat(
            base_url,
            [
                {"role": "system", "content": QUERY_DECOMPOSE_SYSTEM},
                {"role": "user", "content": query},
            ],
            temperature=0.3,
            max_tokens=256,
            enable_thinking=False,
        )
        lines = [
            line.strip()
            for line in think_parser.strip_think(raw).splitlines()
            if line.strip()
        ]
        return lines[:3] or [query]
    except Exception as exc:
        logger.warning("query decomposition failed: %s", exc)
        return [query]


async def _tavily_search(query: str, max_results: int) -> list[dict[str, Any]]:
    key = get_tavily_api_key()
    assert key
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            TAVILY_URL,
            json={"api_key": key, "query": query, "max_results": max_results},
        )
        res.raise_for_status()
        data = res.json()
    return [
        {
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "snippet": r.get("content", ""),
            "query": query,
        }
        for r in data.get("results", [])
        if r.get("url")
    ]


def _ddgs_search_sync(query: str, max_results: int) -> list[dict[str, Any]]:
    """ddgs（DuckDuckGo）検索。キー不要（news-picker の search_text を流用）。"""
    from ddgs import DDGS

    try:
        with DDGS() as ddgs:
            raw = ddgs.text(
                query, region="jp-jp", safesearch="off", max_results=max_results
            )
    except Exception as exc:
        if "no results" in str(exc).lower():
            logger.info("ddgs no results for %r", query)
        else:
            logger.warning("ddgs search failed for %r: %s", query, exc)
        return []
    results = []
    for r in raw or []:
        url = r.get("href") or r.get("url")
        title = (r.get("title") or "").strip()
        if not url or not title:
            continue
        results.append(
            {
                "title": title,
                "url": url,
                "snippet": (r.get("body") or "").strip(),
                "query": query,
            }
        )
    return results


async def _provider_search(query: str, max_results: int) -> list[dict[str, Any]]:
    if get_tavily_api_key():
        try:
            return await _tavily_search(query, max_results)
        except Exception as exc:
            logger.warning("tavily failed (%s); falling back to ddgs", exc)
    return await asyncio.to_thread(_ddgs_search_sync, query, max_results)


async def search(query: str, max_results: int = 8) -> dict[str, Any]:
    """クエリ分解 → 検索 → URL で重複排除して返す。"""
    queries = await decompose_query(query)
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for q in queries:
        for r in await _provider_search(q, max_results):
            if r["url"] not in seen:
                seen.add(r["url"])
                results.append(r)
    provider = "tavily" if get_tavily_api_key() else "ddgs"
    return {"queries": queries, "results": results[:max_results], "provider": provider}
