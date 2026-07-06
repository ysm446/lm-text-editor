"""llama.cpp（OpenAI 互換 /v1/chat/completions）への薄いクライアント。"""

import json
from typing import Any, AsyncIterator

import httpx

Message = dict[str, Any]  # {"role": ..., "content": ...}


async def is_alive(base_url: str, timeout: float = 3.0) -> bool:
    """LLM サーバが応答するか（ストリーミング開始前のヘルスチェック用）。"""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.get(f"{base_url}/models")
            return res.status_code == 200
    except httpx.HTTPError:
        return False


async def stream_chat(
    base_url: str,
    messages: list[Message],
    *,
    temperature: float = 0.7,
    max_tokens: int | None = None,
) -> AsyncIterator[str]:
    """chat/completions を stream=True で叩き、content の差分だけを順に返す。"""
    payload: dict[str, Any] = {
        "model": "local",  # llama.cpp はロード済みモデルを使うため名前は任意
        "messages": messages,
        "stream": True,
        "temperature": temperature,
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=10.0)) as client:
        async with client.stream(
            "POST", f"{base_url}/chat/completions", json=payload
        ) as res:
            res.raise_for_status()
            async for line in res.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[len("data: "):]
                if data.strip() == "[DONE]":
                    break
                chunk = json.loads(data)
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta", {}).get("content")
                if delta:
                    yield delta
