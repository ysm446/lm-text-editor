import { useEffect, useState } from 'react'
import { api, type RagSource, type SourceDetail } from '../api/client'

interface SourceViewerProps {
  workspaceId: number
  source: RagSource
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  web: 'Web',
  article: '過去記事',
  reference: 'リファレンス',
}

// 取り込んだ資料の閲覧モーダル（要約ノート + 原文チャンク）
export default function SourceViewer({
  workspaceId,
  source,
  onClose,
}: SourceViewerProps) {
  const [detail, setDetail] = useState<SourceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .getRagSourceDetail(workspaceId, source.source_type, source.source_url)
      .then(setDetail)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [workspaceId, source])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isHttp = source.source_url?.startsWith('http')

  return (
    <div className="source-viewer">
        <div className="source-viewer-header">
          <span className="source-viewer-title">
            {TYPE_LABEL[source.source_type] ?? source.source_type}:{' '}
            {isHttp ? (
              <a
                href={source.source_url ?? '#'}
                target="_blank"
                rel="noreferrer"
                title="既定のブラウザで開く"
              >
                {source.source_url} ↗
              </a>
            ) : (
              (source.source_url ?? '（出典なし）')
            )}
          </span>
          <button onClick={onClose}>閉じる</button>
        </div>
        <div className="source-viewer-body">
          {error && <div className="web-search-error">{error}</div>}
          {!detail && !error && <div className="revision-empty">読込中…</div>}
          {detail && (
            <>
              {detail.notes.map((n) => (
                <div key={n.id} className="source-viewer-note">
                  <h3>要約ノート（ornith）</h3>
                  <div className="source-viewer-text">{n.summary}</div>
                </div>
              ))}
              <h3>
                原文チャンク（{detail.chunks.length} 件
                {detail.chunks[0]?.fetched_at
                  ? ` / 取得: ${new Date(detail.chunks[0].fetched_at).toLocaleString('ja-JP')}`
                  : ''}
                ）
              </h3>
              {detail.chunks.map((c, i) => (
                <div key={c.id} className="source-viewer-chunk">
                  <div className="source-viewer-chunk-label">#{i + 1}</div>
                  <div className="source-viewer-text">{c.chunk_text}</div>
                </div>
              ))}
            </>
          )}
        </div>
    </div>
  )
}
