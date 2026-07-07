"""ornith の <think>...</think>（reasoning）を出力から除去する（news-desk 流用）。"""

from __future__ import annotations

import re

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


def strip_think(text: str) -> str:
    """思考ブロックを除去して最終出力のみを返す。

    閉じタグが無い（トークン上限で思考が切れた）場合は <think> 以降を捨てる。
    """
    text = _THINK_RE.sub("", text)
    if "<think>" in text:
        text = text.split("<think>", 1)[0]
    return text.strip()
