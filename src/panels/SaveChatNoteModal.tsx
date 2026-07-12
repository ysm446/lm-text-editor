import { useEffect, useState } from 'react'
import { api, type ChatSource, type RagSource } from '../api/client'
import { showToast } from '../Toast'

interface SaveChatNoteModalProps {
  workspaceId: number
  question: string | null // 直前のユーザー発話（タイトル候補）
  answer: string // 保存する返答本文（Markdown）
  sources?: ChatSource[] | null // Web 検索の出典（あれば「## 参考」に載せる）
  onSaved: () => void // 保存後にサイドバーの資料一覧を更新する
  onClose: () => void
}

// 返答 + 出典を保存用 Markdown に整形する（出典 URL と取得日を残す）
function composeMd(answer: string, sources?: ChatSource[] | null): string {
  const today = new Date().toISOString().slice(0, 10)
  let md = answer.trim()
  if (sources && sources.length > 0) {
    const refs = sources
      .map((s) => `- [${s.title || s.url}](${s.url})（${today} 取得）`)
      .join('\n')
    md += `\n\n## 参考\n${refs}`
  }
  return md
}

function defaultTitle(question: string | null): string {
  const line = (question ?? '').split('\n')[0].trim()
  if (!line) return '無題'
  return line.length > 40 ? `${line.slice(0, 40)}…` : line
}

// チャットの返答を資料（RAG）へ保存するモーダル。
// 「新規ノート」はそのまま保存、「既存ノートへ追記」は LLM の統合案を
// プレビュー確認してから上書きする（更新前の本文は世代履歴に退避される）。
export default function SaveChatNoteModal({
  workspaceId,
  question,
  answer,
  sources,
  onSaved,
  onClose,
}: SaveChatNoteModalProps) {
  const [mode, setMode] = useState<'new' | 'append'>('new')
  const [notes, setNotes] = useState<RagSource[]>([])
  const [title, setTitle] = useState(() => defaultTitle(question))
  const [content, setContent] = useState(() => composeMd(answer, sources))
  const [noteId, setNoteId] = useState<number | null>(null)
  const [merged, setMerged] = useState<string | null>(null) // 統合案（null = 未作成）
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 追記先の候補 = 手動ノート（M）だけ。原文系資料（Web / ファイル）は出典の写しなので混ぜない
  useEffect(() => {
    void api
      .listRagSources(workspaceId)
      .then((all) => {
        const manual = all.filter(
          (s) => s.source_type === 'note' && s.note_id != null,
        )
        setNotes(manual)
        setNoteId((cur) => cur ?? manual[0]?.note_id ?? null)
      })
      .catch(() => setNotes([]))
  }, [workspaceId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const saveNew = async () => {
    if (busy || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.createNote(workspaceId, title.trim() || '無題', content)
      showToast('資料（ノート）として保存しました')
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const makeMerge = async () => {
    if (busy || noteId == null || !content.trim()) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.mergeNote(noteId, content)
      setMerged(res.merged)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const saveMerged = async () => {
    if (busy || noteId == null || merged == null || !merged.trim()) return
    const note = notes.find((n) => n.note_id === noteId)
    setBusy(true)
    setError(null)
    try {
      await api.updateNote(noteId, note?.title ?? '無題', merged)
      showToast('ノートをまとめなおして保存しました（旧本文は履歴に退避）')
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="model-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="model-modal-panel chat-save-panel">
        <div className="model-modal-header">
          <span>チャットを資料（RAG）へ保存</span>
          <button className="model-modal-close" onClick={onClose} title="閉じる">
            ✕
          </button>
        </div>
        <div className="model-modal-body">
          <div className="chat-save-mode-row">
            <button
              type="button"
              className={`rag-toggle-btn${mode === 'new' ? ' active' : ''}`}
              onClick={() => setMode('new')}
            >
              新規ノート
            </button>
            <button
              type="button"
              className={`rag-toggle-btn${mode === 'append' ? ' active' : ''}`}
              onClick={() => {
                setMode('append')
                setMerged(null)
              }}
              disabled={notes.length === 0}
              title={
                notes.length === 0
                  ? '追記できる手動ノート（M）がまだありません'
                  : '既存の手動ノートに LLM でまとめなおして追記します'
              }
            >
              既存ノートへ追記
            </button>
          </div>

          {mode === 'new' && (
            <>
              <input
                className="chat-save-title"
                value={title}
                placeholder="タイトル"
                onChange={(e) => setTitle(e.target.value)}
              />
              <textarea
                className="chat-save-textarea"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
              <div className="modal-footer-row">
                <span className="modal-status-text">
                  保存すると資料（M ノート）として検索に登録されます
                </span>
                <div className="modal-footer-actions">
                  <button
                    className="primary"
                    disabled={busy || !content.trim()}
                    onClick={() => void saveNew()}
                  >
                    {busy ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            </>
          )}

          {mode === 'append' && (
            <>
              <select
                className="chat-save-note-select"
                value={noteId ?? ''}
                onChange={(e) => {
                  setNoteId(Number(e.target.value))
                  setMerged(null)
                }}
              >
                {notes.map((n) => (
                  <option key={n.note_id} value={n.note_id ?? ''}>
                    {n.title ?? '無題'}
                  </option>
                ))}
              </select>
              {merged == null ? (
                <>
                  <textarea
                    className="chat-save-textarea"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="modal-footer-row">
                    <span className="modal-status-text">
                      LLM が既存ノートと統合した案を作り、確認してから上書きします
                    </span>
                    <div className="modal-footer-actions">
                      <button
                        className="primary"
                        disabled={busy || noteId == null || !content.trim()}
                        onClick={() => void makeMerge()}
                      >
                        {busy ? '統合案を作成中…' : 'まとめなおし案を作成'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <textarea
                    className="chat-save-textarea"
                    value={merged}
                    onChange={(e) => setMerged(e.target.value)}
                    spellCheck={false}
                  />
                  <div className="modal-footer-row">
                    <span className="modal-status-text">
                      統合案です。編集できます。上書き前の本文は履歴に残ります
                    </span>
                    <div className="modal-footer-actions">
                      <button onClick={() => setMerged(null)} disabled={busy}>
                        戻る
                      </button>
                      <button
                        className="primary"
                        disabled={busy || !merged.trim()}
                        onClick={() => void saveMerged()}
                      >
                        {busy ? '保存中…' : 'この内容で上書き保存'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {error && <div className="web-search-error">{error}</div>}
        </div>
      </div>
    </div>
  )
}
