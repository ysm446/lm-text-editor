"""FastAPI エントリ（spec.md §10 のワークスペース / 文書 / 画像 API）。

起動: .venv\\Scripts\\python.exe -m uvicorn backend.main:app --port 8000
"""

import base64
import binascii
import json
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend import router
from backend.db import models
from backend.llm import client as llm_client
from backend.llm import manager as llm_manager
from backend.llm import prompts


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    models.init_db()
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
models.WORKSPACE_FILES_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=models.WORKSPACE_FILES_DIR), name="files")


class WorkspaceCreate(BaseModel):
    name: str


class DocCreate(BaseModel):
    workspace_id: int
    title: str


class DocUpdate(BaseModel):
    content_json: Any | None = None
    content_md: str | None = None
    title: str | None = None


class LlamaSwitchRequest(BaseModel):
    model_path: str


class GenerateContinueRequest(BaseModel):
    doc_id: int | None = None  # 将来 RAG 文脈の取得に使う
    before: str
    after: str | None = None


class GenerateSectionRequest(BaseModel):
    doc_id: int | None = None
    instruction: str
    document_md: str | None = None
    use_rag: bool = False  # フェーズ 3 で実装。現状は無視される


class ReviewInlineRequest(BaseModel):
    text: str
    context_before: str | None = None
    context_after: str | None = None


class ReviewSplitRequest(BaseModel):
    blocks: list[str]
    outline: str | None = None


class AssetCreate(BaseModel):
    document_id: int
    filename: str
    data_base64: str
    caption: str | None = None


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True}


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
def update_doc(doc_id: int, body: DocUpdate) -> dict[str, bool]:
    ok = models.update_doc(
        doc_id,
        content_json=body.content_json,
        content_md=body.content_md,
        title=body.title,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="document not found")
    return {"ok": True}


@app.get("/models/local")
def list_local_models() -> list[dict[str, Any]]:
    return llm_manager.list_local_models()


@app.get("/llama/status")
def llama_status() -> dict[str, Any]:
    return llm_manager.get_status()


@app.post("/llama/switch")
def llama_switch(body: LlamaSwitchRequest) -> dict[str, Any]:
    try:
        return llm_manager.switch_model(body.model_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/llama/eject")
def llama_eject() -> dict[str, Any]:
    return llm_manager.eject_model()


async def _require_llm(task: str) -> dict:
    cfg = router.route(task)
    if not await llm_client.is_alive(cfg["base_url"]):
        raise HTTPException(
            status_code=503,
            detail="LLM サーバ (Gemma 4, :8080) に接続できません。start-llm.bat を起動してください。",
        )
    return cfg


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
    messages = prompts.build_section_messages(body.instruction, body.document_md)
    return StreamingResponse(
        llm_client.stream_chat(
            cfg["base_url"], messages, temperature=cfg["temperature"], max_tokens=2048
        ),
        media_type="text/plain; charset=utf-8",
    )


@app.post("/review/inline")
async def review_inline(body: ReviewInlineRequest) -> StreamingResponse:
    """選択範囲 / 単一段落のインライン校正。校正後テキストを平文でストリーム返却。"""
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text is required")
    cfg = await _require_llm("review")
    messages = prompts.build_review_messages(
        body.text, body.context_before, body.context_after
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


@app.post("/assets")
def create_asset(body: AssetCreate) -> dict[str, Any]:
    doc = models.get_doc(body.document_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="document not found")
    try:
        data = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="invalid base64 data")

    ext = Path(body.filename).suffix.lower() or ".png"
    name = f"{uuid.uuid4().hex}{ext}"
    workspace_id = doc["workspace_id"]
    rel_path = f"images/{name}"

    img_dir = models.WORKSPACE_FILES_DIR / str(workspace_id) / "images"
    img_dir.mkdir(parents=True, exist_ok=True)
    (img_dir / name).write_bytes(data)

    asset = models.create_asset(body.document_id, rel_path, body.caption)
    return {**asset, "url": f"/files/{workspace_id}/{rel_path}"}
