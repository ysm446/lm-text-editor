"""llama-server の subprocess 管理（gemma スロット :8080 のみ）。

- gemma スロット: models/ から選んだ GGUF を :8080 に起動（執筆・校正・画像・検索）。
  検索・要約も文章用 LLM に一本化したため、検索専用スロットは持たない。
- PID を ~/.lm-text-editor/llama_runtime.json に記録し、kill 前に tasklist で
  プロセス名検証（PID 再利用や外部起動の誤殺防止）。
"""

from __future__ import annotations

import json
import logging
import subprocess
import time
from pathlib import Path
from typing import Any

import httpx

from backend import config, paths, settings_store

logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).resolve().parents[2]
LLAMA_EXE = ROOT_DIR / "runtime" / "llama.cpp" / "llama-server.exe"
MODELS_DIR = ROOT_DIR / "models"

# コンテキスト長（-c）の選択肢。設定のスライダーと対応（4k〜256k）
CONTEXT_LENGTHS = [4096, 8192, 16384, 32768, 65536, 131072, 262144]
DEFAULT_CONTEXT_LENGTH = 16384


def _context_length() -> int:
    """設定のコンテキスト長を許可値にスナップして返す。"""
    try:
        n = int(settings_store.read().get("context_length") or DEFAULT_CONTEXT_LENGTH)
    except (TypeError, ValueError):
        return DEFAULT_CONTEXT_LENGTH
    return n if n in CONTEXT_LENGTHS else DEFAULT_CONTEXT_LENGTH


def resolve_slot_model(slot: str) -> Path | None:
    """設定からスロットの既定モデルを解決する。"""
    settings = settings_store.read()
    if slot == "gemma":
        p = settings.get("writing_model_path") or ""
        return Path(p) if p else None
    return None


def _port_of(base_url: str) -> int:
    return int(base_url.rsplit(":", 1)[-1].split("/")[0])


SLOTS: dict[str, dict[str, Any]] = {
    "gemma": {
        "port": _port_of(config.GEMMA_BASE_URL),
        # Gemma 4 は reasoning モデルのため --reasoning-budget 0 必須（CLAUDE.md 参照）。
        # -c（コンテキスト長）は設定値を start() で付与する
        "args": ["-ngl", "99", "--jinja", "--reasoning-budget", "0"],
    },
}


def _load_state() -> dict[str, Any]:
    state_file = paths.llama_runtime_path()
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text("utf-8"))
            # 旧形式（フラット = gemma のみ）からの移行
            if "pid" in state or "active_model_path" in state:
                state = {"gemma": state}
            return state
        except Exception as exc:
            logger.warning("failed to read %s: %s", state_file, exc)
    return {}


def _save_state(state: dict[str, Any]) -> None:
    paths.llama_runtime_path().write_text(
        json.dumps(state, indent=2, ensure_ascii=False), "utf-8"
    )


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


def _health(port: int) -> str:
    """'ready' | 'loading' | 'down' を返す。"""
    try:
        res = httpx.get(f"http://127.0.0.1:{port}/health", timeout=2)
        return "ready" if res.status_code == 200 else "loading"
    except httpx.HTTPError:
        return "down"


def _kill_tracked(slot: str) -> None:
    state = _load_state()
    slot_state = state.get(slot) or {}
    pid = slot_state.get("pid")
    if isinstance(pid, int) and pid > 0:
        if _pid_is_llama_server(pid):
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True
            )
            logger.info("killed tracked llama-server (%s) pid=%s", slot, pid)
        slot_state["pid"] = None
        state[slot] = slot_state
        _save_state(state)
    elif _health(SLOTS[slot]["port"]) != "down":
        # 追跡外（bat 等で外部起動）の llama-server は殺さない
        logger.warning("untracked llama-server on port %s; skip kill", SLOTS[slot]["port"])


def get_status(slot: str) -> dict[str, Any]:
    spec = SLOTS[slot]
    state = _load_state()
    slot_state = state.get(slot) or {}
    health = _health(spec["port"])
    pid = slot_state.get("pid")
    tracked = isinstance(pid, int) and pid > 0 and _pid_is_llama_server(pid)

    if health == "down":
        if tracked:
            status = "loading"  # プロセスは生きているがポート未オープン（起動直後）
        else:
            status = "stopped"
            if pid:  # クラッシュ等で消えた stale PID を掃除
                slot_state["pid"] = None
                slot_state["active_model_path"] = None
                state[slot] = slot_state
                _save_state(state)
    else:
        status = health

    return {
        "status": status,  # 'stopped' | 'loading' | 'ready'
        "active_model_path": slot_state.get("active_model_path")
        if (tracked or health != "down")
        else None,
        "external": health != "down" and not tracked,
    }


def start(slot: str, model_path: str | None = None) -> dict[str, Any]:
    spec = SLOTS[slot]
    if model_path is None:
        resolved = resolve_slot_model(slot)
        if resolved is None:
            raise ValueError("モデルが選択されていません（設定画面またはモデルバーで選択してください）")
        p = resolved.resolve()
    else:
        p = Path(model_path).resolve()
    if MODELS_DIR.resolve() not in p.parents:
        raise ValueError("models/ 配下のモデルのみ指定できます")
    if not p.exists():
        raise ValueError(f"モデルが見つかりません: {p}")
    if not LLAMA_EXE.exists():
        raise ValueError(f"llama-server が見つかりません: {LLAMA_EXE}")

    status = get_status(slot)
    if status["external"]:
        raise ValueError(
            f"外部起動の llama-server が :{spec['port']} で稼働中です。先にそちらを停止してください。"
        )

    _kill_tracked(slot)
    time.sleep(1)

    cmd = [
        str(LLAMA_EXE),
        "-m", str(p),
        "--host", "127.0.0.1",
        "--port", str(spec["port"]),
        "-c", str(_context_length()),
        *spec["args"],
    ]
    mmproj = next(
        (c for c in p.parent.glob("*.gguf") if "mmproj" in c.name.lower()), None
    )
    if mmproj:
        cmd += ["--mmproj", str(mmproj)]

    logger.info("starting llama-server (%s): %s", slot, p.name)
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

    state = _load_state()
    state[slot] = {"pid": proc.pid, "active_model_path": str(p)}
    _save_state(state)
    return {"status": "loading", "active_model_path": str(p)}


def stop(slot: str) -> dict[str, Any]:
    _kill_tracked(slot)
    state = _load_state()
    state[slot] = {"pid": None, "active_model_path": None}
    _save_state(state)
    return {"status": "stopped"}


# --- 後方互換ラッパ（gemma スロット） ---

def switch_model(model_path: str) -> dict[str, Any]:
    return start("gemma", model_path)


def eject_model() -> dict[str, Any]:
    return stop("gemma")
