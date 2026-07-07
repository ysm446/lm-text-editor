"""SQLite アクセス層（フェーズ 1: workspace / document / asset）。"""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from backend import paths

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

EMPTY_DOC: dict[str, Any] = {"type": "doc", "content": [{"type": "paragraph"}]}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    # paths.db_path() がアクティブなライブラリ配下を指す（切り替え対応のため毎回解決）
    conn = sqlite3.connect(paths.db_path())
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
        # 既存 DB のマイグレーション（フェーズ 6 で draft 列を追加）
        cols = {r["name"] for r in conn.execute("PRAGMA table_info(document)")}
        if "draft_json" not in cols:
            conn.execute("ALTER TABLE document ADD COLUMN draft_json TEXT")
            conn.execute("ALTER TABLE document ADD COLUMN draft_saved_at TEXT")


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


def update_workspace(ws_id: int, name: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute(
            "UPDATE workspace SET name = ? WHERE id = ?", (name, ws_id)
        )
        return cur.rowcount > 0


def delete_workspace(ws_id: int) -> bool:
    """ワークスペースと配下の文書・アセット・リビジョンを削除する。"""
    with get_conn() as conn:
        doc_ids = [
            r["id"]
            for r in conn.execute(
                "SELECT id FROM document WHERE workspace_id = ?", (ws_id,)
            )
        ]
        if doc_ids:
            ph = ",".join("?" * len(doc_ids))
            conn.execute(f"DELETE FROM asset WHERE document_id IN ({ph})", doc_ids)
            conn.execute(
                f"DELETE FROM document_revision WHERE document_id IN ({ph})", doc_ids
            )
            conn.execute(f"DELETE FROM document WHERE id IN ({ph})", doc_ids)
        cur = conn.execute("DELETE FROM workspace WHERE id = ?", (ws_id,))
        return cur.rowcount > 0


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
            "SELECT id, workspace_id, title, content_json, content_md, updated_at,"
            " draft_json, draft_saved_at"
            " FROM document WHERE id = ?",
            (doc_id,),
        ).fetchone()
    if row is None:
        return None
    doc = dict(row)
    doc["content_json"] = json.loads(doc["content_json"])
    doc["draft_json"] = json.loads(doc["draft_json"]) if doc["draft_json"] else None
    return doc


def save_doc(
    doc_id: int,
    content_json: Any,
    content_md: str | None,
    title: str | None = None,
) -> bool:
    """明示保存: 本文を更新してドラフトをクリアし、リビジョンを残す。"""
    now = _now()
    with get_conn() as conn:
        sets = (
            "content_json = ?, content_md = ?, updated_at = ?,"
            " draft_json = NULL, draft_saved_at = NULL"
        )
        params: list[Any] = [json.dumps(content_json, ensure_ascii=False), content_md, now]
        if title is not None:
            sets += ", title = ?"
            params.append(title)
        params.append(doc_id)
        cur = conn.execute(f"UPDATE document SET {sets} WHERE id = ?", params)
        if cur.rowcount == 0:
            return False
        row = conn.execute(
            "SELECT title FROM document WHERE id = ?", (doc_id,)
        ).fetchone()
        conn.execute(
            "INSERT INTO document_revision"
            " (document_id, title, content_json, content_md, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                doc_id,
                row["title"],
                json.dumps(content_json, ensure_ascii=False),
                content_md,
                now,
            ),
        )
        return True


def set_draft(doc_id: int, content_json: Any | None) -> bool:
    """ドラフト退避の保存（None でクリア）。updated_at は変えない。"""
    with get_conn() as conn:
        if content_json is None:
            cur = conn.execute(
                "UPDATE document SET draft_json = NULL, draft_saved_at = NULL"
                " WHERE id = ?",
                (doc_id,),
            )
        else:
            cur = conn.execute(
                "UPDATE document SET draft_json = ?, draft_saved_at = ? WHERE id = ?",
                (json.dumps(content_json, ensure_ascii=False), _now(), doc_id),
            )
        return cur.rowcount > 0


def list_revisions(doc_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, created_at FROM document_revision"
            " WHERE document_id = ? ORDER BY id DESC",
            (doc_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_revision(revision_id: int) -> dict[str, Any] | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT id, document_id, title, content_json, content_md, created_at"
            " FROM document_revision WHERE id = ?",
            (revision_id,),
        ).fetchone()
    if row is None:
        return None
    rev = dict(row)
    rev["content_json"] = json.loads(rev["content_json"])
    return rev


def delete_doc(doc_id: int) -> dict[str, Any] | None:
    """文書とアセット・リビジョンを削除。画像ファイル掃除用の情報を返す。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT workspace_id FROM document WHERE id = ?", (doc_id,)
        ).fetchone()
        if row is None:
            return None
        rel_paths = [
            r["rel_path"]
            for r in conn.execute(
                "SELECT rel_path FROM asset WHERE document_id = ?", (doc_id,)
            )
        ]
        conn.execute("DELETE FROM asset WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM document_revision WHERE document_id = ?", (doc_id,))
        conn.execute("DELETE FROM document WHERE id = ?", (doc_id,))
    return {"workspace_id": row["workspace_id"], "rel_paths": rel_paths}


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

def list_workspace_images(workspace_id: int) -> list[dict[str, Any]]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT a.id, a.document_id, a.rel_path, a.caption, a.created_at"
            " FROM asset a JOIN document d ON d.id = a.document_id"
            " WHERE d.workspace_id = ? ORDER BY a.id DESC",
            (workspace_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def delete_asset(asset_id: int) -> dict[str, Any] | None:
    """asset 行を削除し、ファイル掃除用の情報を返す。"""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT a.rel_path, d.workspace_id FROM asset a"
            " JOIN document d ON d.id = a.document_id WHERE a.id = ?",
            (asset_id,),
        ).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM asset WHERE id = ?", (asset_id,))
    return dict(row)



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
