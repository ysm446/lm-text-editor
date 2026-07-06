"""SQLite アクセス層（フェーズ 1: workspace / document / asset）。"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
DB_PATH = DATA_DIR / "lm-editor.sqlite3"
WORKSPACE_FILES_DIR = DATA_DIR / "workspaces"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

EMPTY_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))


# --- workspace ---

def list_workspaces() -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, name, created_at FROM workspace ORDER BY id"
        ).fetchall()
    return [dict(r) for r in rows]


def create_workspace(name: str) -> dict[str, Any]:
    now = _now()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO workspace (name, created_at) VALUES (?, ?)", (name, now)
        )
        ws_id = cur.lastrowid
    return {"id": ws_id, "name": name, "created_at": now}


# --- document ---

def list_docs(workspace_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, updated_at FROM document"
            " WHERE workspace_id = ? ORDER BY updated_at DESC",
            (workspace_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def create_doc(workspace_id: int, title: str) -> dict[str, Any] | None:
    now = _now()
    try:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO document (workspace_id, title, content_json, updated_at)"
                " VALUES (?, ?, ?, ?)",
                (workspace_id, title, json.dumps(EMPTY_DOC, ensure_ascii=False), now),
            )
            doc_id = cur.lastrowid
    except sqlite3.IntegrityError:
        return None  # workspace が存在しない
    assert doc_id is not None
    return get_doc(doc_id)


def get_doc(doc_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, workspace_id, title, content_json, content_md, updated_at"
            " FROM document WHERE id = ?",
            (doc_id,),
        ).fetchone()
    if row is None:
        return None
    doc = dict(row)
    doc["content_json"] = json.loads(doc["content_json"])
    return doc


def update_doc(
    doc_id: int,
    *,
    content_json: Any | None = None,
    content_md: str | None = None,
    title: str | None = None,
) -> bool:
    sets = ["updated_at = ?"]
    params: list[Any] = [_now()]
    if content_json is not None:
        sets.append("content_json = ?")
        params.append(json.dumps(content_json, ensure_ascii=False))
    if content_md is not None:
        sets.append("content_md = ?")
        params.append(content_md)
    if title is not None:
        sets.append("title = ?")
        params.append(title)
    params.append(doc_id)
    with get_conn() as conn:
        cur = conn.execute(
            f"UPDATE document SET {', '.join(sets)} WHERE id = ?", params
        )
        return cur.rowcount > 0


# --- asset ---

def create_asset(
    document_id: int, rel_path: str, caption: str | None = None
) -> dict[str, Any]:
    now = _now()
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO asset (document_id, rel_path, caption, created_at)"
            " VALUES (?, ?, ?, ?)",
            (document_id, rel_path, caption, now),
        )
        asset_id = cur.lastrowid
    return {
        "id": asset_id,
        "document_id": document_id,
        "rel_path": rel_path,
        "caption": caption,
        "created_at": now,
    }
