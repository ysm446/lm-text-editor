"""ライブラリレジストリ（アクティブ / 最近開いた一覧）の管理（lm-chat 流用）。

レジストリはどのライブラリにも属さないマシンレベルのファイル。
Store の再初期化（スキーマ作成）はルート層（main.py）が行う。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend import paths

_MAX_RECENT = 20


def _read_registry() -> dict[str, Any]:
    try:
        data = json.loads(paths.library_registry_path().read_text("utf-8"))
        if isinstance(data, dict):
            data.setdefault("active", "")
            data.setdefault("recent", [])
            return data
    except Exception:
        pass
    return {"active": "", "recent": []}


def _save_registry(reg: dict[str, Any]) -> None:
    p = paths.library_registry_path()
    p.write_text(json.dumps(reg, indent=2, ensure_ascii=False), "utf-8")


def get_active_path() -> str:
    reg = _read_registry()
    active = reg.get("active") or str(paths.default_library())
    return str(Path(active).resolve())


def set_active(path: str) -> str:
    resolved = Path(path).expanduser().resolve()
    resolved.mkdir(parents=True, exist_ok=True)
    path_str = str(resolved)
    reg = _read_registry()
    reg["active"] = path_str
    recent = [p for p in reg.get("recent", []) if p != path_str]
    recent.insert(0, path_str)
    reg["recent"] = recent[:_MAX_RECENT]
    _save_registry(reg)
    return path_str


def list_libraries() -> list[dict[str, Any]]:
    reg = _read_registry()
    active = get_active_path()
    entries: list[str] = list(reg.get("recent", []))
    if active not in entries:
        entries.insert(0, active)
    result: list[dict[str, Any]] = []
    for raw in entries:
        p = Path(raw)
        result.append(
            {
                "path": str(p),
                "name": p.name or str(p),
                "exists": p.exists(),
                "active": (str(p.resolve()) == active) if p.exists() else (raw == active),
            }
        )
    return result
