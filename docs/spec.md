# lm-text-editor — 仕様書 (spec.md)

更新日時: 2026-07-07 07:14

ローカル LLM と一緒に技術ブログ記事を執筆・校正するスタンドアロンのデスクトップエディタ。
Word ライクな WYSIWYG エディタを軸に、Markdown・画像挿入・RAG・Web 検索・部分校正を統合する。

---

## 1. 目的とスコープ

### 主目的
- 技術ブログ記事の執筆を LLM と協働で行う。
- 普通のエディタ（Word 的な操作感）としても成立し、LLM 支援は「必要なときに呼ぶ」もの。

### 中核要件
- WYSIWYG エディタ（Markdown ネイティブ、画像挿入）。
- 校正の二モード:
  - **インライン校正**: 文・選択範囲・単一段落 → 同一画面で diff、accept/reject。
  - **分割ビュー校正**: 段落を超える範囲 → 左右分割で before/after 比較。
- RAG（自分の過去記事・リファレンス・Web 取得原文を知識化）。
- Web 検索（取得 → 本文抽出 → 要約 → RAG 保存）。
- ワークスペース単位の編集管理（左サイドバー）。

### 非スコープ（初期）
- クラウド同期 / マルチユーザー。
- 公開（CMS への直接投稿）。※ WordPress MCP 連携は将来拡張として別途。

---

## 2. アーキテクチャ

```
┌──────────────────────────────────────────────┐
│ Electron (main / preload)                    │
│  ┌────────────────────────────────────────┐  │
│  │ Renderer: React + TypeScript           │  │
│  │  - TipTap エディタ                      │  │
│  │  - 分割ビュー / diff UI                  │  │
│  │  - ワークスペース サイドバー            │  │
│  └────────────────────────────────────────┘  │
└───────────────┬──────────────────────────────┘
                │ HTTP (localhost)
                ▼
┌──────────────────────────────────────────────┐
│ FastAPI backend                              │
│  - タスクルータ（モデル振り分け）            │
│  - RAG（Ruri 埋め込み / hybrid search）      │
│  - Web 検索オーケストレーション              │
│  - <think> パーサ（ornith 用）               │
└───┬───────────────┬───────────────┬──────────┘
    │               │               │
    ▼               ▼               ▼
┌────────┐   ┌────────────┐   ┌──────────────┐
│llama.cpp│   │ llama.cpp  │   │ SQLite       │
│Gemma 4  │   │ ornith 9B  │   │ sqlite-vec   │
│:8080    │   │ :8081      │   │ + FTS5       │
│(執筆/校正│   │(検索/要約/  │   │ (RAG/文書/   │
│ /画像)  │   │ reasoning) │   │  ワークスペース)│
└────────┘   └────────────┘   └──────────────┘
```

- フロント/バックの分離は既存標準スタック踏襲。
- LLM は dual-port（news-desk の構成を流用）。モデル同士は直接連携せず、FastAPI が仲介する疎結合。

### 技術スタック
| 層 | 採用 |
|---|---|
| デスクトップ | Electron |
| フロント | React + TypeScript |
| エディタ | TipTap (ProseMirror) + tiptap-markdown |
| diff | diff-match-patch（and/or jsdiff） |
| バックエンド | FastAPI (Python) |
| LLM 推論 | llama.cpp（OpenAI 互換 `/v1/chat/completions`, streaming） |
| 執筆/校正/画像モデル | Gemma 4 26B A4B（マルチモーダル MoE, Q4_K_M。48GB VRAM 環境） |
| 検索/要約/推論モデル | ornith 9B（reasoning, `<think>` パース必要） |
| 埋め込み | Ruri（日本語最適化） |
| ストレージ/検索 | SQLite + sqlite-vec（ベクトル）+ FTS5（全文） |
| Web 本文抽出 | trafilatura（+ httpx） |
| Web 検索 API | Tavily（第一候補） / SearXNG（自前）/ Brave Search API |

---

## 3. ディレクトリ構成

```
lm-text-editor/
├── CLAUDE.md
├── spec.md
├── package.json
├── electron/
│   ├── main.ts
│   └── preload.ts
├── src/                       # renderer (React + TS)
│   ├── App.tsx
│   ├── editor/
│   │   ├── Editor.tsx         # TipTap ラッパ
│   │   ├── extensions/        # image, markdown, ai-block など
│   │   └── toolbar/
│   ├── review/
│   │   ├── InlineDiff.tsx     # インライン校正
│   │   └── SplitReview.tsx    # 左右分割 before/after
│   ├── workspace/
│   │   ├── Sidebar.tsx
│   │   └── DocTree.tsx
│   ├── panels/
│   │   ├── AssistPanel.tsx    # 執筆/生成の対話
│   │   └── SourcePanel.tsx    # RAG / Web ソース一覧
│   └── api/                   # backend クライアント
├── backend/
│   ├── main.py                # FastAPI エントリ
│   ├── router.py              # タスク→モデル振り分け
│   ├── llm/
│   │   ├── client.py          # OpenAI 互換クライアント
│   │   └── think_parser.py    # ornith <think> 除去
│   ├── rag/
│   │   ├── embed.py           # Ruri
│   │   ├── store.py           # sqlite-vec + FTS5
│   │   └── search.py          # hybrid search
│   ├── websearch/
│   │   ├── search.py          # 検索 API
│   │   ├── extract.py         # trafilatura
│   │   └── ingest.py          # 原文チャンク + 要約保存
│   └── db/
│       ├── schema.sql
│       └── models.py
└── models/                    # GGUF 配置場所 (gitignore)
```

---

## 4. データモデル (SQLite)

```sql
-- ワークスペース
CREATE TABLE workspace (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ドキュメント（記事）
CREATE TABLE document (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id),
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,      -- TipTap の JSON（正）
  content_md TEXT,                 -- Markdown シリアライズ（書き出し用キャッシュ）
  updated_at TEXT NOT NULL
);

-- 画像アセット（ローカルパス管理）
CREATE TABLE asset (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES document(id),
  rel_path TEXT NOT NULL,          -- ワークスペース基準の相対パス
  caption TEXT,
  created_at TEXT NOT NULL
);

-- RAG: 原文チャンク（一次ソース）
CREATE TABLE rag_chunk (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER,            -- NULL = グローバル知識ベース
  source_type TEXT NOT NULL,       -- 'article' | 'reference' | 'web'
  source_url TEXT,                 -- web の場合の出典
  fetched_at TEXT,                 -- 取得日時
  chunk_text TEXT NOT NULL
);
-- ベクトルは sqlite-vec 仮想テーブルに rag_chunk.id で紐付け
-- 全文は FTS5 仮想テーブルに rag_chunk.chunk_text をミラー

-- RAG: ソースノート（二次: ornith 要約/論点抽出）
CREATE TABLE source_note (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER,
  source_url TEXT,
  summary TEXT NOT NULL,           -- ornith による要約/論点
  fetched_at TEXT
);
-- source_note.summary も埋め込み + FTS5 対象
```

### RAG スコープ規則
- 検索はデフォルトで「現在のワークスペース + グローバル（workspace_id IS NULL）」を対象。
- 過去記事アーカイブ・リファレンスはグローバルに投入。
- Web 取得はデフォルトで現在のワークスペースにスコープ。

---

## 5. エディタ (TipTap)

### 拡張構成
- StarterKit（段落・見出し・リスト・コードブロック 等）
- Image（ローカルパス。挿入時に `asset` へ登録）
- tiptap-markdown（Markdown ⇔ TipTap シリアライズ）
- カスタム AI ブロック / マーク（校正対象範囲のハイライト・提案の受け入れ状態）

### 保存形式
- **正は TipTap JSON**（`document.content_json`）。ブロック構造・位置情報を保持したいため。
- Markdown は書き出し / プレビュー用の派生（`content_md`）。

### 画像
- ワークスペースディレクトリ配下に保存し相対パスで参照。
- Gemma 4 はマルチモーダルなので、挿入画像を渡して「キャプション案」「図の説明文生成」が可能。

---

## 6. 校正フロー

### 6.1 インライン校正（軽微）
対象: 単一の文 / 選択範囲 / 単一段落。
1. 選択範囲 or 対象ブロックのテキスト + 前後文コンテキストを backend へ。
2. Gemma 4 が改稿版を返す。
3. `diff-match-patch` でインライン差分表示。
4. accept → TipTap の該当レンジを置換 / reject → 破棄。

### 6.2 分割ビュー校正（段落超）
対象: 複数段落 / セクション / ドキュメント全体。
1. 対象ブロック群 + 文書アウトライン（見出し構造の要約）を backend へ。
2. Gemma 4 が改稿版を返す。
3. **左右分割ビュー**を開く:
   - 左: 現行（編集可能）
   - 右: 改稿案（read-only プレビュー）
   - 段落単位で対応付けし差分ハイライト。
4. 段落ごと accept/reject、または一括 accept。

### 切り替えしきい値
- 「N 段落以上（デフォルト 2）で分割ビュー」を設定で変更可能。
- 明示的に「分割で見る」ボタンからも起動可能。

---

## 7. LLM 連携（dual-port ルーティング）

### モデル割り当て
| タスク | モデル | ポート |
|---|---|---|
| 執筆（続き生成・セクション生成） | Gemma 4 | :8080 |
| 校正（インライン / 分割） | Gemma 4 | :8080 |
| 画像理解 / キャプション | Gemma 4 | :8080 |
| Web 検索クエリ分解 | ornith 9B | :8081 |
| 取得本文の要点抽出・要約 | ornith 9B | :8081 |

### 疎結合の原則
- モデル同士は直接やり取りしない。
- ornith の出力（要約 / 抽出）は RAG に保存 → 必要時に Gemma 4 のコンテキストへ RAG 経由で供給。
- これにより「モデル間の相性」問題を回避。

### ornith `<think>` 処理
- ornith はレスポンスに `<think>...</think>` を含む reasoning モデル。
- `think_parser.py` で思考部分を除去し、最終出力のみを利用（news-desk の処理を流用）。
- 思考部分は必要ならデバッグ用にログ保存（本文には使わない）。

### 呼び出し規約
- すべて OpenAI 互換 `/v1/chat/completions`。
- 執筆・校正はストリーミングでエディタ / diff にストリーム表示。

---

## 8. RAG

### 埋め込み・検索
- 埋め込み: Ruri（日本語最適化）。
- 検索: hybrid（sqlite-vec ベクトル + FTS5 全文）。mem-chat のレイヤーを流用。

### 二層保存戦略
- **一次: 原文チャンク（`rag_chunk`）** — trafilatura で本文抽出 → チャンク → 埋め込み。出典 URL・取得日時を必須で保持（引用・出典明記のため）。
- **二次: ソースノート（`source_note`）** — ornith 9B の要約 / 論点抽出。俯瞰と当たり付け用。
- 検索フロー: ソースノートで関連ソースを絞る → 裏取りが要るときに原文チャンクを展開。

### 索引対象
- 自分の過去記事（technical-notes.com アーカイブ）→ グローバル。
- リファレンス（技術メモ、second-brain リポジトリ、Houdini/VEX ドキュメント等）→ グローバル。
- Web 取得原文 → 現在のワークスペース。

---

## 9. Web 検索

### フロー
1. ユーザ指示 or 執筆文脈からクエリ生成（ornith 9B がクエリ分解）。
2. 検索 API（Tavily 第一候補）で候補 URL 取得。
3. `httpx` で取得 → `trafilatura` で本文抽出。
4. ornith 9B が要約 / 論点抽出。
5. 保存: 原文チャンク（`rag_chunk`, source_type='web'）+ 要約（`source_note`）。
6. 執筆時に RAG 経由で Gemma 4 のコンテキストへ。

### 出典
- Web 由来のチャンク・ノートには必ず `source_url` と `fetched_at` を保持。
- 記事内で参照した出典を一覧化できるようにする（技術ブログの引用管理）。

---

## 10. API エンドポイント（backend）

```
# 執筆
POST /generate/continue        { doc_id, cursor_ctx }            -> stream
POST /generate/section         { doc_id, instruction, use_rag }  -> stream

# 校正
POST /review/inline            { text, context }                 -> { revised }  (stream)
POST /review/split             { blocks[], outline }             -> { revised_blocks[] } (stream)

# 画像
POST /image/caption            { image_path, context }           -> { caption }

# RAG
POST /rag/search               { query, workspace_id }           -> { chunks[], notes[] }
POST /rag/ingest               { source_type, content, meta }    -> { ok }

# Web 検索
POST /web/search               { query, workspace_id }           -> { results[] }
POST /web/ingest               { url, workspace_id }              -> { chunk_ids[], note_id }

# ワークスペース / 文書
GET  /workspaces
POST /workspaces               { name }
GET  /workspaces/{id}/docs
POST /docs                     { workspace_id, title }
PUT  /docs/{id}                { content_json }
```

（IPC は Electron preload 経由でこれらを叩く薄いクライアントとして実装。）

---

## 11. オーケストレーション方針

- LangChain 等の重いフレームワークは使わない。
- RAG / Web 検索を叩くかどうかは**アプリ側が明示制御**（ボタン・トグル・執筆意図）。
- モデルの function calling には初期は依存しない（ローカル reasoning モデルの取りこぼし回避）。安定後に段階的に導入検討。

---

## 12. 開発フェーズ

1. **エディタ基盤**: TipTap + Markdown + 画像挿入 + ワークスペース/サイドバー + SQLite 永続化。
2. **LLM 接続と校正**: Gemma 4（:8080）接続、インライン校正、分割ビュー校正。
3. **RAG**: Ruri + sqlite-vec + FTS5 の hybrid（mem-chat 流用）。過去記事の投入。
4. **Web 検索**: ornith 9B（:8081）接続、検索 → 抽出 → 要約 → 二層保存。
5. **仕上げ**: 出典管理、設定（しきい値・モデル切替）、書き出し（Markdown）。

---

## 13. 開発規約（CLAUDE.md 抜粋方針）

- 命名: lowercase-hyphenated（プロジェクト・ディレクトリ）。
- 既存 ML コンポーネントは subprocess / HTTP でラップ（再実装しない）。
- LLM は OpenAI 互換エンドポイント経由。dual-port を前提。
- 埋め込みは Ruri、検索は hybrid（vector + FTS5）固定。
- TipTap JSON を正、Markdown は派生。
