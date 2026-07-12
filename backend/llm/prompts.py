"""LLM プロンプトのテンプレート。"""

from backend import settings_store
from backend.llm.client import Message

# 校正の基本方針（ペルソナ + 固定ルール）。設定 review_system_prompt が空ならこれを使う。
# 「どこまで直すか（強さ）」「文体」は別軸として実行時に合成する（下の REVIEW_STRENGTH / REVIEW_STYLE）。
REVIEW_SYSTEM = (
    "あなたは文章の校正者です。"
    "与えられた「校正対象」の文章を、意味と事実関係を変えずに校正してください。\n"
    "ルール:\n"
    "- 校正後の本文のみを出力する。説明・前置き・引用符は一切書かない。\n"
    "- Markdown 記法・改行・コード・URL・専門用語はそのまま維持する。\n"
    "- 前後の文脈は参考情報であり、出力に含めない。"
)

# 校正の強さ（どこまで手を入れるか）。既定は "medium"。
REVIEW_STRENGTH = {
    "weak": (
        "校正は最小限にとどめる。明らかな誤字・脱字・誤変換・文法の誤りだけを直し、"
        "それ以外の表現・語順・言い回しは原文のまま変えない。"
    ),
    "medium": (
        "日本語として自然で読みやすくなるよう整える。誤りの修正に加え、回りくどい表現や"
        "不自然な語順は適度に直すが、原文の構成と要点はそのまま保つ。"
    ),
    "strong": (
        "積極的に推敲する。意味と事実は保ったまま、冗長な箇所の圧縮・語順の入れ替え・"
        "より的確な言い回しへの書き換えを行い、明快で読みやすい文章にする。"
    ),
}

# 文体の揃え方。既定は "keep"（原文のまま）。
REVIEW_STYLE = {
    "keep": "文体（敬体／常体）は原文のまま維持する。",
    "polite": "文末は敬体（です・ます調）に統一する。",
    "plain": "文末は常体（だ・である調）に統一する。",
}


def review_system(strength: str = "medium", style: str = "keep") -> str:
    """校正システムプロンプトを返す。

    カスタム上書き（設定 review_system_prompt）と 2 軸（強さ・文体）は排他:
    - カスタムが設定されていれば、それをそのまま使う（強さ・文体は無視）。
      指示の二重化・矛盾を避けるため、合成はしない。
    - カスタムが空なら、既定の基本方針に 強さ ＋ 文体 を合成する。
      未知の値は既定（medium / keep）にフォールバックする。
    """
    override = (settings_store.read().get("review_system_prompt") or "").strip()
    if override:
        return override
    strength_clause = REVIEW_STRENGTH.get(strength, REVIEW_STRENGTH["medium"])
    style_clause = REVIEW_STYLE.get(style, REVIEW_STYLE["keep"])
    return f"{REVIEW_SYSTEM}\n- 校正の強さ: {strength_clause}\n- 文体: {style_clause}"


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
    web_context: str | None = None,
) -> list[Message]:
    """マルチターン会話。文書・選択範囲・RAG・Web 検索を system の文脈として先頭に差し込む。

    system メッセージは必ず 1 つに統合する。Gemma のチャットテンプレートは
    「system は先頭に 1 つだけ」を要求し、2 つ目があると HTTP 400 になる。
    """
    context_parts: list[str] = [CHAT_SYSTEM]
    if rag_context:
        context_parts.append(f"## 参考資料（RAG 検索結果）\n{rag_context}")
    if web_context:
        context_parts.append(
            "## Web 検索結果（参考）\n"
            "以下は直近の質問に対する Web 検索のスニペットです。"
            "これを参考にする場合は、どの情報がどの URL に基づくか分かるように答えてください。\n\n"
            f"{web_context}"
        )
    if document_md:
        context_parts.append(f"## 編集中の文章（全文・参考）\n{document_md}")
    if selection:
        context_parts.append(f"## ユーザーが選択している箇所\n{selection}")
    messages: list[Message] = [
        {"role": "system", "content": "\n\n".join(context_parts)}
    ]
    messages.extend(
        {"role": m["role"], "content": m["content"]} for m in history
    )
    return messages


def build_web_context(results: list[dict]) -> str:
    """Web 検索結果（title / url / snippet）をチャット文脈用のテキストに整形する。"""
    parts = []
    for i, r in enumerate(results, 1):
        parts.append(
            f"[{i}] {r.get('title', '')}\nURL: {r.get('url', '')}\n抜粋: {r.get('snippet', '')}"
        )
    return "\n\n".join(parts)


# トピックノートのまとめなおし（既存ノート + 新情報 → 統合 Markdown）。
# 出典の追跡性を保つルールをプロンプトに焼き込む（削らない・URL と日付を蓄積）。
NOTE_MERGE_SYSTEM = (
    "あなたは調査ノートの編集者です。"
    "「既存ノート」に「新情報」を統合した Markdown を出力してください。\n"
    "ルール:\n"
    "- 既存ノートの情報・構成・見出しをできるだけ保つ。既存の記述を勝手に削除・要約しない。\n"
    "- 新情報は適切なセクションに組み込む。矛盾する場合は両論併記し、新旧が分かるようにする。\n"
    "- ノート末尾に「## 参考」セクションを維持する。既存の参考 URL・日付は消さず、"
    "新情報の出典 URL・日付を追記する。\n"
    "- 統合後のノート本文（Markdown）のみを出力する。説明・前置きは書かない。"
)


def build_note_merge_messages(
    note_title: str, note_content: str, new_content: str
) -> list[Message]:
    user = (
        f"## 既存ノート: {note_title}\n{note_content or '（まだ本文はありません）'}\n\n"
        f"## 新情報\n{new_content}"
    )
    return [
        {"role": "system", "content": NOTE_MERGE_SYSTEM},
        {"role": "user", "content": user},
    ]


def build_review_messages(
    text: str,
    context_before: str | None = None,
    context_after: str | None = None,
    outline: str | None = None,
    strength: str = "medium",
    style: str = "keep",
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
        {"role": "system", "content": review_system(strength, style)},
        {"role": "user", "content": "\n\n".join(parts)},
    ]
