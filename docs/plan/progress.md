# progress.md — 進捗

作成日時: 2026-07-07 07:09
更新日時: 2026-07-07 07:47

## 現在の状態

**フェーズ 2（LLM 接続と校正）進行中**。インライン校正が API レベルで動作（Gemma 4 実測済み）。残りは執筆支援（続き生成）、分割ビュー校正、しきい値設定。

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

## 未完了（次にやること）

- UI の手動確認: 執筆・保存・画像ペースト・インライン校正（採用/破棄）の一連操作。
- フェーズ 2 の残り: 執筆支援（続き生成・セクション生成）、分割ビュー校正、しきい値設定。

## 注意点

- `models/` と `runtime/` は数十 GB のローカル資産。gitignore 済みであり、削除・移動しない。
- llama.cpp サーバの起動スクリプト（dual-port 起動）はまだない。フェーズ 2 で用意する。
