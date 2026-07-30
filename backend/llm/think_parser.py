"""reasoning（思考）ブロックを LLM 出力から取り除く（news-desk 流用）。

思考タグは 2 系統を扱う。

- `<think>...</think>` — ornith / DeepSeek 系
- `<|channel>thought ... <channel|>` — Gemma 4 の thought チャンネル

llama-server を `--reasoning-format deepseek` で起動していれば思考は
`reasoning_content` に分離されて content には出てこないが、モデルとパーサの
組み合わせによっては content に生のまま流れてくる。校正・執筆の出力は本文へ
そのまま入るため、保険として常に取り除く。
"""

from __future__ import annotations

import re

_THINK_RE = re.compile(
    r"<think>.*?</think>|<\|channel>thought.*?<channel\|>", re.DOTALL
)
_OPEN_TAGS = ("<think>", "<|channel>thought")
_CLOSE_TAGS = ("</think>", "<channel|>")
_MAX_TAG_LEN = max(len(t) for t in _OPEN_TAGS + _CLOSE_TAGS)


def strip_think(text: str) -> str:
    """思考ブロックを除去して最終出力のみを返す。

    閉じタグが無い（トークン上限で思考が切れた）場合は開始タグ以降を捨てる。
    """
    text = _THINK_RE.sub("", text)
    for tag in _OPEN_TAGS:
        if tag in text:
            text = text.split(tag, 1)[0]
    return text.strip()


def _find_first(text: str, tags: tuple[str, ...]) -> tuple[int, str]:
    """tags のうち最も手前に現れるものの (位置, タグ)。無ければ (-1, "")。"""
    best = (-1, "")
    for tag in tags:
        pos = text.find(tag)
        if pos >= 0 and (best[0] < 0 or pos < best[0]):
            best = (pos, tag)
    return best


def _partial_tail(text: str, tags: tuple[str, ...]) -> int:
    """末尾が tags のいずれかの途中（前方一致）なら、その長さを返す。

    タグがチャンク境界で分断されても検出できるよう、この分だけ保留する。
    """
    for n in range(min(len(text), _MAX_TAG_LEN - 1), 0, -1):
        tail = text[-n:]
        if any(t.startswith(tail) and len(t) > n for t in tags):
            return n
    return 0


class ThinkFilter:
    """ストリーミング content から思考ブロックを分離する増分フィルタ。

    `feed()` は本文だけを返し、`feed_split()` は (本文, 思考) を返す
    （チャットで思考を折りたたみ表示するため）。タグがチャンク境界で
    分断される場合に備えて末尾を保留するので、終端で `flush()` を呼ぶ。
    """

    def __init__(self) -> None:
        self._buf = ""
        self._in_think = False

    def feed(self, delta: str) -> str:
        return self.feed_split(delta)[0]

    def feed_split(self, delta: str) -> tuple[str, str]:
        self._buf += delta
        body: list[str] = []
        thought: list[str] = []
        while True:
            if self._in_think:
                pos, tag = _find_first(self._buf, _CLOSE_TAGS)
                if pos < 0:
                    # 閉じタグ待ち: 判定に必要な末尾だけ残し、思考本文は吐き出す
                    keep = _partial_tail(self._buf, _CLOSE_TAGS)
                    cut = len(self._buf) - keep
                    thought.append(self._buf[:cut])
                    self._buf = self._buf[cut:]
                    break
                thought.append(self._buf[:pos])
                self._buf = self._buf[pos + len(tag):]
                self._in_think = False
                continue
            pos, tag = _find_first(self._buf, _OPEN_TAGS)
            if pos < 0:
                keep = _partial_tail(self._buf, _OPEN_TAGS)
                cut = len(self._buf) - keep
                body.append(self._buf[:cut])
                self._buf = self._buf[cut:]
                break
            body.append(self._buf[:pos])
            self._buf = self._buf[pos + len(tag):]
            self._in_think = True
        return "".join(body), "".join(thought)

    def flush(self) -> tuple[str, str]:
        """終端で保留分を吐く。思考の途中で終わった場合は思考側として返す。"""
        rest = self._buf
        self._buf = ""
        return ("", rest) if self._in_think else (rest, "")
