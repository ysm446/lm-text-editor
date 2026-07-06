# progress.md — 進捗

作成日時: 2026-07-07 07:09
更新日時: 2026-07-07 07:32

## 現在の状態

**フェーズ 1（エディタ基盤）ほぼ完了**。エディタ・ワークスペース管理・SQLite 永続化・画像挿入・FastAPI CRUD まで動作。UI の手動確認（実際の執筆操作）を経てフェーズ 2（LLM 接続と校正）へ。

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

## 未完了（次にやること）

- フェーズ 1 の仕上げ: 実際の執筆操作での手動確認（ワークスペース作成 → 執筆 → 再起動して内容が残るか、画像ペースト）。
- フェーズ 2: LLM 接続と校正（llama.cpp 起動スクリプト、Gemma 4 接続、インライン校正、分割ビュー校正）。

## 注意点

- `models/` と `runtime/` は数十 GB のローカル資産。gitignore 済みであり、削除・移動しない。
- llama.cpp サーバの起動スクリプト（dual-port 起動）はまだない。フェーズ 2 で用意する。
