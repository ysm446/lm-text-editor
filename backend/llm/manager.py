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

# 思考モード ON のとき max_tokens に足す猶予。思考が本文ぶんの上限を食い潰して
# content が空になるのを防ぐ（CLAUDE.md の reasoning-budget の教訓と同じ話）
THINK_HEADROOM = 4096


def _context_length() -> int:
    """設定のコンテキスト長を許可値にスナップして返す。"""
    try:
        n = int(settings_store.read().get("context_length") or DEFAULT_CONTEXT_LENGTH)
    except (TypeError, ValueError):
        return DEFAULT_CONTEXT_LENGTH
    return n if n in CONTEXT_LENGTHS else DEFAULT_CONTEXT_LENGTH


def thinking_enabled() -> bool:
    """設定の思考モード（reasoning）。llama-server 起動時の引数に反映する。"""
    return bool(settings_store.read().get("thinking_enabled"))


def _running_slot_state(slot: str = "gemma") -> dict[str, Any]:
    return _load_state().get(slot) or {}


def max_tokens_for(base: int) -> int:
    """思考モードなら思考ぶんの猶予を足した max_tokens を返す。

    思考の有無は起動引数で決まりサーバ再起動まで変わらないため、設定値ではなく
    「今動いているサーバがどちらで起動されたか」（state の記録）を優先する。
    設定を OFF に変えた直後でも、稼働中サーバが思考 ON なら猶予を落とさない
    （落とすと思考が max_tokens を食い潰して content が空になる）。
    外部起動などで記録が無い場合は設定値にフォールバックする。
    """
    running = _running_slot_state().get("thinking")
    thinking = running if isinstance(running, bool) else thinking_enabled()
    return base + THINK_HEADROOM if thinking else base


def running_context_length() -> int:
    """稼働中サーバが実際に起動された -c 値（フロントの使用率ゲージの分母）。

    設定変更後・未再起動のサーバでは設定値と実値が乖離するため state の記録を
    優先し、外部起動などで記録が無い場合は設定値にフォールバックする。
    """
    ctx = _running_slot_state().get("context_length")
    return ctx if isinstance(ctx, int) and ctx > 0 else _context_length()


def _reasoning_args(thinking: bool) -> list[str]:
    """思考モードに対応する llama-server の引数。

    Gemma 4 のテンプレートは `enable_thinking` で思考の有無が決まり、llama.cpp は
    `--reasoning-budget 0` / `--reasoning off` からその値を作る。リクエスト側の
    `chat_template_kwargs` では上書きできない（実測）ため、起動引数で決める。
    ON のときは思考を content ではなく `reasoning_content` に分離させる
    （本文・校正結果に思考が混ざらないようにする）。
    """
    if thinking:
        return ["--reasoning", "on", "--reasoning-format", "deepseek"]
    return ["--reasoning-budget", "0"]


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
        # -c（コンテキスト長）と思考モードの引数は設定値から start() で付与する
        "args": ["-ngl", "99", "--jinja"],
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


def _pid_on_port(port: int) -> int | None:
    """指定ポートを LISTEN している TCP プロセスの PID（netstat）。"""
    try:
        out = subprocess.run(
            ["netstat", "-ano", "-p", "TCP"], capture_output=True, text=True, timeout=10
        ).stdout
    except Exception:
        return None
    for line in out.splitlines():
        parts = line.split()
        # 例: TCP  127.0.0.1:8080  0.0.0.0:0  LISTENING  35428
        if len(parts) >= 5 and parts[0] == "TCP" and parts[3].upper() == "LISTENING":
            if parts[1].endswith(f":{port}"):
                try:
                    return int(parts[-1])
                except ValueError:
                    continue
    return None


def _stop_on_port(port: int) -> bool:
    """指定ポートの llama-server を停止する（PID をプロセス名で検証してから kill）。

    外部起動（bat 等）や追跡が切れた居残りサーバをアプリから引き取って停止するため。
    プロセス名が llama-server でなければ何もしない（別アプリを誤って殺さない）。
    """
    pid = _pid_on_port(port)
    if pid and _pid_is_llama_server(pid):
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(pid)], capture_output=True)
        logger.info("stopped llama-server on port %s pid=%s", port, pid)
        return True
    return False


def _query_loaded_model(port: int) -> str | None:
    """稼働中の llama-server が読み込んでいるモデルのパス（/v1/models）。"""
    try:
        res = httpx.get(f"http://127.0.0.1:{port}/v1/models", timeout=2)
        if res.status_code != 200:
            return None
        items = res.json().get("data") or res.json().get("models") or []
        if items:
            return items[0].get("id") or items[0].get("name")
    except Exception:
        return None
    return None


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
                slot_state["thinking"] = None
                slot_state["context_length"] = None
                state[slot] = slot_state
                _save_state(state)
    else:
        status = health

    external = health != "down" and not tracked
    active = slot_state.get("active_model_path") if (tracked or health != "down") else None
    # 外部起動サーバは state にパスが無いので、稼働中のモデルを直接問い合わせて表示に使う
    if external and not active:
        active = _query_loaded_model(spec["port"])
    # 稼働中サーバの思考モード。外部起動 / 停止中は不明（None）
    running_thinking = slot_state.get("thinking") if (tracked and status != "stopped") else None
    return {
        "status": status,  # 'stopped' | 'loading' | 'ready'
        "active_model_path": active,
        "external": external,
        "thinking": running_thinking if isinstance(running_thinking, bool) else None,
        "settings_thinking": thinking_enabled(),
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

    # 追跡中サーバを停止。外部起動（追跡外）が自ポートに居座っている場合も引き取って停止する
    _kill_tracked(slot)
    if get_status(slot)["external"]:
        _stop_on_port(spec["port"])
    time.sleep(1)

    thinking = thinking_enabled()
    context_length = _context_length()
    cmd = [
        str(LLAMA_EXE),
        "-m", str(p),
        "--host", "127.0.0.1",
        "--port", str(spec["port"]),
        "-c", str(context_length),
        *spec["args"],
        *_reasoning_args(thinking),
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
    # thinking は「今動いているサーバがどちらで起動されたか」の記録（設定変更後に
    # 再起動が必要かを UI で知らせるために使う）
    state[slot] = {
        "pid": proc.pid,
        "active_model_path": str(p),
        "thinking": thinking,
        "context_length": context_length,
    }
    _save_state(state)
    return {"status": "loading", "active_model_path": str(p), "thinking": thinking}


def stop(slot: str, takeover: bool = True) -> dict[str, Any]:
    """スロットの llama-server を停止する。

    takeover=True（UI からの明示アンロード）は、追跡が切れて居残った /
    外部起動の llama-server も引き取って停止する。
    takeover=False（アプリ終了時の後片付け等）は追跡中のサーバだけを止め、
    外部起動（bat 等）のサーバには触らない。
    """
    _kill_tracked(slot)
    if takeover:
        _stop_on_port(SLOTS[slot]["port"])
    state = _load_state()
    state[slot] = {
        "pid": None,
        "active_model_path": None,
        "thinking": None,
        "context_length": None,
    }
    _save_state(state)
    return {"status": "stopped"}


# --- 後方互換ラッパ（gemma スロット） ---

def switch_model(model_path: str) -> dict[str, Any]:
    return start("gemma", model_path)


def eject_model() -> dict[str, Any]:
    return stop("gemma")
