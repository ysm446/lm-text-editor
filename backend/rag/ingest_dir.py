"""過去記事・リファレンスの一括投入 CLI（グローバル知識ベース向け）。

使い方:
    .venv\\Scripts\\python.exe -m backend.rag.ingest_dir path/to/articles --source-type article
    .venv\\Scripts\\python.exe -m backend.rag.ingest_dir path/to/refs --source-type reference --glob "**/*.md"
"""

from __future__ import annotations

import argparse
from pathlib import Path

from backend.rag import store


def main() -> None:
    parser = argparse.ArgumentParser(description="ディレクトリ内のテキストを RAG に一括投入")
    parser.add_argument("directory", type=Path)
    parser.add_argument(
        "--source-type",
        choices=["article", "reference"],
        default="article",
    )
    parser.add_argument("--glob", default="**/*.md", help="対象ファイルのパターン")
    args = parser.parse_args()

    if not args.directory.is_dir():
        raise SystemExit(f"ディレクトリが見つかりません: {args.directory}")

    store.init_rag_schema()
    total_files = 0
    total_chunks = 0
    for path in sorted(args.directory.glob(args.glob)):
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if not text.strip():
            continue
        ids = store.ingest(
            args.source_type,
            text,
            workspace_id=None,  # グローバル
            source_url=path.resolve().as_uri(),
        )
        total_files += 1
        total_chunks += len(ids)
        print(f"  {path.name}: {len(ids)} chunks")

    print(f"done: {total_files} files, {total_chunks} chunks (total in db: {store.chunk_count()})")


if __name__ == "__main__":
    main()
