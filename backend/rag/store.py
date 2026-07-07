"""RAG ストレージ: rag_chunk / source_note + sqlite-vec + FTS5（spec.md §4, §8）。"""

from __future__ import annotations

import sqlite3
import struct
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

import sqlite_vec

from backend import paths
from backend.rag.embed import EMBED_DIM, embed_document


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    """sqlite-vec をロードした接続（RAG 系のテーブルはこの接続で扱う）。"""
    conn = sqlite3.connect(paths.db_path())
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_rag_schema() -> None:
    with connect() as conn:
        conn.executescript(
            """
            -- 一次: 原文チャンク
            CREATE TABLE IF NOT EXISTS rag_chunk (
              id INTEGER PRIMARY KEY,
              workspace_id INTEGER,            -- NULL = グローバル知識ベース
              source_type TEXT NOT NULL,       -- 'article' | 'reference' | 'web'
              source_url TEXT,
              fetched_at TEXT,
              chunk_text TEXT NOT NULL
            );

            -- 二次: ソースノート（ornith 要約。フェーズ 4 で投入開始）
            CREATE TABLE IF NOT EXISTS source_note (
              id INTEGER PRIMARY KEY,
              workspace_id INTEGER,
              source_url TEXT,
              summary TEXT NOT NULL,
              fetched_at TEXT
            );

            -- 全文検索ミラー（trigram: 日本語対応）
            CREATE VIRTUAL TABLE IF NOT EXISTS rag_fts USING fts5(
              chunk_id UNINDEXED, chunk_text, tokenize='trigram'
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
              note_id UNINDEXED, summary, tokenize='trigram'
            );
            """
        )
        if not conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'rag_vec'"
        ).fetchone():
            conn.execute(
                f"CREATE VIRTUAL TABLE rag_vec USING vec0("
                f"chunk_id INTEGER PRIMARY KEY, embedding FLOAT[{EMBED_DIM}])"
            )
        if not conn.execute(
            "SELECT name FROM sqlite_master WHERE name = 'note_vec'"
        ).fetchone():
            conn.execute(
                f"CREATE VIRTUAL TABLE note_vec USING vec0("
                f"note_id INTEGER PRIMARY KEY, embedding FLOAT[{EMBED_DIM}])"
            )


def chunk_text(text: str, target_chars: int = 800) -> list[str]:
    """段落境界を優先しつつ target_chars 程度に分割する。"""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paragraphs:
        # 単一段落が長すぎる場合はそのまま切る
        while len(p) > target_chars * 2:
            head, p = p[:target_chars], p[target_chars:]
            if buf:
                chunks.append(buf)
                buf = ""
            chunks.append(head)
        if buf and len(buf) + len(p) + 2 > target_chars:
            chunks.append(buf)
            buf = p
        else:
            buf = f"{buf}\n\n{p}" if buf else p
    if buf:
        chunks.append(buf)
    return chunks


def ingest(
    source_type: str,
    content: str,
    *,
    workspace_id: int | None = None,
    source_url: str | None = None,
) -> list[int]:
    """本文をチャンク → 埋め込み → rag_chunk / rag_fts / rag_vec に保存。"""
    now = _now()
    chunk_ids: list[int] = []
    with connect() as conn:
        for chunk in chunk_text(content):
            cur = conn.execute(
                "INSERT INTO rag_chunk"
                " (workspace_id, source_type, source_url, fetched_at, chunk_text)"
                " VALUES (?, ?, ?, ?, ?)",
                (workspace_id, source_type, source_url, now, chunk),
            )
            cid = cur.lastrowid
            assert cid is not None
            conn.execute(
                "INSERT INTO rag_fts (chunk_id, chunk_text) VALUES (?, ?)",
                (cid, chunk),
            )
            vec = embed_document(chunk)
            conn.execute(
                "INSERT INTO rag_vec (chunk_id, embedding) VALUES (?, ?)",
                (cid, struct.pack(f"{len(vec)}f", *vec)),
            )
            chunk_ids.append(cid)
    return chunk_ids


def add_source_note(
    *,
    workspace_id: int | None,
    source_url: str | None,
    summary: str,
) -> int:
    """ソースノート（二次: 要約）を保存し、埋め込みと FTS にも登録する。"""
    now = _now()
    with connect() as conn:
        cur = conn.execute(
            "INSERT INTO source_note (workspace_id, source_url, summary, fetched_at)"
            " VALUES (?, ?, ?, ?)",
            (workspace_id, source_url, summary, now),
        )
        note_id = cur.lastrowid
        assert note_id is not None
        conn.execute(
            "INSERT INTO note_fts (note_id, summary) VALUES (?, ?)",
            (note_id, summary),
        )
        vec = embed_document(summary)
        conn.execute(
            "INSERT INTO note_vec (note_id, embedding) VALUES (?, ?)",
            (note_id, struct.pack(f"{len(vec)}f", *vec)),
        )
    return note_id


def list_sources(workspace_id: int) -> list[dict[str, Any]]:
    """ワークスペースに取り込まれた資料をソース単位で一覧する。"""
    with connect() as conn:
        rows = conn.execute(
            "SELECT source_type, source_url, COUNT(*) AS chunk_count,"
            " MIN(fetched_at) AS fetched_at"
            " FROM rag_chunk WHERE workspace_id = ?"
            " GROUP BY source_type, source_url ORDER BY MIN(id) DESC",
            (workspace_id,),
        ).fetchall()
        note_rows = conn.execute(
            "SELECT source_url, COUNT(*) AS n FROM source_note"
            " WHERE workspace_id = ? GROUP BY source_url",
            (workspace_id,),
        ).fetchall()
    notes_by_url = {r["source_url"]: int(r["n"]) for r in note_rows}
    return [
        {**dict(r), "note_count": notes_by_url.get(r["source_url"], 0)} for r in rows
    ]


def delete_source(
    workspace_id: int, source_type: str, source_url: str | None
) -> int:
    """ソース単位で原文チャンクとソースノートを削除する。"""
    with connect() as conn:
        if source_url is None:
            cond = "workspace_id = ? AND source_type = ? AND source_url IS NULL"
            params: tuple[Any, ...] = (workspace_id, source_type)
        else:
            cond = "workspace_id = ? AND source_type = ? AND source_url = ?"
            params = (workspace_id, source_type, source_url)
        ids = [
            r["id"]
            for r in conn.execute(f"SELECT id FROM rag_chunk WHERE {cond}", params)
        ]
        if ids:
            ph = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM rag_fts WHERE chunk_id IN ({ph})", ids)
            conn.execute(f"DELETE FROM rag_vec WHERE chunk_id IN ({ph})", ids)
            conn.execute(f"DELETE FROM rag_chunk WHERE id IN ({ph})", ids)
        if source_url is not None:
            note_ids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM source_note WHERE workspace_id = ? AND source_url = ?",
                    (workspace_id, source_url),
                )
            ]
            if note_ids:
                ph = ",".join("?" * len(note_ids))
                conn.execute(f"DELETE FROM note_fts WHERE note_id IN ({ph})", note_ids)
                conn.execute(f"DELETE FROM note_vec WHERE note_id IN ({ph})", note_ids)
                conn.execute(f"DELETE FROM source_note WHERE id IN ({ph})", note_ids)
    return len(ids)


def delete_workspace_data(workspace_id: int) -> int:
    """ワークスペース削除時に、そのスコープの RAG データを掃除する。"""
    with connect() as conn:
        ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM rag_chunk WHERE workspace_id = ?", (workspace_id,)
            )
        ]
        if ids:
            ph = ",".join("?" * len(ids))
            conn.execute(f"DELETE FROM rag_fts WHERE chunk_id IN ({ph})", ids)
            conn.execute(f"DELETE FROM rag_vec WHERE chunk_id IN ({ph})", ids)
            conn.execute(f"DELETE FROM rag_chunk WHERE id IN ({ph})", ids)
        note_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM source_note WHERE workspace_id = ?", (workspace_id,)
            )
        ]
        if note_ids:
            ph = ",".join("?" * len(note_ids))
            conn.execute(f"DELETE FROM note_fts WHERE note_id IN ({ph})", note_ids)
            conn.execute(f"DELETE FROM note_vec WHERE note_id IN ({ph})", note_ids)
            conn.execute(f"DELETE FROM source_note WHERE id IN ({ph})", note_ids)
    return len(ids)


def chunk_count() -> int:
    with connect() as conn:
        row = conn.execute("SELECT COUNT(*) AS c FROM rag_chunk").fetchone()
    return int(row["c"]) if row else 0
