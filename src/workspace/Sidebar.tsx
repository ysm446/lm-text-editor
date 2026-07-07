import { Fragment, useEffect, useRef, useState } from 'react'
import type { DocMeta, RagSource, Workspace, WorkspaceImage } from '../api/client'

// ソースの表示名（URL はファイル名 / ホスト名に短縮）
function sourceLabel(s: RagSource): string {
  if (!s.source_url) return `（${s.source_type}）`
  try {
    if (s.source_url.startsWith('file://')) {
      return decodeURIComponent(s.source_url.split('/').pop() ?? s.source_url)
    }
    const u = new URL(s.source_url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last ? `${u.hostname}/${last}` : u.hostname
  } catch {
    return s.source_url
  }
}

interface InlineCreateProps {
  placeholder: string
  onCreate: (name: string) => void
}

// Electron では window.prompt が使えないため、インラインの入力欄で作成する
function InlineCreate({ placeholder, onCreate }: InlineCreateProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')

  const submit = () => {
    const name = value.trim()
    if (name) {
      onCreate(name)
    }
    setValue('')
    setOpen(false)
  }

  if (!open) {
    return (
      <button className="inline-create-toggle" onClick={() => setOpen(true)}>
        ＋ {placeholder}
      </button>
    )
  }
  return (
    <input
      className="inline-create-input"
      autoFocus
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit()
        if (e.key === 'Escape') {
          setValue('')
          setOpen(false)
        }
      }}
      onBlur={submit}
    />
  )
}

interface ItemRowProps {
  label: string
  selected: boolean
  expanded?: boolean // ワークスペース行のみ: ▾/▸ の展開インジケータ
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
}

// 一覧の 1 行。「…」からポップアップメニュー（名前を変更 / 削除）
function ItemRow({ label, selected, expanded, onSelect, onRename, onDelete }: ItemRowProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const rootRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const submitRename = () => {
    const name = value.trim()
    setEditing(false)
    if (name && name !== label) onRename(name)
  }

  if (editing) {
    return (
      <li ref={rootRef}>
        <input
          className="inline-create-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitRename()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={submitRename}
        />
      </li>
    )
  }

  return (
    <li ref={rootRef} className="item-row">
      <button className={selected ? 'item selected' : 'item'} onClick={onSelect}>
        {expanded !== undefined && (
          <span className="ws-caret">{expanded ? '▾' : '▸'}</span>
        )}
        {label}
      </button>
      <button
        className="item-menu-btn"
        title="メニュー"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((v) => !v)
        }}
      >
        …
      </button>
      {menuOpen && (
        <div className="item-popup">
          <button
            onClick={() => {
              setMenuOpen(false)
              setValue(label)
              setEditing(true)
            }}
          >
            名前を変更
          </button>
          <button
            className="danger"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
          >
            削除
          </button>
        </div>
      )}
    </li>
  )
}

interface SidebarProps {
  workspaces: Workspace[]
  currentWorkspaceId: number | null
  docs: DocMeta[]
  currentDocId: number | null
  sources: RagSource[]
  images: WorkspaceImage[]
  onSelectWorkspace: (id: number) => void
  onSelectDoc: (id: number) => void
  onCreateWorkspace: (name: string) => void
  onCreateDoc: (title: string) => void
  onRenameWorkspace: (id: number, name: string) => void
  onDeleteWorkspace: (id: number) => void
  onRenameDoc: (id: number, title: string) => void
  onDeleteDoc: (id: number) => void
  onAddSourceFiles: (files: FileList) => void
  onViewSource: (source: RagSource) => void
  onDeleteSource: (source: RagSource) => void
  onInsertImage: (image: WorkspaceImage) => void
  onDeleteImage: (image: WorkspaceImage) => void
}

export default function Sidebar({
  workspaces,
  currentWorkspaceId,
  docs,
  currentDocId,
  sources,
  images,
  onSelectWorkspace,
  onSelectDoc,
  onCreateWorkspace,
  onCreateDoc,
  onRenameWorkspace,
  onDeleteWorkspace,
  onRenameDoc,
  onDeleteDoc,
  onAddSourceFiles,
  onViewSource,
  onDeleteSource,
  onInsertImage,
  onDeleteImage,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 選択とは別に開閉状態を持つ（選択中でも折りたためる）。選択が変わったら自動で開く
  const [expandedId, setExpandedId] = useState<number | null>(currentWorkspaceId)
  useEffect(() => {
    setExpandedId(currentWorkspaceId)
  }, [currentWorkspaceId])
  // 選択中ワークスペースの配下ツリー（ドキュメント / 資料 / 画像）
  const renderChildren = () => (
    <li className="ws-children">
      <div className="sub-section">
        <h3>ドキュメント</h3>
        <ul>
          {docs.map((doc) => (
            <ItemRow
              key={doc.id}
              label={doc.title}
              selected={doc.id === currentDocId}
              onSelect={() => onSelectDoc(doc.id)}
              onRename={(title) => onRenameDoc(doc.id, title)}
              onDelete={() => onDeleteDoc(doc.id)}
            />
          ))}
        </ul>
        <InlineCreate placeholder="新規ドキュメント" onCreate={onCreateDoc} />
      </div>

      <div className="sub-section">
        <h3>資料（RAG）</h3>
        <ul>
          {sources.map((s) => (
            <li key={`${s.source_type}:${s.source_url ?? ''}`} className="item-row">
              <button
                className="source-item"
                title={`${s.source_url ?? s.source_type}\n${s.chunk_count} チャンク${s.note_count > 0 ? ' + 要約ノート' : ''}\nクリックで内容を表示`}
                onClick={() => onViewSource(s)}
              >
                <span className={`source-badge type-${s.source_type}`}>
                  {s.source_type === 'web' ? 'W' : s.source_type === 'article' ? 'A' : 'R'}
                </span>
                <span className="source-name">{sourceLabel(s)}</span>
                <span className="source-count">{s.chunk_count}</span>
              </button>
              <button
                className="item-menu-btn"
                title="この資料を削除"
                onClick={() => onDeleteSource(s)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          className="inline-create-toggle"
          onClick={() => fileInputRef.current?.click()}
        >
          ＋ ファイルを追加（.md / .txt）
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.markdown,.txt"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) onAddSourceFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {images.length > 0 && (
        <div className="sub-section">
          <h3>画像</h3>
          <div className="image-grid">
            {images.map((img) => (
              <div key={img.id} className="image-thumb-wrap">
                <img
                  className="image-thumb"
                  src={img.url}
                  title={`${img.rel_path}\nクリックでカーソル位置に挿入`}
                  onClick={() => onInsertImage(img)}
                />
                <button
                  className="image-thumb-delete"
                  title="この画像を削除"
                  onClick={() => onDeleteImage(img)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </li>
  )

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <h2>ワークスペース</h2>
        <ul>
          {workspaces.map((ws) => {
            const isCurrent = ws.id === currentWorkspaceId
            const isExpanded = isCurrent && expandedId === ws.id
            return (
              <Fragment key={ws.id}>
                <ItemRow
                  label={ws.name}
                  selected={isCurrent}
                  expanded={isExpanded}
                  onSelect={() => {
                    if (isCurrent) {
                      // 選択中の行をもう一度クリックで開閉
                      setExpandedId(isExpanded ? null : ws.id)
                    } else {
                      onSelectWorkspace(ws.id)
                    }
                  }}
                  onRename={(name) => onRenameWorkspace(ws.id, name)}
                  onDelete={() => onDeleteWorkspace(ws.id)}
                />
                {isExpanded && renderChildren()}
              </Fragment>
            )
          })}
        </ul>
        <InlineCreate placeholder="新規ワークスペース" onCreate={onCreateWorkspace} />
      </section>
    </aside>
  )
}
