# progress.md — 進捗

作成日時: 2026-07-07 07:09
更新日時: 2026-07-07 07:23

## 現在の状態

**フェーズ 1（エディタ基盤）進行中**。Electron + Vite + React + TypeScript の雛形と TipTap エディタの基本表示まで完了。次はワークスペース / サイドバーと SQLite 永続化。

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

## 未完了（次にやること）

- フェーズ 1 の残り（詳細は [plan.md](plan.md) のチェックリスト参照）:
  - 画像挿入（ワークスペースディレクトリ保存 + `asset` 登録）。
  - ワークスペース / 文書管理（サイドバー、DocTree）。
  - SQLite 永続化と FastAPI 雛形（CRUD API）。venv は作成済み、パッケージ導入から。

## 注意点

- `models/` と `runtime/` は数十 GB のローカル資産。gitignore 済みであり、削除・移動しない。
- llama.cpp サーバの起動スクリプト（dual-port 起動）はまだない。フェーズ 2 で用意する。
