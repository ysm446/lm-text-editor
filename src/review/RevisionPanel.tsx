import { useEffect, useState } from 'react'
import { api, type Revision, type RevisionMeta } from '../api/client'
import DiffText from './DiffText'

interface RevisionPanelProps {
  docId: number
  currentMd: string // パネルを開いた時点のエディタ内容（Markdown）
  onLoadRevision: (contentJson: unknown) => void
  onClose: () => void
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('ja-JP')
}

export default function RevisionPanel({
  docId,
  currentMd,
  onLoadRevision,
  onClose,
}: RevisionPanelProps) {
  const [revisions, setRevisions] = useState<RevisionMeta[] | null>(null)
  const [selected, setSelected] = useState<Revision | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void api
      .listRevisions(docId)
      .then(setRevisions)
      .catch((e) => setError(String(e instanceof Error ? e.message : e)))
  }, [docId])

  const select = async (meta: RevisionMeta) => {
    setError(null)
    try {
      setSelected(await api.getRevision(meta.id))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  return (
    <div className="revision-panel">
      <div className="revision-panel-header">
        <span>保存履歴</span>
        <div className="revision-panel-actions">
          {selected && (
            <button
              className="primary"
              onClick={() => {
                onLoadRevision(selected.content_json)
                onClose()
              }}
              title="この版の内容をエディタに読み込みます（保存するまで確定しません）"
            >
              この版を読み込む
            </button>
          )}
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
      <div className="revision-panel-body">
        <div className="revision-list">
          {revisions == null && !error && <div className="revision-empty">読込中…</div>}
          {revisions?.length === 0 && (
            <div className="revision-empty">まだ保存履歴がありません</div>
          )}
          {revisions?.map((r) => (
            <button
              key={r.id}
              className={`revision-item${selected?.id === r.id ? ' selected' : ''}`}
              onClick={() => void select(r)}
            >
              <span className="revision-title">{r.title}</span>
              <span className="revision-time">{formatTime(r.created_at)}</span>
            </button>
          ))}
        </div>
        <div className="revision-diff">
          {error && <span className="diff-error">{error}</span>}
          {!error && !selected && (
            <span className="revision-empty">
              版を選ぶと、その版 → 現在 の差分を表示します
            </span>
          )}
          {selected && (
            <DiffText original={selected.content_md ?? ''} revised={currentMd} />
          )}
        </div>
      </div>
    </div>
  )
}
