# plan.md — 実装方針と優先順位

作成日時: 2026-07-07 07:09
更新日時: 2026-07-07 09:08

## 実装方針

- フロント（Electron + React + TypeScript + TipTap）とバックエンド（FastAPI）を HTTP (localhost) で分離する。
- LLM 呼び出しはすべて OpenAI 互換 `/v1/chat/completions`。執筆・校正はストリーミング。
- 文書の正は TipTap JSON（`document.content_json`）。Markdown は書き出し用の派生。
- 埋め込みは Ruri、検索は hybrid（sqlite-vec + FTS5）固定。
- LangChain 等の重いフレームワークは使わない。
- 各フェーズの終わりで「動くもの」を維持する（フェーズ 1 完了時点で LLM なしのエディタとして使える状態にする）。

## フェーズ（spec.md §12 準拠）

### フェーズ 1: エディタ基盤 ← 最優先

- [x] プロジェクト雛形: Electron + Vite + React + TypeScript のセットアップ、`package.json` 整備
- [x] TipTap エディタ（StarterKit + tiptap-markdown。TipTap は v3 系を採用）
- [x] 画像挿入（ペースト / ドロップ → `data/workspaces/<id>/images/` 保存、`asset` 登録）
- [x] ワークスペース / 文書管理（サイドバー。ツリー表示は必要になったら拡張）
- [x] SQLite 永続化（`workspace` / `document` / `asset` テーブル、800ms デバウンス自動保存）
- [x] FastAPI 雛形とワークスペース / 文書 CRUD API（`npm run backend`）

### フェーズ 2: LLM 接続と校正

- [x] llama.cpp（Gemma 4, :8080）接続クライアントとタスクルータ（`start-llm.bat` / `backend/llm/client.py` / `backend/router.py`）
- [x] 執筆支援（続き生成・セクション生成、ストリーミング表示。API 実測済み、UI の手動確認待ち）
- [x] インライン校正（diff-match-patch、accept/reject。API は実測済み、UI の手動確認待ち）
- [x] 分割ビュー校正（左右分割、段落対応付け、段落ごと accept/reject、一括採用。API 実測済み、UI の手動確認待ち）
- [x] 切り替えしきい値（デフォルト 2 段落。localStorage `lm-editor.splitThreshold` で変更可。設定 UI はフェーズ 5）

### フェーズ 3: RAG

- [x] Ruri 埋め込み + sqlite-vec + FTS5 の hybrid search（lm-chat の memory レイヤーを流用。RRF 融合、trigram トークナイザ）
- [x] `rag_chunk` / `source_note` テーブルとスコープ規則（ワークスペース + グローバル）
- [ ] 過去記事アーカイブ・リファレンスの投入（CLI は用意済み: `python -m backend.rag.ingest_dir <dir>`。実データの投入はアーカイブの場所が分かり次第）
- [x] 執筆時の RAG コンテキスト供給（執筆支援パネルの「RAG」チェックボックス）

### フェーズ 4: Web 検索

- [ ] ornith 9B（:8081）接続と `<think>` パーサ（news-desk の処理を流用）
- [ ] 検索 API 接続（Tavily 第一候補。SearXNG / Brave をフォールバック候補として検討）
- [ ] httpx 取得 → trafilatura 本文抽出 → ornith 要約
- [ ] 二層保存（原文チャンク + ソースノート、`source_url` / `fetched_at` 必須）

### フェーズ 5: 仕上げ

- [ ] 出典管理（記事内で参照したソースの一覧化）
- [ ] 設定画面（しきい値・モデル切替・検索 API キー）
- [ ] Markdown 書き出し
- [ ] Gemma 4 マルチモーダル活用（画像キャプション案・図の説明文生成）

### フェーズ 6: 明示保存と文書バージョン管理（2026-07-07 ユーザー要望）

保存モデルを「自動保存」から「保存ボタンを押して初めてセーブ」に変更し、保存のたびに履歴（リビジョン）を残す。

- [x] 保存ボタン + Ctrl+S。未保存変更のインジケータ（ツールバー右の「● 未保存」）
- [x] `document_revision` テーブル。保存時に document 更新 + リビジョン追加 + ドラフトクリア
- [x] 履歴 UI: リビジョン一覧 → 現在との diff プレビュー → 「この版を読み込む」（読み込みは未保存状態になり、保存で確定）
- [x] 800ms デバウンス自動保存を廃止し、ドラフト退避（1.5 秒デバウンスで `draft_json` へ。正式保存ではない）に置き換え
- [x] ドラフト復元バナー（ドキュメントを開いたとき未保存の下書きがあれば「復元 / 破棄」）
- [ ] リビジョンの保持方針（現状は全部残す。肥大化したら間引きを検討）
- [ ] アプリ終了時に未保存変更がある場合の確認ダイアログ（Electron の beforeunload。未実装）

### サイドバー操作性（2026-07-07 ユーザー要望）

- [x] ワークスペース / ドキュメント行の「…」ポップアップメニュー（名前を変更 / 削除）
- [x] 削除は確認ダイアログ付き。ワークスペース削除は文書・画像・RAG データも掃除

### エディタ書式（2026-07-07 ユーザー要望）

- [x] 書式ツールバー: 太字 / 斜体 / 下線 / 打ち消し / インラインコード / 見出し H1-H3 / 箇条書き / 番号リスト / 引用 / コードブロック / 水平線 / リンク（挿入・解除）/ undo・redo。アクティブ状態表示、ショートカット併用可
- [ ] 表（テーブル）ツール: @tiptap/extension-table の導入、挿入・行列操作 UI、Markdown（GFM）との相互変換の確認

### 発展構想: 内容を踏まえた校正（2026-07-07 ユーザー要望・フェーズ 2 の次段階）

現在の校正は文章表現の改善が中心。これを「記事の内容・文脈を理解した校正」へ発展させる。

- [ ] 記事全体の文脈を踏まえた校正（用語の統一、論理の流れ、見出し構造とのずれ、重複の指摘）
- [ ] RAG / 出典との突き合わせ（本文の技術的な記述がソースと矛盾していないかのチェック、要出典の指摘）
- [ ] 指摘型レビュー UI（書き換え案だけでなく「ここが分かりにくい・根拠が弱い」のようなコメントを返すモード）
- [ ] ornith 9B（reasoning）を校正の分析側に使う案の検討（分析は ornith、書き換えは Gemma という分業）

## 決定済み事項

- Gemma 4 のサイズ: **26B A4B (MoE), Q4_K_M** を採用（2026-07-07 決定。`models/gemma-4-26B-A4B-it-GGUF/` に配置済み）。

## 技術上の未確定事項

- diff ライブラリ: diff-match-patch を第一候補とし、必要なら jsdiff を併用。
- Web 検索 API の最終選定（Tavily の無料枠 / 課金条件を確認してから確定）。
- function calling の導入時期（安定後に段階的に検討。初期は不使用）。

## 将来拡張（本計画の外）

- WordPress MCP 連携（公開フロー）。
- クラウド同期 / マルチユーザー。
