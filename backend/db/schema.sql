-- lm-text-editor スキーマ（spec.md §4）
-- RAG 関連（rag_chunk / source_note / sqlite-vec / FTS5）はフェーズ 3 で追加する。

CREATE TABLE IF NOT EXISTS workspace (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document (
  id INTEGER PRIMARY KEY,
  workspace_id INTEGER NOT NULL REFERENCES workspace(id),
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,      -- TipTap の JSON（正）
  content_md TEXT,                 -- Markdown シリアライズ（書き出し用キャッシュ）
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS asset (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES document(id),
  rel_path TEXT NOT NULL,          -- ワークスペース基準の相対パス
  caption TEXT,
  created_at TEXT NOT NULL
);
