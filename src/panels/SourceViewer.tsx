import { useEffect, useState } from 'react'
import {
  api,
  type NoteRevisionMeta,
  type RagSource,
  type SourceDetail,
} from '../api/client'

interface SourceViewerProps {
  workspaceId: number
  source: RagSource
  onSaved: () => void // 手動ノート保存後にサイドバーを更新する
  onClose: () => void
}

const TYPE_LABEL: Record<string, string> = {
  web: 'Web',
  article: '過去記事',
  reference: 'リファレンス',
  note: 'メモ',
}

// 資料の閲覧 / 編集ペイン。手動ノート（note）は編集可能、それ以外は読み取り専用
export default function SourceViewer({
  workspaceId,
  source,
  onSaved,
  onClose,
}: SourceViewerProps) {
  const editable = source.source_type === 'note' && source.note_id != null

  // 読み取り専用（Web・ファイル等）の詳細
  const [detail, setDetail] = useState<SourceDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 編集（手動ノート）の状態
  const [title, setTitle] = useState(source.title ?? '無題')
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  // 世代履歴（更新時に旧本文が退避される。読み込み → 保存で復元が確定する）
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState<NoteRevisionMeta[] | null>(null)

  useEffect(() => {
    setError(null)
    if (editable && source.note_id != null) {
      setLoaded(false)
      setDirty(false)
      void api
        .getNote(source.note_id)
        .then((n) => {
          setTitle(n.title)
          setContent(n.content)
          setLoaded(true)
        })
        .catch((e) => setError(String(e instanceof Error ? e.message : e)))
    } else {
      setDetail(null)
      void api
        .getRagSourceDetail(workspaceId, source.source_type, source.source_url)
        .then(setDetail)
        .catch((e) => setError(String(e instanceof Error ? e.message : e)))
    }
  }, [workspaceId, source, editable])

  const save = async () => {
    if (source.note_id == null || saving) return
    setSaving(true)
    setError(null)
    try {
      await api.updateNote(source.note_id, title.trim() || '無題', content)
      setDirty(false)
      setRevisions(null) // 保存で世代が増えている可能性があるので次回開くとき再取得
      onSaved()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const toggleHistory = async () => {
    if (source.note_id == null) return
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && revisions == null) {
      try {
        setRevisions(await api.listNoteRevisions(source.note_id))
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e))
      }
    }
  }

  const loadRevision = async (rev: NoteRevisionMeta) => {
    if (source.note_id == null) return
    if (
      dirty &&
      !window.confirm('未保存の変更があります。破棄して履歴を読み込みますか？')
    )
      return
    try {
      const full = await api.getNoteRevision(source.note_id, rev.id)
      setTitle(full.title)
      setContent(full.content)
      setDirty(true) // 「保存」で復元が確定する
      setHistoryOpen(false)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  // 読み取り専用は Esc で閉じる。編集中は誤操作で内容を失わないよう Esc で閉じない
  useEffect(() => {
    if (editable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, editable])

  if (editable) {
    return (
      <div className="source-viewer">
        <div className="source-viewer-header">
          <input
            className="source-viewer-title-input"
            value={title}
            placeholder="タイトル"
            onChange={(e) => {
              setTitle(e.target.value)
              setDirty(true)
            }}
          />
          <button
            className="primary"
            disabled={!loaded || !dirty || saving}
            onClick={() => void save()}
            title="Markdown を段落ごとにチャンク分割して検索に登録します"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          <button
            onClick={() => void toggleHistory()}
            title="更新前の本文（世代履歴）を表示します"
          >
            履歴
          </button>
          <button onClick={onClose}>閉じる</button>
        </div>
        {error && <div className="web-search-error">{error}</div>}
        {historyOpen && (
          <div className="note-history">
            {revisions == null && <div className="revision-empty">読込中…</div>}
            {revisions != null && revisions.length === 0 && (
              <div className="revision-empty">履歴はまだありません（更新すると旧本文が残ります）</div>
            )}
            {revisions?.map((r) => (
              <button
                key={r.id}
                className="note-history-item"
                onClick={() => void loadRevision(r)}
                title="この世代を編集エリアに読み込みます（「保存」で復元が確定）"
              >
                <span className="note-history-date">
                  {new Date(r.created_at).toLocaleString('ja-JP')}
                </span>
                <span className="note-history-title">{r.title}</span>
              </button>
            ))}
          </div>
        )}
        <textarea
          className="source-viewer-textarea"
          placeholder="Markdown で資料を記述します。保存すると段落ごとにチャンク分割され、RAG（検索）に登録されます。"
          value={content}
          disabled={!loaded}
          onChange={(e) => {
            setContent(e.target.value)
            setDirty(true)
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
              e.preventDefault()
              void save()
            }
          }}
          spellCheck={false}
        />
      </div>
    )
  }

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
            source.source_url ?? '（出典なし）'
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
                <h3>要約ノート（LLM）</h3>
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
