"""FastAPI エントリ（spec.md §10 のワークスペース / 文書 / 画像 API）。

起動: .venv\\Scripts\\python.exe -m uvicorn backend.main:app --port 8000
"""

import base64
import binascii
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.db import models


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
