# CLAUDE.md

このファイルは Claude Code 向けのプロジェクトガイドです。
エージェント共通のルールは [AGENTS.md](AGENTS.md) に定義されており、本ファイルはそれを前提とします。

## プロジェクト概要

ローカル LLM と協働で技術ブログ記事を執筆・校正するスタンドアロンのデスクトップエディタ。
詳細仕様は `docs/spec.md` を参照。

- Word ライクな WYSIWYG エディタ（TipTap / Markdown ネイティブ / 画像挿入）
- 校正の二モード: インライン校正（同一画面 diff）と分割ビュー校正（左右 before/after）
- RAG（過去記事・リファレンス・Web 取得原文）と Web 検索の統合
- ワークスペース単位の文書管理

## アーキテクチャ

```
Electron (React + TypeScript + TipTap)
        │ HTTP (localhost)
FastAPI backend（タスクルータ / RAG / Web 検索 / <think> パーサ）
        │
llama.cpp :8080 Gemma 4（執筆・校正・画像）
llama.cpp :8081 ornith 9B（検索クエリ分解・要約・reasoning）
SQLite + sqlite-vec + FTS5（RAG・文書・ワークスペース）
```

- モデル同士は直接連携しない。FastAPI が仲介する疎結合（dual-port ルーティング）。
- LLM 呼び出しはすべて OpenAI 互換 `/v1/chat/completions`（執筆・校正はストリーミング）。
- ornith の出力は `<think>...</think>` を含むため、`think_parser` で除去してから利用する。

## 開発規約（spec.md §13 より）

- 命名: lowercase-hyphenated（プロジェクト・ディレクトリ）。
- 既存 ML コンポーネントは subprocess / HTTP でラップし、再実装しない。
- 埋め込みは Ruri、検索は hybrid（sqlite-vec ベクトル + FTS5 全文）固定。
- 文書の正は TipTap JSON（`content_json`）。Markdown は書き出し用の派生。
- LangChain 等の重いフレームワークは使わない。RAG / Web 検索の発火はアプリ側が明示制御。

## 作業開始時の確認

AGENTS.md の規定どおり、作業前に以下を読んで現在地を把握する。

1. `docs/plan/goals.md` — 目的・完成形・重視する価値
2. `docs/plan/plan.md` — 実装方針・優先順位・今後の予定
3. `docs/plan/progress.md` — 進捗・完了/未完了作業・注意点

計画と矛盾しそうな変更は、実装前にユーザーへ確認する。

## ドキュメント・バージョン管理

- `docs/**/*.md` の新規作成・更新時は、本文先頭付近に `作成日時: YYYY-MM-DD HH:MM` / `更新日時: YYYY-MM-DD HH:MM` を記録する。
- ユーザー向けの明確な変更は `docs/changelog.md`（日本語）に記録する。未確定分は「未リリース」セクションへ。
- アプリのバージョンは `package.json` の `version` が基準。
- `docs/reference/` は設計資料・調査資料の置き場。

## ファイル操作について

AGENTS.md の「読み取り手順」「書き込み手順」にある PowerShell スクリプトは、
ファイル操作ツールを持たないエージェント向けの代替手段。
Claude Code では組み込みの Read / Edit / Write ツールをそのまま使う（UTF-8 no BOM で書き込まれる）。
ファイル検索は Glob / Grep（`rg` 相当）を使う。

## 開発コマンド・環境

- `npm run dev` — Vite 開発サーバ + Electron 起動（vite-plugin-electron）。
- `npm run build` — `tsc --noEmit` で型検査後、renderer / main / preload をビルド。
- `npm start` — ビルド済み `dist-electron/main.js` で Electron 起動。
- `npm run backend` — FastAPI backend（uvicorn, 127.0.0.1:8000）。
- **データはライブラリ単位**: DB（文書・RAG）と画像は「ライブラリ」フォルダに保存（UI 上部のライブラリメニューで新規作成・切替）。既定は `data/`（gitignore 済み）。レジストリと llama-server の PID 記録は `~/.lm-text-editor/`。パスは必ず `backend/paths.py` の関数経由で解決する（import 時に固定すると切り替えが効かない）。
- `start.bat` — backend（別ウィンドウ）+ Vite + Electron の一括起動。ASCII のみで書く（cmd はシステムコードページで .bat を解釈するため日本語コメント禁止）。
- `start-llm.bat` — llama-server で Gemma 4 を 127.0.0.1:8080 に起動（ロードに 1〜2 分）。**通常は UI 上部のモデルバーから起動/停止する**（`backend/llm/manager.py` が subprocess 管理）。bat は外部起動用の代替手段で、その場合アプリからは停止できない。
- **注意**: Gemma 4 26B A4B は reasoning モデル。llama-server に `--reasoning-budget 0` を必ず付ける（外すと思考が max_tokens を食い潰し、HTTP 200 なのに content が空になる）。
- **LLM のモデル割り当ては設定（⚙️ → LLM）**: 文章用（:8080）と Web 検索用（:8081）を models/ から選択。検索用を「文章用と同じ」にすると検索・要約タスクも :8080 に流れ、ornith スロットは使われない（`router.search_base_url()` が動的に解決）。
- **ornith 9B（:8081）**: 検索クエリ分解・要約用の既定モデル。モデルバーの「検索LLM」から起動/停止（`backend/llm/manager.py` の ornith スロット）。`--jinja` で思考は reasoning_content に分離され、要約などの高頻度タスクは `chat_template_kwargs {"enable_thinking": false}` で思考を切る（ornith は一言の回答にも思考 ~1000 トークンを使う。news-picker の知見）。
- **Web 検索**: ddgs / DuckDuckGo（キー不要）が既定。`TAVILY_API_KEY`（環境変数または `~/.lm-text-editor/settings.json` の `tavily_api_key`）があれば Tavily を優先。
- **Python は必ず venv を使う**: リポジトリ直下の `.venv`（Python 3.13）。`.\.venv\Scripts\python.exe` を直接呼ぶか activate してから使う。システムの `python` は Windows Store スタブなので使わない（`py -3.13` ランチャー経由で venv を作る）。
- **注意**: VS Code 配下のターミナルは `ELECTRON_RUN_AS_NODE=1` を継承しており、そのままだと Electron が素の Node.js として起動して `app` が undefined になる。Electron を起動するコマンドの前に `Remove-Item Env:ELECTRON_RUN_AS_NODE` を実行すること。

## 検証

- **書き込みを伴う検証は、ユーザーの実データに対して絶対に行わない。** 一時ディレクトリに `paths.set_library_root()` したインプロセステストで行う。アクティブライブラリの DB・レジストリ（`~/.lm-text-editor/libraries.json`）に書き込みテストをしない。
- ポート 8000 の既存プロセスを止める前に、ユーザーがアプリを使用中でないか確認する（見覚えのないワークスペースがないか等）。使用中なら止めずに報告する。

- フロントエンドや型に関わる変更後は、可能な限り `npm run build` を実行する。
- バックエンド Python の単体ファイル変更では、可能な限り `py_compile` などで構文確認する。
- 検証できなかった場合は、その理由を作業報告に書く。

## リポジトリ内の大容量資産（コミット対象外）

- `models/` — GGUF モデル（Gemma 4, ornith 9B）と Ruri 埋め込みモデルのキャッシュ。
- `runtime/llama.cpp/` — llama.cpp のバイナリ・DLL 群。

いずれも .gitignore 済み。削除・移動しない。
