"""FastAPI エントリ（spec.md §10 のワークスペース / 文書 / 画像 API）。

起動: .venv\\Scripts\\python.exe -m uvicorn backend.main:app --port 8000
"""

import asyncio
import base64
import binascii
import json
import logging
import os
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from backend import library, paths, router, settings_store, system_stats
from backend.db import models
from backend.llm import client as llm_client
from backend.llm import manager as llm_manager
from backend.llm import prompts
from backend.llm import think_parser
from backend.rag import embed as rag_embed
from backend.rag import search as rag_search
from backend.rag import store as rag_store
from backend.websearch import ingest as web_ingest
from backend.websearch import search as web_search

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    models.init_db()
    rag_store.init_rag_schema()
    # 埋め込みモデル（Ruri）は起動時に先読みしない。torch/transformers の import が
    # 重く、起動直後に backend がもたつくため。初回の RAG 検索・取り込み時に
    # rag_embed._ensure_loaded() が遅延ロードする（エディタ利用を優先）。
    yield


app = FastAPI(title="lm-text-editor backend", lifespan=lifespan)

# ローカル専用アプリなので localhost からのアクセスを全許可
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 画像などワークスペース配下のファイル配信: /files/{workspace_id}/images/xxx.png
# StaticFiles はマウント時にディレクトリが固定されるため、ライブラリ切り替えに
# 対応できるよう動的に解決する。
@app.get("/files/{file_path:path}")
def serve_workspace_file(file_path: str) -> FileResponse:
    base = paths.workspace_files_dir().resolve()
    target = (base / file_path).resolve()
    if base not in target.parents:
        raise HTTPException(status_code=400, detail="invalid path")
    if not target.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    return FileResponse(target)


class WorkspaceCreate(BaseModel):
    name: str


class DocCreate(BaseModel):
    workspace_id: int
    title: str


class DocRename(BaseModel):
    title: str


class DocSaveRequest(BaseModel):
    content_json: Any
    content_md: str | None = None
    title: str | None = None


class DocDraftRequest(BaseModel):
    content_json: Any | None = None  # null でドラフトをクリア


class WorkspaceRename(BaseModel):
    name: str


class LlamaSwitchRequest(BaseModel):
    model_path: str


class LibraryPathRequest(BaseModel):
    path: str


class GenerateContinueRequest(BaseModel):
    doc_id: int | None = None  # 将来 RAG 文脈の取得に使う
    before: str
    after: str | None = None


class GenerateSectionRequest(BaseModel):
    doc_id: int | None = None
    instruction: str
    document_md: str | None = None
    use_rag: bool = False  # フェーズ 3 で実装。現状は無視される


class WebSearchRequest(BaseModel):
    query: str
    workspace_id: int | None = None  # 予約（検索履歴等で使用予定）
    max_results: int = 8


class WebIngestRequest(BaseModel):
    url: str
    workspace_id: int | None = None


class RagSearchRequest(BaseModel):
    query: str
    workspace_id: int | None = None
    top_k: int = 5


class RagIngestRequest(BaseModel):
    source_type: str  # 'article' | 'reference' | 'web'
    content: str
    workspace_id: int | None = None
    source_url: str | None = None


class NoteCreateRequest(BaseModel):
    workspace_id: int
    title: str = "無題"
    content: str = ""


class NoteUpdateRequest(BaseModel):
    title: str
    content: str


class ReviewInlineRequest(BaseModel):
    text: str
    context_before: str | None = None
    context_after: str | None = None
    strength: str = "medium"  # weak | medium | strong（校正の強さ）
    style: str = "keep"  # keep | polite | plain（文体）


class ReviewSplitRequest(BaseModel):
    blocks: list[str]
    outline: str | None = None
    strength: str = "medium"
    style: str = "keep"


class ChatMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    doc_id: int | None = None
    document_md: str | None = None  # 編集中の記事全文（文脈）
    selection: str | None = None  # ユーザーが選択している箇所（あれば）
    use_rag: bool = False  # 直近のユーザー発話で hybrid search して文脈に含める
    use_web: bool = False  # 直近のユーザー発話で Web 検索し、スニペットを文脈に含める


class NoteMergeRequest(BaseModel):
    content: str  # 既存ノートに統合したい新情報（Markdown）


class AssetCreate(BaseModel):
    workspace_id: int
    filename: str
    data_base64: str
    caption: str | None = None


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/system/resources")
def system_resources() -> dict[str, Any]:
    return system_stats.get_resources()


@app.post("/shutdown")
def shutdown() -> dict[str, bool]:
    """アプリ終了時に Electron から呼ばれる。

    追跡中の llama-server（gemma）を停止してから自身も終了する。
    外部起動（bat 等）の llama-server は殺さない。
    """

    def _exit() -> None:
        try:
            llm_manager.stop("gemma")
        finally:
            os._exit(0)

    threading.Timer(0.2, _exit).start()  # レスポンスを返してから終了する
    return {"ok": True}


class SettingsUpdate(BaseModel):
    theme: str | None = None
    editor_font_size: int | None = None
    tavily_api_key: str | None = None
    writing_model_path: str | None = None
    context_length: int | None = None
    review_system_prompt: str | None = None


@app.get("/settings")
def get_settings() -> dict[str, Any]:
    return settings_store.read()


@app.put("/settings")
def update_settings(body: SettingsUpdate) -> dict[str, Any]:
    return settings_store.update(body.model_dump(exclude_none=True))


@app.get("/prompts/defaults")
def prompt_defaults() -> dict[str, str]:
    """設定画面でプロンプトを編集するときの既定値（リセット用）。"""
    return {"review_system": prompts.REVIEW_SYSTEM}


@app.get("/workspaces")
def list_workspaces() -> list[dict[str, Any]]:
    return models.list_workspaces()


@app.post("/workspaces")
def create_workspace(body: WorkspaceCreate) -> dict[str, Any]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    return models.create_workspace(name)


@app.get("/workspaces/{workspace_id}/docs")
def list_docs(workspace_id: int) -> list[dict[str, Any]]:
    return models.list_docs(workspace_id)


@app.post("/docs")
def create_doc(body: DocCreate) -> dict[str, Any]:
    title = body.title.strip() or "無題"
    doc = models.create_doc(body.workspace_id, title)
    if doc is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    return doc


@app.get("/docs/{doc_id}")
def get_doc(doc_id: int) -> dict[str, Any]:
    doc = models.get_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    return doc


@app.put("/docs/{doc_id}")
def rename_doc(doc_id: int, body: DocRename) -> dict[str, bool]:
    title = body.title.strip() or "無題"
    if not models.update_doc(doc_id, title=title):
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.post("/docs/{doc_id}/save")
def save_doc(doc_id: int, body: DocSaveRequest) -> dict[str, bool]:
    """明示保存: 本文更新 + ドラフトクリア + リビジョン追加。"""
    ok = models.save_doc(
        doc_id, body.content_json, body.content_md, title=body.title
    )
    if not ok:
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.post("/docs/{doc_id}/draft")
def save_draft(doc_id: int, body: DocDraftRequest) -> dict[str, bool]:
    """ドラフト退避（クラッシュ・閉じ忘れ対策）。content_json=null でクリア。"""
    if not models.set_draft(doc_id, body.content_json):
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.get("/docs/{doc_id}/revisions")
def list_revisions(doc_id: int) -> list[dict[str, Any]]:
    return models.list_revisions(doc_id)


@app.get("/revisions/{revision_id}")
def get_revision(revision_id: int) -> dict[str, Any]:
    rev = models.get_revision(revision_id)
    if rev is None:
        raise HTTPException(status_code=404, detail="revision not found")
    return rev


@app.delete("/docs/{doc_id}")
def delete_doc(doc_id: int) -> dict[str, bool]:
    # 画像はワークスペース共有なので、文書削除ではファイルを消さない。
    if models.delete_doc(doc_id) is None:
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.put("/workspaces/{workspace_id}")
def rename_workspace(workspace_id: int, body: WorkspaceRename) -> dict[str, bool]:
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    if not models.update_workspace(workspace_id, name):
        raise HTTPException(status_code=404, detail="workspace not found")
    return {"ok": True}


@app.delete("/workspaces/{workspace_id}")
def delete_workspace(workspace_id: int) -> dict[str, bool]:
    if not models.delete_workspace(workspace_id):
        raise HTTPException(status_code=404, detail="workspace not found")
    rag_store.delete_workspace_data(workspace_id)
    shutil.rmtree(
        paths.workspace_files_dir() / str(workspace_id), ignore_errors=True
    )
    return {"ok": True}


def _library_state() -> dict[str, Any]:
    return {
        "active": library.get_active_path(),
        "libraries": library.list_libraries(),
    }


def _activate_library(path: Path) -> None:
    """ライブラリを差し替え、スキーマ初期化に成功したらレジストリへ記録する。"""
    previous = paths.library_root()
    paths.set_library_root(path)
    try:
        models.init_db()
        rag_store.init_rag_schema()
    except Exception:
        paths.set_library_root(previous)  # 壊れたライブラリへ向けたままにしない
        raise
    library.set_active(str(path))


@app.get("/library")
def get_library_state() -> dict[str, Any]:
    return _library_state()


@app.post("/library/switch")
def switch_library(body: LibraryPathRequest) -> dict[str, Any]:
    p = Path(body.path).expanduser()
    if not p.exists():
        raise HTTPException(status_code=404, detail="ライブラリのフォルダが見つかりません")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="ライブラリはフォルダを指定してください")
    _activate_library(p.resolve())
    return _library_state()


@app.post("/library/create")
def create_library(body: LibraryPathRequest) -> dict[str, Any]:
    p = Path(body.path).expanduser()
    if p.exists() and not p.is_dir():
        raise HTTPException(status_code=400, detail="同名のファイルが既に存在します")
    if (p / "lm-editor.sqlite3").exists():
        raise HTTPException(status_code=409, detail="そのフォルダには既にライブラリが存在します")
    p.mkdir(parents=True, exist_ok=True)
    _activate_library(p.resolve())
    return _library_state()


@app.get("/models/local")
def list_local_models() -> list[dict[str, Any]]:
    return llm_manager.list_local_models()


@app.get("/llama/status")
def llama_status() -> dict[str, Any]:
    return llm_manager.get_status("gemma")


@app.post("/llama/switch")
def llama_switch(body: LlamaSwitchRequest) -> dict[str, Any]:
    try:
        return llm_manager.start("gemma", body.model_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/llama/eject")
def llama_eject() -> dict[str, Any]:
    return llm_manager.stop("gemma")


@app.get("/embed/status")
def embed_status() -> dict[str, Any]:
    """埋め込みモデル（RAG 検索）の導入状態。"""
    return rag_embed.status()


@app.post("/embed/install")
def embed_install() -> dict[str, Any]:
    """埋め込みモデルを HF からダウンロードして常駐させる（バックグラウンド）。"""
    rag_embed.install_async()
    return rag_embed.status()


@app.post("/web/search")
async def web_search_endpoint(body: WebSearchRequest) -> dict[str, Any]:
    """Web 検索（文章用 LLM 起動時はクエリ分解あり）。"""
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    try:
        return await web_search.search(body.query, body.max_results)
    except ValueError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/web/ingest")
async def web_ingest_endpoint(body: WebIngestRequest) -> dict[str, Any]:
    """URL の本文を取り込み、原文チャンク + ソースノートを保存する。"""
    if not body.url.strip().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="http(s) の URL を指定してください")
    try:
        return await web_ingest.ingest_url(body.url.strip(), body.workspace_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"取得に失敗しました: {exc}")


async def _require_llm(task: str) -> dict:
    cfg = router.route(task)
    if not await llm_client.is_alive(cfg["base_url"]):
        raise HTTPException(
            status_code=503,
            detail="LLM サーバ (Gemma 4, :8080) に接続できません。start-llm.bat を起動してください。",
        )
    return cfg


@app.post("/rag/search")
def rag_search_endpoint(body: RagSearchRequest) -> dict[str, Any]:
    if not body.query.strip():
        raise HTTPException(status_code=400, detail="query is required")
    chunks = rag_search.hybrid_search(body.query, body.workspace_id, body.top_k)
    notes = rag_search.search_notes(body.query, body.workspace_id, body.top_k)
    return {"chunks": chunks, "notes": notes}


class RagSourceDeleteRequest(BaseModel):
    workspace_id: int
    source_type: str
    source_url: str | None = None


class RagSourceRenameRequest(BaseModel):
    workspace_id: int
    source_type: str
    source_url: str | None = None
    title: str


@app.get("/rag/sources")
def list_rag_sources(workspace_id: int) -> list[dict[str, Any]]:
    return rag_store.list_sources(workspace_id)


@app.post("/rag/sources/detail")
def rag_source_detail(body: RagSourceDeleteRequest) -> dict[str, Any]:
    """資料ビューア用: ソースの原文チャンクと要約ノートを返す。"""
    return rag_store.get_source_detail(
        body.workspace_id, body.source_type, body.source_url
    )


@app.post("/rag/sources/delete")
def delete_rag_source(body: RagSourceDeleteRequest) -> dict[str, Any]:
    deleted = rag_store.delete_source(
        body.workspace_id, body.source_type, body.source_url
    )
    return {"ok": True, "deleted_chunks": deleted}


@app.post("/rag/sources/rename")
def rename_rag_source(body: RagSourceRenameRequest) -> dict[str, Any]:
    """資料の表示名を変更する。手動ノートはタイトル、それ以外は表示ラベルを更新。"""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")
    if body.source_type == "note":
        if not (body.source_url or "").startswith("note://"):
            raise HTTPException(status_code=400, detail="invalid note source_url")
        try:
            rag_store.rename_note(int(body.source_url[len("note://"):]), title)
        except ValueError:
            raise HTTPException(status_code=404, detail="note not found")
    else:
        rag_store.set_source_label(
            body.workspace_id, body.source_type, body.source_url, title
        )
    return {"ok": True}


@app.post("/rag/ingest")
def rag_ingest_endpoint(body: RagIngestRequest) -> dict[str, Any]:
    if body.source_type not in ("article", "reference", "web"):
        raise HTTPException(status_code=400, detail="invalid source_type")
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="content is required")
    chunk_ids = rag_store.ingest(
        body.source_type,
        body.content,
        workspace_id=body.workspace_id,
        source_url=body.source_url,
    )
    return {"ok": True, "chunk_ids": chunk_ids}


@app.post("/rag/note")
def create_note_endpoint(body: NoteCreateRequest) -> dict[str, Any]:
    """編集可能な手動ノートを作成する（本文があればチャンク化して登録）。"""
    return rag_store.create_note(body.workspace_id, body.title.strip() or "無題", body.content)


@app.get("/rag/note/{note_id}")
def get_note_endpoint(note_id: int) -> dict[str, Any]:
    note = rag_store.get_note(note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    return note


@app.put("/rag/note/{note_id}")
def update_note_endpoint(note_id: int, body: NoteUpdateRequest) -> dict[str, Any]:
    """手動ノートの本文を更新し、チャンクを作り直す。"""
    try:
        return rag_store.update_note(note_id, body.title.strip() or "無題", body.content)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/rag/note/{note_id}/merge")
async def merge_note_endpoint(note_id: int, body: NoteMergeRequest) -> dict[str, Any]:
    """既存ノートに新情報を LLM で統合した Markdown を返す（保存はしない）。

    保存はフロントがプレビュー確認後に PUT /rag/note/{id} で行う（上書き事故防止）。
    """
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="content is required")
    note = rag_store.get_note(note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="note not found")
    cfg = await _require_llm("generate")
    raw = await llm_client.chat(
        cfg["base_url"],
        prompts.build_note_merge_messages(note["title"], note["content"], body.content),
        temperature=0.3,
        max_tokens=4096,
    )
    merged = think_parser.strip_think(raw)
    if not merged.strip():
        raise HTTPException(status_code=502, detail="LLM の統合結果が空でした")
    return {"note_id": note_id, "title": note["title"], "merged": merged}


@app.get("/rag/note/{note_id}/revisions")
def list_note_revisions_endpoint(note_id: int) -> list[dict[str, Any]]:
    """ノートの世代履歴（新しい順・メタのみ）。"""
    return rag_store.list_note_revisions(note_id)


@app.get("/rag/note/{note_id}/revisions/{revision_id}")
def get_note_revision_endpoint(note_id: int, revision_id: int) -> dict[str, Any]:
    rev = rag_store.get_note_revision(note_id, revision_id)
    if rev is None:
        raise HTTPException(status_code=404, detail="revision not found")
    return rev


@app.post("/generate/continue")
async def generate_continue(body: GenerateContinueRequest) -> StreamingResponse:
    """カーソル位置からの続き生成。Markdown を平文でストリーム返却。"""
    if not body.before.strip():
        raise HTTPException(status_code=400, detail="before is required")
    cfg = await _require_llm("generate")
    messages = prompts.build_continue_messages(body.before, body.after)
    return StreamingResponse(
        llm_client.stream_chat(
            cfg["base_url"], messages, temperature=cfg["temperature"], max_tokens=1024
        ),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/generate/section")
async def generate_section(body: GenerateSectionRequest) -> StreamingResponse:
    """指示からのセクション生成。Markdown を平文でストリーム返却。"""
    if not body.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction is required")
    cfg = await _require_llm("generate")

    rag_context: str | None = None
    if body.use_rag:
        workspace_id: int | None = None
        if body.doc_id is not None:
            doc = models.get_doc(body.doc_id)
            if doc:
                workspace_id = doc["workspace_id"]
        # 埋め込み計算はブロッキングなのでスレッドに逃がす
        results = await asyncio.to_thread(
            rag_search.hybrid_search, body.instruction, workspace_id, 5
        )
        rag_context = rag_search.build_rag_context(results) or None

    messages = prompts.build_section_messages(
        body.instruction, body.document_md, rag_context
    )
    return StreamingResponse(
        llm_client.stream_chat(
            cfg["base_url"], messages, temperature=cfg["temperature"], max_tokens=2048
        ),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/chat")
async def chat_endpoint(body: ChatRequest) -> StreamingResponse:
    """文書を文脈にしたマルチターン対話（レビュー・相談）。応答を平文でストリーム返却。

    RAG / Web 検索は use_rag / use_web のときだけ直近のユーザー発話で発火する（明示制御）。
    Web 検索はスニペットのみを文脈に使う（ページ取得・RAG 保存はしない。取り込みは
    Web 検索パネルの「取り込む」で明示的に行う）。function calling は未対応。
    """
    if not body.messages:
        raise HTTPException(status_code=400, detail="messages is required")
    cfg = await _require_llm("generate")

    history = [{"role": m.role, "content": m.content} for m in body.messages]
    query = next(
        (m["content"] for m in reversed(history) if m["role"] == "user"), ""
    )

    rag_context: str | None = None
    if body.use_rag:
        workspace_id: int | None = None
        if body.doc_id is not None:
            doc = models.get_doc(body.doc_id)
            if doc:
                workspace_id = doc["workspace_id"]
        if query.strip():
            results = await asyncio.to_thread(
                rag_search.hybrid_search, query, workspace_id, 5
            )
            rag_context = rag_search.build_rag_context(results) or None

    web_context: str | None = None
    web_sources: list[dict[str, Any]] = []
    web_queries: list[str] = []
    if body.use_web and query.strip():
        try:
            web = await web_search.search(query, max_results=6)
            web_sources = web["results"]
            web_queries = web["queries"]
            web_context = prompts.build_web_context(web_sources) or None
        except Exception as exc:
            # 検索失敗でチャット自体は止めない（検索なしで続行）
            logger.warning("chat web search failed: %s", exc)

    messages = prompts.build_chat_messages(
        history, body.document_md, body.selection, rag_context, web_context
    )

    async def gen():
        """Web 検索を使った場合はまず出典（{"sources": ...}）を 1 行流し、
        本文差分（{"delta": ...}）を逐次、最後に生成統計を
        {"done": true, tokens, elapsed, tps, finish_reason} で 1 行返す。"""
        if body.use_web:
            yield json.dumps(
                {
                    "sources": [
                        {"title": s["title"], "url": s["url"]} for s in web_sources
                    ],
                    "queries": web_queries,
                },
                ensure_ascii=False,
            ) + "\n"
        start = time.perf_counter()
        finish_reason: str | None = None
        usage: dict[str, Any] | None = None
        timings: dict[str, Any] | None = None
        try:
            async for chunk in llm_client.stream_chat_events(
                cfg["base_url"], messages, temperature=cfg["temperature"], max_tokens=2048
            ):
                choices = chunk.get("choices") or []
                if choices:
                    delta = choices[0].get("delta", {}).get("content")
                    if delta:
                        yield json.dumps({"delta": delta}, ensure_ascii=False) + "\n"
                    if choices[0].get("finish_reason"):
                        finish_reason = choices[0]["finish_reason"]
                if chunk.get("usage"):
                    usage = chunk["usage"]
                if chunk.get("timings"):
                    timings = chunk["timings"]
        except Exception as exc:
            # ストリーム開始後は HTTP エラーを返せないため、エラーも NDJSON の 1 行で
            # 返す（黙って切断するとフロントには "network error" しか見えない）
            logger.exception("chat streaming failed")
            yield json.dumps({"error": str(exc)}, ensure_ascii=False) + "\n"
            return

        elapsed = time.perf_counter() - start
        tokens = (usage or {}).get("completion_tokens")
        tps: float | None = None
        # llama.cpp の timings があれば実デコード速度を優先（tok/sec）
        if timings:
            if timings.get("predicted_n"):
                tokens = timings["predicted_n"]
            if timings.get("predicted_ms"):
                elapsed = timings["predicted_ms"] / 1000
            if timings.get("predicted_per_second"):
                tps = timings["predicted_per_second"]
        if tps is None and tokens and elapsed > 0:
            tps = tokens / elapsed
        # コンテキスト使用量: プロンプト（履歴+文脈）+ 応答 = このターン後の消費トークン
        prompt_tokens = (usage or {}).get("prompt_tokens")
        if timings and timings.get("prompt_n"):
            prompt_tokens = timings["prompt_n"]
        context_tokens: int | None = None
        if prompt_tokens is not None and tokens is not None:
            context_tokens = prompt_tokens + tokens
        elif usage and usage.get("total_tokens"):
            context_tokens = usage["total_tokens"]
        yield json.dumps(
            {
                "done": True,
                "tokens": tokens,
                "elapsed": round(elapsed, 2),
                "tps": round(tps, 1) if tps else None,
                "finish_reason": finish_reason,
                "context_tokens": context_tokens,
                "context_length": llm_manager._context_length(),
            },
            ensure_ascii=False,
        ) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson; charset=utf-8")


@app.post("/review/inline")
async def review_inline(body: ReviewInlineRequest) -> StreamingResponse:
    """選択範囲 / 単一段落のインライン校正。校正後テキストを平文でストリーム返却。"""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    cfg = await _require_llm("review")
    messages = prompts.build_review_messages(
        body.text,
        body.context_before,
        body.context_after,
        strength=body.strength,
        style=body.style,
    )
    return StreamingResponse(
        llm_client.stream_chat(
            cfg["base_url"], messages, temperature=cfg["temperature"]
        ),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/review/split")
async def review_split(body: ReviewSplitRequest) -> StreamingResponse:
    """段落を超える範囲の校正。段落ごとに校正し、完了した段落から
    NDJSON（{"index": i, "revised": "..."}）でストリーム返却する。"""
    if not body.blocks:
        raise HTTPException(status_code=400, detail="blocks is required")
    cfg = await _require_llm("review")

    async def gen():
        for i, text in enumerate(body.blocks):
            if not text.strip():
                yield json.dumps({"index": i, "revised": text}, ensure_ascii=False) + "\n"
                continue
            messages = prompts.build_review_messages(
                text,
                context_before=body.blocks[i - 1] if i > 0 else None,
                context_after=body.blocks[i + 1] if i + 1 < len(body.blocks) else None,
                outline=body.outline,
                strength=body.strength,
                style=body.style,
            )
            parts: list[str] = []
            async for chunk in llm_client.stream_chat(
                cfg["base_url"], messages, temperature=cfg["temperature"]
            ):
                parts.append(chunk)
            yield json.dumps(
                {"index": i, "revised": "".join(parts).strip()}, ensure_ascii=False
            ) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson; charset=utf-8")


@app.get("/workspaces/{workspace_id}/images")
def list_workspace_images(workspace_id: int) -> list[dict[str, Any]]:
    images = models.list_workspace_images(workspace_id)
    for img in images:
        img["url"] = f"/files/{workspace_id}/{img['rel_path']}"
    return images


@app.delete("/assets/{asset_id}")
def delete_asset(asset_id: int) -> dict[str, bool]:
    info = models.delete_asset(asset_id)
    if info is None:
        raise HTTPException(status_code=404, detail="asset not found")
    target = (
        paths.workspace_files_dir() / str(info["workspace_id"]) / info["rel_path"]
    ).resolve()
    if paths.workspace_files_dir().resolve() in target.parents and target.is_file():
        target.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/assets")
def create_asset(body: AssetCreate) -> dict[str, Any]:
    if models.get_workspace(body.workspace_id) is None:
        raise HTTPException(status_code=404, detail="workspace not found")
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid base64 data")

    ext = Path(body.filename).suffix.lower() or ".png"
    name = f"{uuid.uuid4().hex}{ext}"
    workspace_id = body.workspace_id
    rel_path = f"images/{name}"

    img_dir = paths.workspace_files_dir() / str(workspace_id) / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / name).write_bytes(data)

    # ディスク上は UUID 名。元ファイル名を表示名の初期値として保持する。
    display_name = Path(body.filename).name or None
    asset = models.create_asset(workspace_id, rel_path, display_name, body.caption)
    return {**asset, "url": f"/files/{workspace_id}/{rel_path}"}


class AssetRename(BaseModel):
    display_name: str


@app.post("/assets/{asset_id}/rename")
def rename_asset(asset_id: int, body: AssetRename) -> dict[str, bool]:
    name = body.display_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="display_name is required")
    if not models.rename_asset(asset_id, name):
        raise HTTPException(status_code=404, detail="asset not found")
    return {"ok": True}
