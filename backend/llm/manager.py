"""llama-server の subprocess 管理（lm-chat の llama_manager を簡略移植）。

- models/ 配下の GGUF を列挙し、選択したモデルで llama-server (:8080) を起動する。
- PID を data/llama_runtime.json に記録し、切替・停止時は PID を検証してから kill する
  （PID 再利用や外部起動の llama-server を誤って殺さないため）。
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

from backend import config
from backend.db.models import DATA_DIR

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[2]
LLAMA_EXE = ROOT_DIR / "runtime" / "llama.cpp" / "llama-server.exe"
MODELS_DIR = ROOT_DIR / "models"
STATE_FILE = DATA_DIR / "llama_runtime.json"

LLAMA_HOST = "127.0.0.1"
LLAMA_PORT = int(config.GEMMA_BASE_URL.rsplit(":", 1)[-1].split("/")[0])
HEALTH_URL = f"http://{LLAMA_HOST}:{LLAMA_PORT}/health"

# Gemma 4 は reasoning モデルのため --reasoning-budget 0 必須（CLAUDE.md 参照）
SERVER_ARGS = [
    "--host", LLAMA_HOST,
    "--port", str(LLAMA_PORT),
    "-ngl", "99",
    "-c", "16384",
    "--jinja",
    "--reasoning-budget", "0",
]


def _load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text("utf-8"))
        except Exception as exc:
            logger.warning("failed to read %s: %s", STATE_FILE, exc)
    return {}


def _save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, ensure_ascii=False), "utf-8")


def list_local_models() -> list[dict[str, Any]]:
    """models/ 配下の GGUF 一覧（mmproj と埋め込みキャッシュは除外）。"""
    result = []
    if not MODELS_DIR.exists():
        return result
    for p in sorted(MODELS_DIR.rglob("*.gguf")):
        name = p.name.lower()
        if "mmproj" in name or "embeddings" in [x.lower() for x in p.parts]:
            continue
        result.append(
            {
                "id": p.stem,
                "path": str(p),
                "size_bytes": p.stat().st_size,
            }
        )
    return result


def _pid_is_llama_server(pid: int) -> bool:
    """tasklist で PID のプロセス名を検証する（PID 再利用対策）。"""
    try:
        out = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
        return "llama-server" in out.lower()
    except Exception:
        return False


def _health() -> str:
    """'ready' | 'loading' | 'down' を返す。"""
    try:
        res = httpx.get(HEALTH_URL, timeout=2)
        return "ready" if res.status_code == 200 else "loading"
    except httpx.HTTPError:
        return "down"


def _kill_tracked() -> None:
    state = _load_state()
    pid = state.get("pid")
    if isinstance(pid, int) and pid > 0:
        if _pid_is_llama_server(pid):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True
            )
            logger.info("killed tracked llama-server pid=%s", pid)
        state["pid"] = None
        _save_state(state)
    elif _health() != "down":
        # 追跡外（start-llm.bat 等で外部起動）の llama-server は殺さない
        logger.warning("untracked llama-server is running; skip kill")


def get_status() -> dict[str, Any]:
    state = _load_state()
    health = _health()
    pid = state.get("pid")
    tracked = isinstance(pid, int) and pid > 0 and _pid_is_llama_server(pid)

    if health == "down":
        if tracked:
            # プロセスは生きているがポート未オープン（起動直後）
            status = "loading"
        else:
            status = "stopped"
            if pid:  # クラッシュ等で消えた stale PID を掃除
                state["pid"] = None
                state["active_model_path"] = None
                _save_state(state)
    else:
        status = health  # ready / loading

    return {
        "status": status,  # 'stopped' | 'loading' | 'ready'
        "active_model_path": state.get("active_model_path") if (tracked or health != "down") else None,
        "external": health != "down" and not tracked,
    }


def switch_model(model_path: str) -> dict[str, Any]:
    p = Path(model_path).resolve()
    if not p.exists():
        raise ValueError(f"モデルが見つかりません: {model_path}")
    if MODELS_DIR.resolve() not in p.parents:
        raise ValueError("models/ 配下のモデルのみ指定できます")
    if not LLAMA_EXE.exists():
        raise ValueError(f"llama-server が見つかりません: {LLAMA_EXE}")

    status = get_status()
    if status["external"]:
        raise ValueError(
            "外部起動の llama-server が :8080 で稼働中です。先にそちらを停止してください。"
        )

    _kill_tracked()
    time.sleep(1)

    cmd = [str(LLAMA_EXE), "-m", str(p), *SERVER_ARGS]
    mmproj = next(
        (c for c in p.parent.glob("*.gguf") if "mmproj" in c.name.lower()), None
    )
    if mmproj:
        cmd += ["--mmproj", str(mmproj)]

    logger.info("starting llama-server: %s", p.name)
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    time.sleep(1.5)
    if proc.poll() is not None:
        raise ValueError(
            "llama-server の起動に失敗しました（ポート競合または引数エラーの可能性）"
        )

    _save_state({"pid": proc.pid, "active_model_path": str(p)})
    return {"status": "loading", "active_model_path": str(p)}


def eject_model() -> dict[str, Any]:
    _kill_tracked()
    _save_state({"pid": None, "active_model_path": None})
    return {"status": "stopped"}
