"""アプリ内のすべてのデータパスを解決する単一の窓口（lm-chat の paths.py を流用）。

パスの所属を 2 種類に分ける:

- **ライブラリ側** (`library_*` / `db_path` / `workspace_files_dir`): 切り替え単位。
  フォルダごとコピー/バックアップできる。DB（文書・RAG）とワークスペースの画像。
- **マシン側** (`machine_*` / `llama_runtime_path`): アプリ/マシン共通。
  ライブラリを切り替えても不変（ライブラリレジストリ、llama-server の PID 記録）。

呼び出し側は必ず関数経由でパスを取得すること
（import 時に固定するとライブラリ切り替えが効かなくなる）。
"""

from __future__ import annotations

import json
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent

# 既定ライブラリ（レジストリ未設定時の後方互換の帰り先）
_DEFAULT_LIBRARY = _REPO_ROOT / "data"

# マシンレベルのルート（どのライブラリにも属さない）
_MACHINE_ROOT = Path.home() / ".lm-text-editor"

# アクティブなライブラリのルート。初回呼び出し時にレジストリから遅延解決する。
_library_root: Path | None = None


# --- マシン側 ---

def machine_root() -> Path:
    _MACHINE_ROOT.mkdir(parents=True, exist_ok=True)
    return _MACHINE_ROOT


def library_registry_path() -> Path:
    """アクティブライブラリと最近開いた一覧のレジストリ。"""
    return machine_root() / "libraries.json"


def llama_runtime_path() -> Path:
    """llama-server の PID / アクティブモデルの記録（マシン固有）。"""
    return machine_root() / "llama_runtime.json"


# --- ライブラリ側 ---

def default_library() -> Path:
    return _DEFAULT_LIBRARY


def _resolve_active_library() -> Path:
    """レジストリの active を読み、無効なら既定ライブラリへフォールバック。"""
    try:
        reg = json.loads(library_registry_path().read_text("utf-8"))
        active = reg.get("active")
        if active:
            candidate = Path(active)
            if candidate.exists():
                return candidate.resolve()
    except Exception:
        pass
    return _DEFAULT_LIBRARY


def set_library_root(path: str | Path) -> None:
    """アクティブなライブラリのルートを差し替える（切り替え用）。"""
    global _library_root
    _library_root = Path(path).resolve()


def library_root() -> Path:
    global _library_root
    if _library_root is None:
        _library_root = _resolve_active_library()
    _library_root.mkdir(parents=True, exist_ok=True)
    return _library_root


def db_path() -> Path:
    return library_root() / "lm-editor.sqlite3"


def workspace_files_dir() -> Path:
    return library_root() / "workspaces"
