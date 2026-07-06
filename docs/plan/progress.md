# progress.md — 進捗

作成日時: 2026-07-07 07:09
更新日時: 2026-07-07 08:39

## 現在の状態

**フェーズ 3（RAG）実装完了**。hybrid search（Ruri + sqlite-vec + FTS5）と執筆時の RAG コンテキスト供給まで動作確認済み。残りは過去記事の実データ投入のみ。次はフェーズ 4（Web 検索）。

## 完了済み

- 2026-07-07 仕様書 `docs/spec.md` 作成。
- 2026-07-07 エージェント向けルール `AGENTS.md` / `CLAUDE.md` 作成。
- 2026-07-07 `.gitignore` 整備（`models/` / `runtime/` / ビルド成果物 / DB / `.env` を除外）。
- 2026-07-07 計画ドキュメント（`docs/plan/goals.md` / `plan.md` / `progress.md`）作成。
- 実行環境の配置:
  - `runtime/llama.cpp/` — llama.cpp バイナリ（CUDA 対応）。
  - `models/gemma-4-26B-A4B-it-GGUF/` — Gemma 4 26B A4B MoE（Q4_K_M + mmproj）。2026-07-07 に 31B Q6_K から差し替え、これで確定。
  - `models/Ornith-1.0-9B-GGUF/` — ornith 9B（Q4_K_M）。
  - `models/embeddings/` — Ruri v3 310m キャッシュ。

- 2026-07-07 フェーズ 1 着手:
  - Electron + Vite + React + TypeScript 雛形（vite-plugin-electron。`electron/main.ts` / `electron/preload.ts` / `src/`）。
  - TipTap v3 エディタ基本表示（StarterKit + tiptap-markdown 0.9）。
  - `npm run build`（型検査 + 3 バンドル）と Electron 実起動を確認。
  - Python venv（`.venv`, Python 3.13.11）作成。
- 2026-07-07 フェーズ 1 本体:
  - FastAPI backend（`backend/main.py`）: workspace / document CRUD、画像アセット保存 API（base64 受信 → `data/workspaces/<id>/images/` 保存 → `/files/` で配信）。起動は `npm run backend`。
  - SQLite 永続化（`backend/db/schema.sql` = workspace / document / asset。RAG テーブルはフェーズ 3 で追加）。DB とファイルは `data/`（gitignore 済み）。
  - ワークスペース / ドキュメントのサイドバー（`src/workspace/Sidebar.tsx`。作成はインライン入力 — Electron では `window.prompt` 不可）。
  - 自動保存（800ms デバウンス + ドキュメント切替時フラッシュ。TipTap JSON + Markdown 派生を PUT）。
  - 画像挿入（ペースト / ドロップ → backend にアップロード → 画像ノード挿入）。
  - 検証: `npm run build` / `py_compile` / CRUD・日本語・画像アップロードを HTTP で実測 / Electron 実起動。

- 2026-07-07 フェーズ 2 前半:
  - `start-llm.bat`: llama-server で Gemma 4 を :8080 に起動（-ngl 99, -c 16384, --jinja, mmproj 込み）。
  - `backend/llm/client.py`: OpenAI 互換 `/v1/chat/completions` の streaming クライアント（httpx）。
  - `backend/router.py` + `backend/config.py`: タスク → モデルの振り分け表（generate / review / image / websearch）。
  - `POST /review/inline`: 前後文脈付き校正、平文ストリーム返却。LLM 未起動時は 503 と案内メッセージ。
  - エディタに「選択範囲を校正」ボタン + InlineDiff パネル（ストリーミング表示 → 文字単位 diff → 採用/破棄）。
  - 検証: Gemma 4 26B A4B を実ロードし、日本語の冗長表現が約 5 秒で自然に校正されることを確認。

- 2026-07-07 フェーズ 2 執筆支援:
  - `POST /generate/continue`（カーソル前 2000 字 + 後 500 字の文脈で続き生成）と `POST /generate/section`（指示 + 記事 Markdown でセクション生成）。
  - エディタに「執筆支援」パネル（続きを生成 / 指示から生成 → ストリーミング表示 → カーソル位置に挿入）。
  - **重要な発見**: Gemma 4 26B A4B は reasoning モデル。llama-server に `--reasoning-budget 0` を付けないと思考が max_tokens を食い潰して content が空になる（start-llm.bat 対応済み）。無効化後は校正 0.7 秒、生成 1〜1.2 秒に高速化。

- 2026-07-07 フェーズ 2 分割ビュー校正:
  - `POST /review/split`: 段落ごとに前後段落 + アウトラインを文脈として校正し、完了した段落から NDJSON でストリーム返却。
  - SplitReview UI: 左=現行 / 右=改稿案（文字単位 diff）、段落ごと採用/スキップ、「残りをすべて採用」（文書後方から適用して位置ずれ回避）。
  - しきい値分岐: 選択範囲が 2 段落以上（localStorage `lm-editor.splitThreshold` で変更可）なら自動で分割ビュー。「文書全体を校正」ボタンも追加。
  - 対象はトップレベルのテキストブロック。コードブロック・画像は校正対象外。
  - 検証: 3 段落を 1.3 秒で校正（Gemma 4 実測）。

- 2026-07-07 モデルバー（lm-chat の ModelBar を参考にユーザー要望で追加）:
  - `backend/llm/manager.py`: llama-server の subprocess 管理。PID を `data/llama_runtime.json` に記録し、kill 前に tasklist でプロセス名検証（PID 再利用・外部起動の誤殺防止）。
  - API: `GET /models/local`（models/ の GGUF 一覧）、`GET /llama/status`、`POST /llama/switch`、`POST /llama/eject`。
  - UI 上部に ModelBar: 状態ドット（停止/起動中/稼働）、モデル選択ドロップダウン、起動/切替/停止ボタン、3 秒ポーリング。
  - start-llm.bat で外部起動した場合は「外部起動の LLM」と表示し、アプリからは停止しない。
  - 検証: API 経由で起動 → loading → ready → 校正実行 → 停止（プロセス消滅）まで実測。

- 2026-07-07 フェーズ 3 RAG:
  - `backend/rag/embed.py`: Ruri v3 310m（sentence-transformers、キャッシュは `models/embeddings/`、クエリ/文書プレフィックス）。起動時にバックグラウンドで warmup。
  - `backend/rag/store.py`: `rag_chunk` / `source_note` + FTS5（trigram）+ vec0（FLOAT[768]）。段落境界優先の約 800 字チャンク。
  - `backend/rag/search.py`: hybrid search（FTS5 + ベクトル距離を RRF k=60 で融合）。スコープ = 現在のワークスペース + グローバル。
  - API: `POST /rag/search`（chunks + notes を返す。notes はフェーズ 4 から）、`POST /rag/ingest`。
  - 一括投入 CLI: `python -m backend.rag.ingest_dir <dir> --source-type article`。
  - 執筆支援パネルに「RAG」チェックボックス → セクション生成時に hybrid search 上位 5 件をプロンプトへ。
  - 検証: 2 文書 ingest → 意味的クエリ 2 種で正しい文書が 1 位（約 0.1 秒）→ use_rag 生成が資料の手順を忠実に反映（約 1 秒）。

- 2026-07-07 ライブラリ機能（lm-chat 参考、ユーザー要望）:
  - ライブラリ = データルートフォルダ（`lm-editor.sqlite3` + `workspaces/<id>/images/`。文書・RAG・画像がライブラリ単位で分離）。
  - `backend/paths.py`: 全パス解決の単一窓口（関数経由。ライブラリ側 / マシン側を分離）。レジストリと llama-server PID 記録は `~/.lm-text-editor/`。
  - `backend/library.py`: レジストリ（アクティブ + 最近開いた一覧、最大 20 件）。
  - API: `GET /library`, `POST /library/switch`, `POST /library/create`（スキーマ初期化成功後にレジストリ記録。失敗時は元へ戻す）。
  - 画像配信は StaticFiles からパストラバーサルガード付きの動的エンドポイントに変更（切り替え対応）。
  - UI: 上部バー左にライブラリスイッチャー（最近の一覧 / フォルダを開く… / 新規作成…。Electron のフォルダ選択ダイアログ使用）。切替後はワークスペース選択をリセットして再読込。
  - 既定ライブラリはリポジトリの `data/`（後方互換）。
  - 検証: 新規ライブラリ作成 → データ分離（WS/文書/画像が新ルートに保存）→ 切替復帰 → /files 配信 → トラバーサル遮断まで実測。

## 未完了（次にやること）

- UI の手動確認: 執筆・保存・画像ペースト・インライン校正・執筆支援（RAG トグル含む）・分割ビュー校正の一連操作。
- 過去記事アーカイブ・リファレンスの実データ投入（`ingest_dir` CLI で。アーカイブの場所をユーザーに確認）。
- フェーズ 4: Web 検索（ornith 9B :8081、`<think>` パーサ、Tavily、trafilatura、二層保存）。
- フェーズ 6（2026-07-07 追加）: 明示保存（保存ボタン + Ctrl+S）と文書バージョン管理。現行の自動保存を置き換える。詳細は [plan.md](plan.md) のフェーズ 6。
- 既知の制限: 分割ビュー校正はリスト内・引用内の段落を対象にしない（トップレベルのみ）。左ペインは読み取り専用（spec は編集可能を想定）。必要になったら拡張。

## 注意点

- `models/` と `runtime/` は数十 GB のローカル資産。gitignore 済みであり、削除・移動しない。
- llama.cpp サーバの起動スクリプト（dual-port 起動）はまだない。フェーズ 2 で用意する。
