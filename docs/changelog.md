# Changelog

作成日時: 2026-07-07 07:23
更新日時: 2026-07-07 07:47

## 未リリース

- 2026-07-07 07:47 インライン校正を追加。選択範囲を Gemma 4 で校正し、diff 表示から採用/破棄できる。LLM サーバは `start-llm.bat` で起動。

- 2026-07-07 07:37 `start.bat` を追加。ダブルクリックで backend（別ウィンドウ）と Vite + Electron を一括起動。

- 2026-07-07 07:32 エディタ基盤を実装。ワークスペース / ドキュメント管理（サイドバー）、SQLite への自動保存、画像のペースト / ドロップ挿入、FastAPI backend（`npm run backend` で起動）。
- 2026-07-07 07:23 アプリ雛形を作成（Electron + Vite + React + TypeScript、TipTap v3 エディタの基本表示）。`npm run dev` / `npm run build` / `npm start` が使用可能に。
