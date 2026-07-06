import { useState } from 'react'
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

interface SidebarProps {
  workspaces: Workspace[]
  currentWorkspaceId: number | null
  docs: DocMeta[]
  currentDocId: number | null
  onSelectWorkspace: (id: number) => void
  onSelectDoc: (id: number) => void
  onCreateWorkspace: (name: string) => void
  onCreateDoc: (title: string) => void
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
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <h2>ワークスペース</h2>
        <ul>
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <button
                className={ws.id === currentWorkspaceId ? 'item selected' : 'item'}
                onClick={() => onSelectWorkspace(ws.id)}
              >
                {ws.name}
              </button>
            </li>
          ))}
        </ul>
        <InlineCreate placeholder="新規ワークスペース" onCreate={onCreateWorkspace} />
      </section>

      {currentWorkspaceId != null && (
        <section className="sidebar-section">
          <h2>ドキュメント</h2>
          <ul>
            {docs.map((doc) => (
              <li key={doc.id}>
                <button
                  className={doc.id === currentDocId ? 'item selected' : 'item'}
                  onClick={() => onSelectDoc(doc.id)}
                >
                  {doc.title}
                </button>
              </li>
            ))}
          </ul>
          <InlineCreate placeholder="新規ドキュメント" onCreate={onCreateDoc} />
        </section>
      )}
    </aside>
  )
}
