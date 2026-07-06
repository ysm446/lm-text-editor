"""LLM プロンプトのテンプレート。"""

from backend.llm.client import Message

REVIEW_SYSTEM = (
    "あなたは技術ブログ記事の校正者です。"
    "与えられた「校正対象」の文章を、意味と事実関係を変えずに、"
    "日本語として自然で読みやすい文章に校正してください。\n"
    "ルール:\n"
    "- 校正後の本文のみを出力する。説明・前置き・引用符は一切書かない。\n"
    "- Markdown 記法・改行・コード・URL・専門用語はそのまま維持する。\n"
    "- 修正が不要な箇所は変更しない。\n"
    "- 前後の文脈は参考情報であり、出力に含めない。"
)


def build_review_messages(
    text: str,
    context_before: str | None = None,
    context_after: str | None = None,
) -> list[Message]:
    parts: list[str] = []
    if context_before:
        parts.append(f"## 前の文脈（参考）\n{context_before}")
    parts.append(f"## 校正対象\n{text}")
    if context_after:
        parts.append(f"## 後の文脈（参考）\n{context_after}")
    return [
        {"role": "system", "content": REVIEW_SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]
