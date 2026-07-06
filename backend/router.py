"""タスク → モデルの振り分け（spec.md §7）。

モデル同士は直接連携しない。タスク名で接続先とパラメータを引く。
"""

from typing import TypedDict

from backend import config


class Route(TypedDict):
    base_url: str
    temperature: float


TASK_ROUTES: dict[str, Route] = {
    # 執筆（続き生成・セクション生成）: Gemma 4
    "generate": {"base_url": config.GEMMA_BASE_URL, "temperature": 0.7},
    # 校正（インライン / 分割）: Gemma 4。忠実さ優先で低め
    "review": {"base_url": config.GEMMA_BASE_URL, "temperature": 0.3},
    # 画像理解 / キャプション: Gemma 4
    "image": {"base_url": config.GEMMA_BASE_URL, "temperature": 0.5},
    # Web 検索クエリ分解・要約: ornith 9B（フェーズ 4 で使用開始）
    "websearch": {"base_url": config.ORNITH_BASE_URL, "temperature": 0.7},
}


def route(task: str) -> Route:
    return TASK_ROUTES[task]
