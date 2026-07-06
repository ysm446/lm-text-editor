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


CONTINUE_SYSTEM = (
    "あなたは技術ブログ記事の執筆アシスタントです。"
    "書きかけの記事の続きを書いてください。\n"
    "ルール:\n"
    "- これまでの文体・トーン・見出し構造を維持する。\n"
    "- Markdown で書く。\n"
    "- 続きの本文のみを出力する。説明・前置き・繰り返しは書かない。\n"
    "- カーソル位置から自然につながるように書き始める。"
)

SECTION_SYSTEM = (
    "あなたは技術ブログ記事の執筆アシスタントです。"
    "指示に従って記事のセクションを書いてください。\n"
    "ルール:\n"
    "- 記事の現状（参考）と文体・トーンを揃える。\n"
    "- Markdown で書く。見出しレベルは記事の構造に合わせる。\n"
    "- セクションの本文のみを出力する。説明・前置きは書かない。"
)


def build_continue_messages(
    before: str,
    after: str | None = None,
) -> list[Message]:
    parts = [f"## ここまでの本文\n{before}"]
    if after:
        parts.append(f"## カーソルより後の本文（参考。ここに繋がるように）\n{after}")
    parts.append("上記の「ここまでの本文」の続きを書いてください。")
    return [
        {"role": "system", "content": CONTINUE_SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def build_section_messages(
    instruction: str,
    document_md: str | None = None,
) -> list[Message]:
    parts = []
    if document_md:
        parts.append(f"## 記事の現状（参考）\n{document_md}")
    parts.append(f"## 指示\n{instruction}")
    return [
        {"role": "system", "content": SECTION_SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


def build_review_messages(
    text: str,
    context_before: str | None = None,
    context_after: str | None = None,
    outline: str | None = None,
) -> list[Message]:
    parts: list[str] = []
    if outline:
        parts.append(f"## 記事のアウトライン（参考）\n{outline}")
    if context_before:
        parts.append(f"## 前の文脈（参考）\n{context_before}")
    parts.append(f"## 校正対象\n{text}")
    if context_after:
        parts.append(f"## 後の文脈（参考）\n{context_after}")
    return [
        {"role": "system", "content": REVIEW_SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]
