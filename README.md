# lm-text-editor

ローカル LLM と協働で技術ブログ記事を執筆・校正する、スタンドアロンのデスクトップエディタ。

Word ライクな WYSIWYG エディタを軸に、Markdown・画像挿入・RAG・Web 検索・部分校正を統合します。
執筆・校正・要約はすべてローカルの LLM（llama.cpp）で完結し、外部に依存するのは Web 検索のみです。

> 開発中のプロジェクトです。詳細仕様は [docs/spec.md](docs/spec.md)、進捗は [docs/plan/](docs/plan/)、変更履歴は [docs/changelog.md](docs/changelog.md) を参照してください。

## 主な機能

- **WYSIWYG エディタ** — TipTap ベース。Markdown ネイティブ、画像の貼り付け / ドロップ挿入、書式ツールバー（フローティング）。
- **校正の二モード**
  - インライン校正（選択範囲）— 同一画面で diff 表示、採用 / 破棄。
  - 分割ビュー校正（文書全体）— 左右 before/after で段落ごとに採用 / 破棄。
- **執筆支援** — カーソル位置からの続き生成・セクション生成。
- **RAG（資料）** — 過去記事・リファレンス・Web 取得原文・手動メモを Ruri v3 埋め込み + hybrid search（sqlite-vec ベクトル + FTS5 全文）で検索。手動メモは Markdown で作成・再編集可能。
- **Web 検索** — 取得 → 本文抽出 → 要約 → RAG に二層保存（原文チャンク + 要約ノート）。出典 URL・取得日時を保持。
- **ワークスペース / ライブラリ管理** — 文書・資料・画像をワークスペース単位で管理。データの保存先（ライブラリ = Obsidian の Vault 相当）は切り替え可能。
- **リソースモニター** — CPU / RAM / GPU / VRAM を下部バーに表示。

## アーキテクチャ

```
Electron (React + TypeScript + TipTap)
        │ HTTP (localhost:8000)
FastAPI backend（タスクルータ / RAG / Web 検索 / <think> パーサ）
        │
llama.cpp :8080（単一 LLM: 執筆・校正・画像・検索クエリ分解・要約）
SQLite + sqlite-vec + FTS5（RAG・文書・ワークスペース）
Ruri v3（埋め込み・完全オフライン）
```

- LLM 呼び出しはすべて OpenAI 互換 `/v1/chat/completions`。タスク → 接続先の振り分けは `backend/router.py`。
- 埋め込みモデルは完全オフラインで読み込む（未導入時は設定画面からインストール）。
- LangChain 等の重いフレームワークは使わず、RAG / Web 検索の発火はアプリ側が明示制御。

## 技術スタック

- フロントエンド: Electron 43 / React 19 / TypeScript / Vite / TipTap 3
- バックエンド: Python 3.13 / FastAPI + uvicorn
- LLM ランタイム: llama.cpp（`runtime/llama.cpp/`）
- モデル: Gemma 4 26B A4B（GGUF）/ Ruri v3 埋め込み（`cl-nagoya/ruri-v3-310m`）
- データ: SQLite + sqlite-vec + FTS5

## 必要環境

- Windows（現状 Windows 前提。`taskkill` / `netstat` などを使用）
- Node.js（npm）
- Python 3.13（リポジトリ直下に venv を作成）
- NVIDIA GPU 推奨（VRAM 使用量はコンテキスト長・モデルに依存）
- `models/`（GGUF モデル）と `runtime/llama.cpp/`（llama.cpp バイナリ）— いずれも大容量のため Git 管理外

## セットアップ

```bash
# 1. フロントエンドの依存関係
npm install

# 2. Python 仮想環境（3.13）と依存関係
py -3.13 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
```

- `models/` に GGUF（Gemma 4 など）を配置します。
- RAG 埋め込みモデル（Ruri v3）は、アプリ起動後に **設定 → LLM → 埋め込みモデル** からインストールできます（初回のみネット接続が必要・約 0.6 GB）。

## 起動

```bash
# バックエンド（FastAPI, 127.0.0.1:8000）
npm run backend

# フロントエンド（Vite 開発サーバ + Electron）
npm run dev
```

または `start.bat` でバックエンド + Vite + Electron を一括起動できます。

LLM は通常、アプリ上部の**モデルピル**から起動 / 停止します（クリックでモデル選択モーダル）。
`start-llm.bat` で llama.cpp を外部起動することもできます。

> **注意（VS Code のターミナル）**: `ELECTRON_RUN_AS_NODE=1` が継承されていると Electron が素の Node.js として起動します。Electron を起動する前に `Remove-Item Env:ELECTRON_RUN_AS_NODE` を実行してください。

## 主なコマンド

| コマンド | 内容 |
|---|---|
| `npm run dev` | Vite 開発サーバ + Electron 起動 |
| `npm run build` | `tsc --noEmit` で型検査後にビルド |
| `npm start` | ビルド済み `dist-electron/main.js` で Electron 起動 |
| `npm run backend` | FastAPI backend（uvicorn, 127.0.0.1:8000） |

## ディレクトリ構成

```
src/            フロントエンド（React / TypeScript）
  editor/       TipTap エディタ・書式/操作ツールバー
  review/       インライン diff・分割ビュー校正・履歴
  panels/       資料ビューア・執筆支援・Web 検索・画像
  workspace/    サイドバー（ワークスペースツリー）
  settings/     設定モーダル
backend/        FastAPI バックエンド
  llm/          llama-server 管理・プロンプト・OpenAI 互換クライアント
  rag/          埋め込み（Ruri）・ストア（sqlite-vec + FTS5）・検索
  websearch/    Web 検索・本文抽出・取り込み
  db/           文書・ワークスペースの永続化
docs/           仕様・計画・設計ガイドライン・変更履歴
models/         GGUF モデル・埋め込みキャッシュ（Git 管理外）
runtime/        llama.cpp バイナリ（Git 管理外）
```

## ドキュメント

- [docs/spec.md](docs/spec.md) — 詳細仕様
- [docs/plan/](docs/plan/) — 目的（goals）・方針（plan）・進捗（progress）
- [docs/design/design-guidelines.md](docs/design/design-guidelines.md) — UI デザインガイドライン
- [docs/changelog.md](docs/changelog.md) — 変更履歴
- [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md) — 開発エージェント向けガイド
