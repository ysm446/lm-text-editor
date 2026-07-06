import { useEffect, useRef, useState } from 'react'
import type { DocMeta, Workspace } from '../api/client'

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
  onSelect: () => void
  onRename: (name: string) => void
  onDelete: () => void
}

// 一覧の 1 行。「…」からポップアップメニュー（名前を変更 / 削除）
function ItemRow({ label, selected, onSelect, onRename, onDelete }: ItemRowProps) {
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
  onSelectWorkspace: (id: number) => void
  onSelectDoc: (id: number) => void
  onCreateWorkspace: (name: string) => void
  onCreateDoc: (title: string) => void
  onRenameWorkspace: (id: number, name: string) => void
  onDeleteWorkspace: (id: number) => void
  onRenameDoc: (id: number, title: string) => void
  onDeleteDoc: (id: number) => void
}

export default function Sidebar({
  workspaces,
  currentWorkspaceId,
  docs,
  currentDocId,
  onSelectWorkspace,
  onSelectDoc,
  onCreateWorkspace,
  onCreateDoc,
  onRenameWorkspace,
  onDeleteWorkspace,
  onRenameDoc,
  onDeleteDoc,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <h2>ワークスペース</h2>
        <ul>
          {workspaces.map((ws) => (
            <ItemRow
              key={ws.id}
              label={ws.name}
              selected={ws.id === currentWorkspaceId}
              onSelect={() => onSelectWorkspace(ws.id)}
              onRename={(name) => onRenameWorkspace(ws.id, name)}
              onDelete={() => onDeleteWorkspace(ws.id)}
            />
          ))}
        </ul>
        <InlineCreate placeholder="新規ワークスペース" onCreate={onCreateWorkspace} />
      </section>

      {currentWorkspaceId != null && (
        <section className="sidebar-section">
          <h2>ドキュメント</h2>
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
        </section>
      )}
    </aside>
  )
}
