"""Web ページの取り込み: 取得 → 抽出 → 二層保存（spec.md §8, §9）。

- 一次: 原文チャンク（rag_chunk, source_type='web'）— 引用・裏取り用
- 二次: ソースノート（source_note）— 文章用 LLM の要約。俯瞰と当たり付け用
"""

from __future__ import annotations

import logging
from typing import Any

from backend import router
from backend.llm import client as llm_client
from backend.llm import think_parser
from backend.rag import store as rag_store
from backend.websearch.extract import fetch_and_extract

logger = logging.getLogger(__name__)

SUMMARY_MAX_INPUT_CHARS = 8000  # 要約プロンプトに入れる本文の上限（news-picker と同値）

SUMMARY_SYSTEM = (
    "あなたは技術記事執筆のためのリサーチアシスタントです。"
    "与えられた Web ページ本文を、執筆時の参照用に要約してください。\n"
    "ルール:\n"
    "- 3〜6 行の日本語で、事実と論点を優先する。\n"
    "- 数値・バージョン・コマンドなど具体的な情報は残す。\n"
    "- 要約本文のみを出力する。前置きは書かない。"
)


async def summarize(text: str, title: str) -> str | None:
    """文章用 LLM が起動していれば要約を返す。いなければ None。"""
    base_url = router.route("websearch")["base_url"]
    if not await llm_client.is_alive(base_url):
        return None
    try:
        raw = await llm_client.chat(
            base_url,
            [
                {"role": "system", "content": SUMMARY_SYSTEM},
                {
                    "role": "user",
                    "content": f"# {title}\n\n{text[:SUMMARY_MAX_INPUT_CHARS]}",
                },
            ],
            temperature=0.3,
            max_tokens=600,
            enable_thinking=False,
        )
        summary = think_parser.strip_think(raw)
        return summary or None
    except Exception as exc:
        logger.warning("summarize failed: %s", exc)
        return None


async def ingest_url(url: str, workspace_id: int | None) -> dict[str, Any]:
    """URL を取得して原文チャンク + ソースノートを保存する。"""
    page = await fetch_and_extract(url)
    if not page["text"].strip():
        raise ValueError("本文を抽出できませんでした")

    chunk_ids = rag_store.ingest(
        "web", page["text"], workspace_id=workspace_id, source_url=url
    )

    note_id = None
    summary = await summarize(page["text"], page["title"])
    if summary:
        note_id = rag_store.add_source_note(
            workspace_id=workspace_id, source_url=url, summary=summary
        )

    return {
        "url": url,
        "title": page["title"],
        "chunk_ids": chunk_ids,
        "note_id": note_id,
        "summary": summary,
    }
