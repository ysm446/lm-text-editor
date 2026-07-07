"""アプリ設定（マシンレベル: ~/.lm-text-editor/settings.json）の読み書き。

テーマなど UI 設定と、Tavily API キーのような環境依存の値を置く。
ライブラリ側（作品データ）には属さない。
"""

from __future__ import annotations

import json
from typing import Any

from backend import paths

DEFAULTS: dict[str, Any] = {
    "theme": "light",
    "editor_font_size": 16,
    "tavily_api_key": "",
}


def read() -> dict[str, Any]:
    settings = dict(DEFAULTS)
    try:
        data = json.loads((paths.machine_root() / "settings.json").read_text("utf-8"))
        if isinstance(data, dict):
            settings.update(data)
    except Exception:
        pass
    return settings


def update(patch: dict[str, Any]) -> dict[str, Any]:
    current = read()
    current.update(patch)
    (paths.machine_root() / "settings.json").write_text(
        json.dumps(current, indent=2, ensure_ascii=False), "utf-8"
    )
    return current
