# progress.md — 進捗

作成日時: 2026-07-07 07:09
更新日時: 2026-07-08 14:00

## 現在の状態

**フェーズ 4（Web 検索）実装完了**。spec の主要 5 フェーズ+フェーズ 6 のうち、残るはフェーズ 5（仕上げ: 出典管理・設定画面・Markdown 書き出し・マルチモーダル）と過去記事の実データ投入。

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

- 2026-07-07 フェーズ 6（明示保存・バージョン管理）+ サイドバーメニュー:
  - 自動保存を廃止し、保存ボタン + Ctrl+S の明示保存へ。保存のたびに `document_revision` を記録。
  - ドラフト退避: 編集の 1.5 秒後に `draft_json` へ自動退避（正式保存ではない）。次回オープン時に「復元 / 破棄」バナー。
  - 履歴パネル: リビジョン一覧 → 選択版と現在の diff → 「この版を読み込む」。
  - サイドバー各行に「…」メニュー（名前を変更 / 削除）。削除は確認付きで、ワークスペース削除は RAG・画像も掃除。
  - 検証: 保存 → リビジョン生成 / ドラフトの保存・クリア / 削除カスケードを一時ライブラリのテストで確認。
  - **事故と復旧**: 検証中にユーザーの実文書「LLMの推論」をテスト保存で上書き。SQLite の旧ページ残骸から content_json を抽出して完全復旧（バックアップ: ライブラリ内 `lm-editor.sqlite3.bak-recovery`）。再発防止ルールを CLAUDE.md「検証」に追記。

- 2026-07-07 書式ツールバー（太字〜リンク、undo/redo。StarterKit v3 の Link / Underline を活用）。

- 2026-07-08 表（テーブル）機能:
  - `@tiptap/extension-table`（v3.27.2、単一パッケージで Table/TableRow/TableHeader/TableCell）を導入。`Table.configure({ resizable: true })`。
  - 書式バー（FormatToolbar）に「表」挿入ボタン（3×3・ヘッダ行あり）。表内カーソル時のみ書式パレット下段に文脈ツールバー（`TableToolbar.tsx`: 行/列の追加・削除、mergeOrSplit、toggleHeaderRow、deleteTable）。
  - GFM 相互変換: 読み込み・貼り付けは markdown-it（GFM 既定 ON）→ HTML → TipTap parseHTML。書き出しは tiptap-markdown 組み込みの table シリアライザ（v3 の native `renderMarkdown` は `storage.markdown` を持たないため tiptap-markdown 側にフォールバック）。simple table（ヘッダ行・1セル1段落・結合なし）のみ `| … |` 化、それ以外は HTML 化 → `html:false` で書き出し時に落ちる。
  - collectBlocks はトップレベルの textblock のみ対象なので、表は校正の対象外（セル内段落も非トップレベルで触られない）。
  - 検証: `npm run build`（tsc 型検査 + バンドル）通過。tiptap-markdown のシリアライザ解決経路を静的に確認。実アプリでの表示確認は未実施（Electron 起動はユーザーの backend/LLM を巻き込むため。`npm run dev` で目視予定）。

- 2026-07-08 Electron 終了時の shutdown ガード: `electron/main.ts` の window-all-closed に env ガードを追加。`LM_KEEP_BACKEND=1` を立てて起動すると、閉じても `/shutdown` を投げず自分だけ終了する（検証時に別途起動済みの backend/LLM を残す）。通常利用は従来どおり後片付け。

- 2026-07-08 フェーズ 7 チャット機能（7c-1 MVP + 7c-2 RAG トグル。Web 検索 7c-3 と function calling は後回し）:
  - backend: `POST /chat`（`ChatRequest`: messages + doc_id + document_md + selection + use_rag）。`prompts.build_chat_messages` が chat 用 system + 文脈（RAG/記事全文/選択箇所）を先頭に差し込み、会話履歴を続ける。応答は平文ストリーム。RAG は use_rag 時のみ直近ユーザー発話で hybrid search（明示発火）。
  - frontend: `src/panels/ChatPanel.tsx`（会話 UI・RAG トグル・各返答の「挿入」「置換」・クリア）。Editor が chat 状態を持ち portal で右ペインに描画。右ペインは `assistOpen` 真偽から `RightTab = 'assist' | 'chat' | null` のタブ制へ一般化（App.tsx / Editor.tsx）。ツールバーに「チャット」ボタン追加。
  - 挿入は tiptap-markdown で Markdown をパースして本文へ。置換は本文の選択範囲へ。選択が無いと「置換」は無効。
  - チャット履歴はエディタインスタンス内（ドキュメント単位・セッション限り。永続化なし）。document_md は毎ターン全文を送る（16k 既定内なら問題なし。肥大化時の間引きは将来検討）。
  - 検証: `npm run build` 通過 / `py_compile` OK / `prompts.build_chat_messages` を単体実行して構造確認。実 LLM との対話確認は未実施（backend 停止中のため。`LM_KEEP_BACKEND=1 npm run dev` で目視予定）。

- 2026-07-07 フェーズ 4 Web 検索:
  - manager を 2 スロット化（gemma :8080 / ornith :8081）。モデルバーに「検索LLM」の起動/停止を追加。
  - 検索: ddgs（キー不要）既定、TAVILY_API_KEY 設定時は Tavily 優先。ornith がクエリ分解（enable_thinking=false で高速化。news-picker の知見）。
  - 取り込み: httpx + trafilatura（favor_precision）→ 原文チャンク（rag_chunk, web）+ ornith 要約のソースノート（note_fts / note_vec で hybrid 検索対応、/rag/search の notes に統合）。
  - UI: 上部バー「🔍 Web 検索」モーダル（検索 → 取り込む → 要約表示。取り込み先は現在のワークスペース）。
  - 検証（一時ライブラリ・インプロセス）: ornith 実ロード → 日本語依頼を英語 3 クエリに分解 → ddgs 8 件 → GitHub ページ取り込み（3 チャンク + 高品質な日本語要約ノート）→ ノート/チャンク検索ヒットまで確認。

- 2026-07-07 UX 改善（ユーザー要望）: Web 検索の URL 直接指定、結果リンクの外部ブラウザ起動（shell.openExternal）、ファイルドロップの誤ナビゲーション防止、下部リソースモニター（lm-chat / news-picker の system_stats 移植。📊 で表示切替、localStorage に記憶）。

- 2026-07-07 テーマ + 設定ウィンドウ（ユーザー要望、lm-chat 参考）:
  - styles.css を CSS 変数化し、ライト/ダークを `[data-theme]` で定義（上下バーはテーマ非依存の暗色）。ダークは実起動 + スクリーンショットで目視確認。
  - 設定は `~/.lm-text-editor/settings.json`（GET/PUT /settings）。テーマ / 本文フォントサイズ / Tavily API キー。
  - ⚙️ ボタン → カテゴリ式モーダル（外観 / エディタ / Web 検索）。変更は即保存・即適用。テーマは localStorage にもキャッシュし起動時のフラッシュを防止。
  - F12 スクリーンショット、コンテンツ領域 1920x1080、DevTools 自動起動停止、フォーカス枠除去も同日対応。

- 2026-07-07 サイドバーの資料・画像管理（ユーザー要望）:
  - 「資料（RAG）」セクション: ソース単位の一覧（W/A/R バッジ + チャンク数 + 要約有無）、.md/.txt ファイル追加（reference として ingest）、ソース単位削除（チャンク + ノート + FTS/vec）。
  - 「画像」セクション: ワークスペース内の画像サムネイル一覧、クリックでカーソル位置に挿入、削除（asset 行 + ファイル）。
  - Web 検索パネルを閉じたとき / 画像アップロード時に一覧を自動更新。
  - 検証: 一時ライブラリで一覧・削除・カスケードをテスト。

## 未完了（次にやること）

- UI の手動確認: 執筆・保存・画像ペースト・インライン校正・執筆支援（RAG トグル含む）・分割ビュー校正の一連操作。
- 過去記事アーカイブ・リファレンスの実データ投入（`ingest_dir` CLI で。アーカイブの場所をユーザーに確認）。
- フェーズ 4: Web 検索（ornith 9B :8081、`<think>` パーサ、Tavily、trafilatura、二層保存）。
- 表（テーブル）機能の実アプリ目視確認（挿入・行列操作・列幅リサイズ・GFM 書き出し/読み込みの往復）。
- 内容を踏まえた校正への発展（2026-07-07 追加。plan.md「発展構想」参照。用語統一・論理チェック・RAG 突き合わせ・指摘型レビュー）。
- フェーズ 7 残り: チャットの Web 検索トグル（7c-3・後回し）、履歴の永続化、アドバイス/ソースのタブ、分割ビュー校正の右パネル寄せ。チャット MVP + RAG トグルは 2026-07-08 実装済み。plan.md フェーズ 7 参照。
- 表・チャットの実アプリ目視確認（`LM_KEEP_BACKEND=1 npm run dev` で backend を巻き込まずに）。
- 既知の制限: 分割ビュー校正はリスト内・引用内の段落を対象にしない（トップレベルのみ）。左ペインは読み取り専用（spec は編集可能を想定）。必要になったら拡張。

## 注意点

- `models/` と `runtime/` は数十 GB のローカル資産。gitignore 済みであり、削除・移動しない。
- llama.cpp サーバの起動スクリプト（dual-port 起動）はまだない。フェーズ 2 で用意する。
