import { useState } from 'react'

interface NewSourceEditorProps {
  onSave: (title: string, content: string) => Promise<void>
  onClose: () => void
}

// 資料（RAG）の手動追加: Markdown を書いて保存するとチャンク化して登録する
export default function NewSourceEditor({ onSave, onClose }: NewSourceEditorProps) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saving

  const save = async () => {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      await onSave(title.trim(), content)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
      setSaving(false)
    }
  }

  return (
    <div className="split-review-overlay" onMouseDown={onClose}>
      <div className="note-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="note-editor-header">
          <input
            className="note-editor-title"
            placeholder="タイトル"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className="note-editor-actions">
            {error && <span className="save-error">{error}</span>}
            <button className="primary" disabled={!canSave} onClick={() => void save()}>
              {saving ? '保存中…' : '保存してチャンク化'}
            </button>
            <button onClick={onClose}>閉じる</button>
          </div>
        </div>
        <textarea
          className="note-editor-textarea"
          placeholder="Markdown で資料を記述します。保存すると段落ごとにチャンク分割され、RAG（検索）に登録されます。"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
