"""hybrid search: sqlite-vec（ベクトル）+ FTS5（全文）の RRF 融合（mem-chat 流用）。"""

from __future__ import annotations

import logging
import struct
from typing import Any

from backend.rag.embed import embed_query
from backend.rag.store import connect

logger = logging.getLogger(__name__)

RRF_K = 60


def hybrid_search(
    query: str,
    workspace_id: int | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """スコープ規則（spec §4）: 現在のワークスペース + グローバル（workspace_id IS NULL）。
    workspace_id が None の場合はグローバルのみを検索する。"""
    if not query.strip():
        return []

    if workspace_id is None:
        scope_clause = "rc.workspace_id IS NULL"
        scope_params: tuple[Any, ...] = ()
    else:
        scope_clause = "(rc.workspace_id IS NULL OR rc.workspace_id = ?)"
        scope_params = (workspace_id,)

    scores: dict[int, float] = {}
    with connect() as conn:
        # FTS5（trigram のため 3 文字未満のクエリは失敗しうる → 無視してベクトルに任せる）
        safe_query = '"' + query.replace('"', ' ') + '"'
        try:
            fts_rows = conn.execute(
                "SELECT rc.id AS chunk_id FROM rag_fts rf"
                " JOIN rag_chunk rc ON rc.id = rf.chunk_id"
                f" WHERE rf.chunk_text MATCH ? AND {scope_clause} LIMIT ?",
                (safe_query, *scope_params, top_k * 4),
            ).fetchall()
            for rank, row in enumerate(fts_rows):
                cid = int(row["chunk_id"])
                scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        except Exception as exc:
            logger.debug("FTS5 search skipped: %s", exc)

        # ベクトル（スコープ内で距離を直接計算。グローバル KNN の取りこぼし回避）
        qvec = embed_query(query)
        vec_bytes = struct.pack(f"{len(qvec)}f", *qvec)
        try:
            vec_rows = conn.execute(
                "SELECT rc.id AS chunk_id,"
                " vec_distance_cosine(rv.embedding, ?) AS distance"
                " FROM rag_chunk rc JOIN rag_vec rv ON rv.chunk_id = rc.id"
                f" WHERE {scope_clause} ORDER BY distance ASC LIMIT ?",
                (vec_bytes, *scope_params, top_k * 4),
            ).fetchall()
            for rank, row in enumerate(vec_rows):
                cid = int(row["chunk_id"])
                scores[cid] = scores.get(cid, 0.0) + 1.0 / (RRF_K + rank + 1)
        except Exception as exc:
            logger.warning("vector search failed: %s", exc)

        if not scores:
            return []

        ranked_ids = sorted(scores, key=lambda cid: scores[cid], reverse=True)[:top_k]
        placeholders = ",".join("?" * len(ranked_ids))
        rows = conn.execute(
            "SELECT id, workspace_id, source_type, source_url, fetched_at, chunk_text"
            f" FROM rag_chunk WHERE id IN ({placeholders})",
            ranked_ids,
        ).fetchall()

    by_id = {int(r["id"]): dict(r) for r in rows}
    return [
        {**by_id[cid], "score": scores[cid]} for cid in ranked_ids if cid in by_id
    ]


def search_notes(
    query: str,
    workspace_id: int | None = None,
    top_k: int = 5,
) -> list[dict[str, Any]]:
    """ソースノート（要約）の hybrid search。チャンク検索と同じ RRF 融合。"""
    if not query.strip():
        return []

    if workspace_id is None:
        scope_clause = "sn.workspace_id IS NULL"
        scope_params: tuple[Any, ...] = ()
    else:
        scope_clause = "(sn.workspace_id IS NULL OR sn.workspace_id = ?)"
        scope_params = (workspace_id,)

    scores: dict[int, float] = {}
    with connect() as conn:
        safe_query = '"' + query.replace('"', ' ') + '"'
        try:
            fts_rows = conn.execute(
                "SELECT sn.id AS note_id FROM note_fts nf"
                " JOIN source_note sn ON sn.id = nf.note_id"
                f" WHERE nf.summary MATCH ? AND {scope_clause} LIMIT ?",
                (safe_query, *scope_params, top_k * 4),
            ).fetchall()
            for rank, row in enumerate(fts_rows):
                nid = int(row["note_id"])
                scores[nid] = scores.get(nid, 0.0) + 1.0 / (RRF_K + rank + 1)
        except Exception as exc:
            logger.debug("note FTS5 search skipped: %s", exc)

        qvec = embed_query(query)
        vec_bytes = struct.pack(f"{len(qvec)}f", *qvec)
        try:
            vec_rows = conn.execute(
                "SELECT sn.id AS note_id,"
                " vec_distance_cosine(nv.embedding, ?) AS distance"
                " FROM source_note sn JOIN note_vec nv ON nv.note_id = sn.id"
                f" WHERE {scope_clause} ORDER BY distance ASC LIMIT ?",
                (vec_bytes, *scope_params, top_k * 4),
            ).fetchall()
            for rank, row in enumerate(vec_rows):
                nid = int(row["note_id"])
                scores[nid] = scores.get(nid, 0.0) + 1.0 / (RRF_K + rank + 1)
        except Exception as exc:
            logger.warning("note vector search failed: %s", exc)

        if not scores:
            return []

        ranked_ids = sorted(scores, key=lambda nid: scores[nid], reverse=True)[:top_k]
        placeholders = ",".join("?" * len(ranked_ids))
        rows = conn.execute(
            "SELECT id, workspace_id, source_url, summary, fetched_at"
            f" FROM source_note WHERE id IN ({placeholders})",
            ranked_ids,
        ).fetchall()

    by_id = {int(r["id"]): dict(r) for r in rows}
    return [
        {**by_id[nid], "score": scores[nid]} for nid in ranked_ids if nid in by_id
    ]


def build_rag_context(results: list[dict[str, Any]]) -> str:
    """検索結果を LLM プロンプト用のテキストに整形する。"""
    if not results:
        return ""
    lines = ["以下は関連する参考資料の検索結果です。事実確認と内容の裏付けに使ってください。", ""]
    for i, r in enumerate(results, 1):
        src = r.get("source_url") or r.get("source_type", "")
        lines.append(f"[資料 {i}]{f'（出典: {src}）' if src else ''}")
        lines.append(str(r["chunk_text"]))
        lines.append("")
    return "\n".join(lines)
