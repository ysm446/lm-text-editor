import { Fragment, useEffect, useRef, useState } from 'react'
import type { DocMeta, RagSource, Workspace, WorkspaceImage } from '../api/client'
import LibrarySwitcher from '../LibrarySwitcher'

// サイドバー幅（ドラッグで可変・localStorage に記憶）
const WIDTH_KEY = 'lm-sidebar-width'
const WIDTH_MIN = 180
const WIDTH_MAX = 520
const WIDTH_DEFAULT = 260

function initialWidth(): number {
  const raw = Number(localStorage.getItem(WIDTH_KEY))
  return Number.isFinite(raw) && raw >= WIDTH_MIN && raw <= WIDTH_MAX ? raw : WIDTH_DEFAULT
}

// ソースの表示名（URL はファイル名 / ホスト名に短縮）
// 資料の同一判定（種別 + URL。ノートも source_url を持つ）
function sameSource(a: RagSource | null, b: RagSource | null): boolean {
  return (
    a != null &&
    b != null &&
    a.source_type === b.source_type &&
    (a.source_url ?? '') === (b.source_url ?? '')
  )
}

function sourceLabel(s: RagSource): string {
  // 手動ノートはタイトルを表示（本文の正は manual_note 側）
  if (s.source_type === 'note') return s.title || '無題'
  if (!s.source_url) return `（${s.source_type}）`
  try {
    // ファイル（file:///<名前>）は末尾を復号して表示
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

interface NameInputProps {
  placeholder: string
  onSubmit: (name: string) => void
  onClose: () => void
}

// Electron では window.prompt が使えないため、インラインの入力欄で作成する
function NameInput({ placeholder, onSubmit, onClose }: NameInputProps) {
  const [value, setValue] = useState('')

  const submit = () => {
    const name = value.trim()
    if (name) onSubmit(name)
    onClose()
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
        if (e.key === 'Escape') onClose()
      }}
      onBlur={submit}
    />
  )
}

interface SectionHeadProps {
  label: string
  level: 2 | 3
  addTitle: string
  addDisabled?: boolean
  onAdd: () => void
  // フォルダのように開閉する場合に指定（見出しクリックでトグル）
  expanded?: boolean
  onToggle?: () => void
}

// セクション見出し + 右端の「＋」追加ボタン。expanded 指定時は開閉トグルになる
function SectionHead({
  label,
  level,
  addTitle,
  addDisabled,
  onAdd,
  expanded,
  onToggle,
}: SectionHeadProps) {
  const Tag = level === 2 ? 'h2' : 'h3'
  const collapsible = expanded !== undefined
  return (
    <Tag className="section-head">
      {collapsible ? (
        <button className="section-toggle" onClick={onToggle}>
          <span className="ws-caret">{expanded ? '▾' : '▸'}</span>
          {label}
        </button>
      ) : (
        <span>{label}</span>
      )}
      <button
        className="section-add"
        title={addTitle}
        disabled={addDisabled}
        onClick={onAdd}
      >
        ＋
      </button>
    </Tag>
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
  currentSource: RagSource | null // 左ペインで表示中の資料（ドキュメント選択とは別管理）
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
  onCreateNote: () => void // 新規ノートを作成して左ペインで編集を開く
  onWebSearch: () => void // Web 検索パネルを開く
  onViewSource: (source: RagSource) => void
  onDeleteSource: (source: RagSource) => void
  canAddImages: boolean // 画像はワークスペース単位。ワークスペースを開いているときのみ
  onAddImageFiles: (files: FileList) => void
  onViewImage: (image: WorkspaceImage) => void
  onDeleteImage: (image: WorkspaceImage) => void
  onLibrarySwitched: () => void // 下部フッターのライブラリ（Vault 相当）切替
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
  currentSource,
  onAddSourceFiles,
  onCreateNote,
  onWebSearch,
  onViewSource,
  onDeleteSource,
  canAddImages,
  onAddImageFiles,
  onViewImage,
  onDeleteImage,
  onLibrarySwitched,
}: SidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState<'workspace' | 'doc' | null>(null)
  // 幅の可変（右端ハンドルのドラッグ）
  const [width, setWidth] = useState(initialWidth)
  const resize = useRef<{ startX: number; startWidth: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    resize.current = { startX: e.clientX, startWidth: width }
    setResizing(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resize.current
    if (!r) return
    setWidth(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, r.startWidth + e.clientX - r.startX)))
  }

  const onResizeUp = () => {
    if (!resize.current) return
    resize.current = null
    setResizing(false)
    setWidth((w) => {
      localStorage.setItem(WIDTH_KEY, String(w))
      return w
    })
  }
  // 選択とは別に開閉状態を持つ（選択中でも折りたためる）。選択が変わったら自動で開く
  const [expandedId, setExpandedId] = useState<number | null>(currentWorkspaceId)
  useEffect(() => {
    setExpandedId(currentWorkspaceId)
  }, [currentWorkspaceId])

  // 配下セクション（ドキュメント / 資料 / 画像）のフォルダ開閉。既定は全て開・localStorage に記憶
  type SectionKey = 'docs' | 'sources' | 'images'
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(() => {
    try {
      const raw = localStorage.getItem('lm-sidebar-sections')
      if (raw) return { docs: true, sources: true, images: true, ...JSON.parse(raw) }
    } catch {
      /* 壊れた保存値は無視 */
    }
    return { docs: true, sources: true, images: true }
  })
  const toggleSection = (key: SectionKey) =>
    setOpenSections((s) => {
      const next = { ...s, [key]: !s[key] }
      localStorage.setItem('lm-sidebar-sections', JSON.stringify(next))
      return next
    })
  const openSection = (key: SectionKey) =>
    setOpenSections((s) => {
      if (s[key]) return s
      const next = { ...s, [key]: true }
      localStorage.setItem('lm-sidebar-sections', JSON.stringify(next))
      return next
    })

  // 資料（RAG）の＋メニュー（新規作成 / ファイル読み込み / ウェブ検索）
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false)
  const sourceMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!sourceMenuOpen) return
    const onClick = (e: MouseEvent) => {
      if (sourceMenuRef.current && !sourceMenuRef.current.contains(e.target as Node)) {
        setSourceMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [sourceMenuOpen])
  // 選択中ワークスペースの配下ツリー（ドキュメント / 資料 / 画像）
  const renderChildren = () => (
    <li className="ws-children">
      <div className="sub-section">
        <SectionHead
          label="ドキュメント"
          level={3}
          addTitle="新規ドキュメント"
          expanded={openSections.docs}
          onToggle={() => toggleSection('docs')}
          onAdd={() => {
            openSection('docs')
            setCreating('doc')
          }}
        />
        {openSections.docs && (
          <>
            {creating === 'doc' && (
              <NameInput
                placeholder="新規ドキュメント名"
                onSubmit={onCreateDoc}
                onClose={() => setCreating(null)}
              />
            )}
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
          </>
        )}
      </div>

      <div className="sub-section">
        <div className="source-add-anchor" ref={sourceMenuRef}>
          <SectionHead
            label="資料（RAG）"
            level={3}
            addTitle="資料を追加（新規 / ファイル / Web 検索）"
            expanded={openSections.sources}
            onToggle={() => toggleSection('sources')}
            onAdd={() => setSourceMenuOpen((v) => !v)}
          />
          {sourceMenuOpen && (
            <div className="source-add-menu">
              <button
                onClick={() => {
                  setSourceMenuOpen(false)
                  openSection('sources')
                  onCreateNote()
                }}
              >
                新規作成（Markdown を書く）
              </button>
              <button
                onClick={() => {
                  setSourceMenuOpen(false)
                  openSection('sources')
                  fileInputRef.current?.click()
                }}
              >
                ファイル読み込み
              </button>
              <button
                onClick={() => {
                  setSourceMenuOpen(false)
                  onWebSearch()
                }}
              >
                ウェブ検索
              </button>
            </div>
          )}
        </div>
        {openSections.sources && (
          <ul>
            {sources.map((s) => (
              <li key={`${s.source_type}:${s.source_url ?? ''}`} className="item-row">
                <button
                  className={`source-item${sameSource(currentSource, s) ? ' selected' : ''}`}
                  title={`${s.source_url ?? s.source_type}\n${s.chunk_count} チャンク${s.note_count > 0 ? ' + 要約ノート' : ''}\nクリックで内容を表示（もう一度で閉じる）`}
                  onClick={() => onViewSource(s)}
                >
                  <span className={`source-badge type-${s.source_type}`}>
                    {s.source_type === 'web'
                      ? 'W'
                      : s.source_type === 'article'
                        ? 'A'
                        : s.source_type === 'note'
                          ? 'M'
                          : 'R'}
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
        )}
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

      <div className="sub-section">
        <SectionHead
          label="画像"
          level={3}
          addTitle={
            canAddImages
              ? '画像ファイルを追加（開いているドキュメントに登録）'
              : 'ドキュメントを開くと画像を追加できます'
          }
          addDisabled={!canAddImages}
          expanded={openSections.images}
          onToggle={() => toggleSection('images')}
          onAdd={() => {
            openSection('images')
            imageInputRef.current?.click()
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files?.length) onAddImageFiles(e.target.files)
            e.target.value = ''
          }}
        />
        {openSections.images && images.length > 0 && (
          <div className="image-grid">
            {images.map((img) => (
              <div key={img.id} className="image-thumb-wrap">
                <img
                  className="image-thumb"
                  src={img.url}
                  title={`${img.rel_path}\nクリックで拡大表示`}
                  onClick={() => onViewImage(img)}
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
        )}
      </div>
    </li>
  )

  return (
    <div className="sidebar-wrap" style={{ width }}>
    <aside className="sidebar">
      <div className="sidebar-scroll">
      <section className="sidebar-section">
        <SectionHead
          label="ワークスペース"
          level={2}
          addTitle="新規ワークスペース"
          onAdd={() => setCreating('workspace')}
        />
        {creating === 'workspace' && (
          <NameInput
            placeholder="新規ワークスペース名"
            onSubmit={onCreateWorkspace}
            onClose={() => setCreating(null)}
          />
        )}
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
      </section>
      </div>
      {/* 下部フッター: ライブラリ（Obsidian の Vault 相当） */}
      <div className="sidebar-footer">
        <LibrarySwitcher onSwitched={onLibrarySwitched} />
      </div>
    </aside>
    <div
      className={`sidebar-resizer${resizing ? ' dragging' : ''}`}
      onPointerDown={onResizeDown}
      onPointerMove={onResizeMove}
      onPointerUp={onResizeUp}
      title="ドラッグで幅を変更"
    />
    </div>
  )
}
