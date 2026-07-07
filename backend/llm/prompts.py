"""LLM プロンプトのテンプレート。"""

from backend import settings_store
from backend.llm.client import Message

# 校正のシステムプロンプトの既定値。設定 review_system_prompt が空ならこれを使う
REVIEW_SYSTEM = (
    "あなたは文章の校正者です。"
    "与えられた「校正対象」の文章を、意味と事実関係を変えずに、"
    "日本語として自然で読みやすい文章に校正してください。\n"
    "ルール:\n"
    "- 校正後の本文のみを出力する。説明・前置き・引用符は一切書かない。\n"
    "- Markdown 記法・改行・コード・URL・専門用語はそのまま維持する。\n"
    "- 修正が不要な箇所は変更しない。\n"
    "- 前後の文脈は参考情報であり、出力に含めない。"
)


def review_system() -> str:
    """設定で上書きされた校正システムプロンプト（空なら既定）。"""
    override = (settings_store.read().get("review_system_prompt") or "").strip()
    return override or REVIEW_SYSTEM


CONTINUE_SYSTEM = (
    "あなたは文章の執筆アシスタントです。"
    "書きかけの文章の続きを書いてください。\n"
    "ルール:\n"
    "- これまでの文体・トーン・見出し構造を維持する。\n"
    "- Markdown で書く。\n"
    "- 続きの本文のみを出力する。説明・前置き・繰り返しは書かない。\n"
    "- カーソル位置から自然につながるように書き始める。"
)

SECTION_SYSTEM = (
    "あなたは文章の執筆アシスタントです。"
    "指示に従って文章のセクションを書いてください。\n"
    "ルール:\n"
    "- 文章の現状（参考）と文体・トーンを揃える。\n"
    "- Markdown で書く。見出しレベルは文章の構造に合わせる。\n"
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
    rag_context: str | None = None,
) -> list[Message]:
    parts = []
    if rag_context:
        parts.append(f"## 参考資料（RAG 検索結果）\n{rag_context}")
    if document_md:
        parts.append(f"## 文章の現状（参考）\n{document_md}")
    parts.append(f"## 指示\n{instruction}")
    return [
        {"role": "system", "content": SECTION_SYSTEM},
        {"role": "user", "content": "\n\n".join(parts)},
    ]


CHAT_SYSTEM = (
    "あなたは文章の執筆パートナーです。"
    "ユーザーが編集中の文章について、相談・レビュー・書き換え提案に対話形式で応じます。\n"
    "ルール:\n"
    "- 日本語で、要点から簡潔に答える。\n"
    "- レビュー依頼には具体的に指摘する（どこが・なぜ・どう直すか）。\n"
    "- 書き換え案を出すときは、そのまま貼れる Markdown で示す。\n"
    "- 文章の文体・トーン・見出し構造を尊重する。\n"
    "- 「編集中の文章」「選択箇所」は参考情報。ユーザーの質問に直接答えることを優先する。"
)


def build_chat_messages(
    history: list[Message],
    document_md: str | None = None,
    selection: str | None = None,
    rag_context: str | None = None,
) -> list[Message]:
    """マルチターン会話。文書・選択範囲・RAG を system の文脈として先頭に差し込む。"""
    messages: list[Message] = [{"role": "system", "content": CHAT_SYSTEM}]
    context_parts: list[str] = []
    if rag_context:
        context_parts.append(f"## 参考資料（RAG 検索結果）\n{rag_context}")
    if document_md:
        context_parts.append(f"## 編集中の文章（全文・参考）\n{document_md}")
    if selection:
        context_parts.append(f"## ユーザーが選択している箇所\n{selection}")
    if context_parts:
        messages.append({"role": "system", "content": "\n\n".join(context_parts)})
    messages.extend(
        {"role": m["role"], "content": m["content"]} for m in history
    )
    return messages


def build_review_messages(
    text: str,
    context_before: str | None = None,
    context_after: str | None = None,
    outline: str | None = None,
) -> list[Message]:
    parts: list[str] = []
    if outline:
        parts.append(f"## 文章のアウトライン（参考）\n{outline}")
    if context_before:
        parts.append(f"## 前の文脈（参考）\n{context_before}")
    parts.append(f"## 校正対象\n{text}")
    if context_after:
        parts.append(f"## 後の文脈（参考）\n{context_after}")
    return [
        {"role": "system", "content": review_system()},
        {"role": "user", "content": "\n\n".join(parts)},
    ]
