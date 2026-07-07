import { useState } from 'react'
import { api, type WebIngestResult, type WebSearchResult } from '../api/client'

interface WebSearchPanelProps {
  workspaceId: number | null // 取り込みのスコープ（現在のワークスペース）
  onClose: () => void
}

type IngestState =
  | { status: 'ingesting' }
  | ({ status: 'done' } & WebIngestResult)
  | { status: 'error'; error: string }

// Web 検索 → 取り込み（原文チャンク + ソースノート）のモーダルパネル
export default function WebSearchPanel({ workspaceId, onClose }: WebSearchPanelProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<WebSearchResult[] | null>(null)
  const [queries, setQueries] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ingests, setIngests] = useState<Record<string, IngestState>>({})

  const runSearch = async () => {
    const q = query.trim()
    if (!q || searching) return
    setSearching(true)
    setError(null)
    setResults(null)
    try {
      const res = await api.webSearch(q)
      setResults(res.results)
      setQueries(res.queries)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSearching(false)
    }
  }

  const ingest = async (url: string) => {
    setIngests((m) => ({ ...m, [url]: { status: 'ingesting' } }))
    try {
      const res = await api.webIngest(url, workspaceId)
      setIngests((m) => ({ ...m, [url]: { status: 'done', ...res } }))
    } catch (e) {
      setIngests((m) => ({
        ...m,
        [url]: { status: 'error', error: String(e instanceof Error ? e.message : e) },
      }))
    }
  }

  return (
    <div className="split-review-overlay">
      <div className="web-search">
        <div className="web-search-header">
          <span>Web 検索{workspaceId == null ? '' : '（取り込み先: 現在のワークスペース）'}</span>
          <div className="web-search-actions">
            <button onClick={onClose}>閉じる</button>
          </div>
        </div>
        <div className="web-search-form">
          <input
            autoFocus
            placeholder="調べたいこと（例: sqlite-vec の最新バージョンと変更点）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
            }}
            disabled={searching}
          />
          <button disabled={searching || !query.trim()} onClick={() => void runSearch()}>
            {searching ? '検索中…' : '検索'}
          </button>
        </div>
        {queries.length > 1 && (
          <div className="web-search-queries">
            検索クエリ（ornith 分解）: {queries.join(' / ')}
          </div>
        )}
        {error && <div className="web-search-error">{error}</div>}
        <div className="web-search-results">
          {results?.length === 0 && (
            <div className="revision-empty">結果が見つかりませんでした</div>
          )}
          {results?.map((r) => {
            const ing = ingests[r.url]
            return (
              <div key={r.url} className="web-result">
                <div className="web-result-main">
                  <div className="web-result-title">{r.title}</div>
                  <div className="web-result-url">{r.url}</div>
                  {r.snippet && <div className="web-result-snippet">{r.snippet}</div>}
                  {ing?.status === 'done' && (
                    <div className="web-result-ingested">
                      ✓ 取り込みました（原文 {ing.chunk_ids.length} チャンク
                      {ing.note_id != null ? ' + 要約ノート' : ''}）
                      {ing.summary && (
                        <div className="web-result-summary">{ing.summary}</div>
                      )}
                    </div>
                  )}
                  {ing?.status === 'error' && (
                    <div className="web-search-error">{ing.error}</div>
                  )}
                </div>
                <div className="web-result-actions">
                  <button
                    disabled={ing?.status === 'ingesting' || ing?.status === 'done'}
                    onClick={() => void ingest(r.url)}
                    title="本文を取得して RAG に保存します（原文チャンク + ornith 要約）"
                  >
                    {ing?.status === 'ingesting'
                      ? '取り込み中…'
                      : ing?.status === 'done'
                        ? '取り込み済み'
                        : '取り込む'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
