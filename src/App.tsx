import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './workspace/Sidebar'
import Editor from './editor/Editor'
import ModelBar from './ModelBar'
import LibrarySwitcher from './LibrarySwitcher'
import WebSearchPanel from './panels/WebSearchPanel'
import SourceViewer from './panels/SourceViewer'
import StatusBar from './StatusBar'
import SettingsModal from './settings/SettingsModal'
import { ChartIcon, GearIcon, SearchIcon } from './icons'
import {
  api,
  type AppSettings,
  type Doc,
  type DocMeta,
  type RagSource,
  type Workspace,
  type WorkspaceImage,
} from './api/client'

function applySettings(s: AppSettings) {
  document.documentElement.dataset.theme = s.theme
  window.localStorage.setItem('lm-editor.theme', s.theme)
  document.documentElement.style.setProperty(
    '--editor-font-size',
    `${s.editor_font_size}px`,
  )
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWsId, setCurrentWsId] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [currentDoc, setCurrentDoc] = useState<Doc | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [backendError, setBackendError] = useState<string | null>(null)
  const [webSearchOpen, setWebSearchOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sources, setSources] = useState<RagSource[]>([])
  const [viewingSource, setViewingSource] = useState<RagSource | null>(null)
  const [images, setImages] = useState<WorkspaceImage[]>([])
  const imageInserter = useRef<((url: string) => void) | null>(null)

  const refreshWorkspaceAssets = useCallback(async (wsId: number | null) => {
    if (wsId == null) {
      setSources([])
      setImages([])
      return
    }
    const [s, i] = await Promise.all([
      api.listRagSources(wsId).catch(() => []),
      api.listWorkspaceImages(wsId).catch(() => []),
    ])
    setSources(s)
    setImages(i)
  }, [])

  useEffect(() => {
    void api
      .getSettings()
      .then((s) => {
        setSettings(s)
        applySettings(s)
      })
      .catch(() => undefined)
  }, [])

  const changeSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = await api.updateSettings(patch)
    setSettings(next)
    applySettings(next)
  }, [])

  // 起動時の取得に失敗していても、クリック時に再取得してから開く
  const openSettings = useCallback(async () => {
    if (settings == null) {
      try {
        const s = await api.getSettings()
        setSettings(s)
        applySettings(s)
      } catch {
        window.alert(
          '設定 API に接続できません。backend が古いか停止しています。start.bat を再起動してください。',
        )
        return
      }
    }
    setSettingsOpen(true)
  }, [settings])
  const [statusBarVisible, setStatusBarVisible] = useState(
    () => window.localStorage.getItem('lm-editor.statusBar') !== 'off',
  )

  const toggleStatusBar = () => {
    setStatusBarVisible((v) => {
      window.localStorage.setItem('lm-editor.statusBar', v ? 'off' : 'on')
      return !v
    })
  }

  const refreshWorkspaces = useCallback(async () => {
    try {
      setWorkspaces(await api.listWorkspaces())
      setBackendError(null)
    } catch {
      setBackendError(
        'backend (127.0.0.1:8000) に接続できません。`npm run backend` で起動してから「再接続」を押してください。',
      )
    }
  }, [])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    setTitleDraft(currentDoc?.title ?? '')
  }, [currentDoc?.id, currentDoc?.title])

  const selectWorkspace = useCallback(
    async (id: number) => {
      setCurrentWsId(id)
      setCurrentDoc(null)
      setDocs(await api.listDocs(id))
      void refreshWorkspaceAssets(id)
    },
    [refreshWorkspaceAssets],
  )

  const selectDoc = useCallback(async (id: number) => {
    setCurrentDoc(await api.getDoc(id))
  }, [])

  const createWorkspace = useCallback(
    async (name: string) => {
      const ws = await api.createWorkspace(name)
      await refreshWorkspaces()
      await selectWorkspace(ws.id)
    },
    [refreshWorkspaces, selectWorkspace],
  )

  const createDoc = useCallback(
    async (title: string) => {
      if (currentWsId == null) return
      const doc = await api.createDoc(currentWsId, title)
      setDocs(await api.listDocs(currentWsId))
      setCurrentDoc(doc)
    },
    [currentWsId],
  )

  // 明示保存の完了後に一覧の並び（updated_at 順）を更新する
  const handleSaved = useCallback(() => {
    if (currentWsId != null) {
      void api.listDocs(currentWsId).then(setDocs)
    }
  }, [currentWsId])

  const saveTitle = useCallback(async () => {
    if (!currentDoc) return
    const title = titleDraft.trim() || '無題'
    if (title !== currentDoc.title) {
      await api.renameDoc(currentDoc.id, title)
      setCurrentDoc({ ...currentDoc, title })
      if (currentWsId != null) {
        setDocs(await api.listDocs(currentWsId))
      }
    }
  }, [currentDoc, currentWsId, titleDraft])

  const renameWorkspace = useCallback(
    async (id: number, name: string) => {
      await api.renameWorkspace(id, name)
      await refreshWorkspaces()
    },
    [refreshWorkspaces],
  )

  const deleteWorkspace = useCallback(
    async (id: number) => {
      const ws = workspaces.find((w) => w.id === id)
      if (
        !window.confirm(
          `ワークスペース「${ws?.name ?? id}」を削除しますか？\n中のドキュメント・画像・RAG データもすべて削除されます。`,
        )
      )
        return
      await api.deleteWorkspace(id)
      if (id === currentWsId) {
        setCurrentWsId(null)
        setDocs([])
        setCurrentDoc(null)
      }
      await refreshWorkspaces()
    },
    [currentWsId, refreshWorkspaces, workspaces],
  )

  const renameDoc = useCallback(
    async (id: number, title: string) => {
      await api.renameDoc(id, title)
      if (currentWsId != null) setDocs(await api.listDocs(currentWsId))
      if (currentDoc?.id === id) setCurrentDoc({ ...currentDoc, title })
    },
    [currentDoc, currentWsId],
  )

  const deleteDoc = useCallback(
    async (id: number) => {
      const doc = docs.find((d) => d.id === id)
      if (
        !window.confirm(
          `ドキュメント「${doc?.title ?? id}」を削除しますか？\n保存履歴・画像も削除されます。`,
        )
      )
        return
      await api.deleteDoc(id)
      if (currentDoc?.id === id) setCurrentDoc(null)
      if (currentWsId != null) setDocs(await api.listDocs(currentWsId))
    },
    [currentDoc, currentWsId, docs],
  )

  // ライブラリ切替後は選択状態を捨てて全リロード
  const handleLibrarySwitched = useCallback(() => {
    setCurrentWsId(null)
    setDocs([])
    setCurrentDoc(null)
    setSources([])
    setImages([])
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  // 資料（RAG）: テキスト / Markdown ファイルの追加・削除
  const addSourceFiles = useCallback(
    async (files: FileList) => {
      if (currentWsId == null) return
      for (const file of Array.from(files)) {
        const content = await file.text()
        if (!content.trim()) continue
        await api.ragIngest({
          source_type: 'reference',
          content,
          workspace_id: currentWsId,
          source_url: `file:///${encodeURIComponent(file.name)}`,
        })
      }
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

  const deleteSource = useCallback(
    async (source: RagSource) => {
      if (currentWsId == null) return
      if (!window.confirm('この資料を RAG から削除しますか？')) return
      await api.deleteRagSource(currentWsId, source.source_type, source.source_url)
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

  // 画像: カーソル位置に挿入 / 削除
  const insertImage = useCallback((image: WorkspaceImage) => {
    imageInserter.current?.(image.url)
  }, [])

  const deleteImage = useCallback(
    async (image: WorkspaceImage) => {
      if (
        !window.confirm(
          'この画像を削除しますか？\n本文に挿入済みの画像は表示されなくなります。',
        )
      )
        return
      await api.deleteAsset(image.id)
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

  return (
    <div className="app">
      <div className="top-bar">
        <LibrarySwitcher onSwitched={handleLibrarySwitched} />
        <button
          className="web-search-toggle"
          onClick={() => setWebSearchOpen(true)}
          title="Web 検索して資料を取り込む（原文チャンク + 要約ノート）"
        >
          <SearchIcon /> Web 検索
        </button>
        <ModelBar />
        <button
          className={`statusbar-toggle${statusBarVisible ? ' active' : ''}`}
          onClick={toggleStatusBar}
          title={statusBarVisible ? 'リソースモニターを隠す' : 'リソースモニターを表示'}
        >
          <ChartIcon />
        </button>
        <button
          className="statusbar-toggle"
          onClick={() => void openSettings()}
          title="設定"
        >
          <GearIcon />
        </button>
      </div>
      {viewingSource && currentWsId != null && (
        <SourceViewer
          workspaceId={currentWsId}
          source={viewingSource}
          onClose={() => setViewingSource(null)}
        />
      )}
      {settingsOpen && settings && (
        <SettingsModal
          settings={settings}
          onChange={(patch) => void changeSettings(patch)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {webSearchOpen && (
        <WebSearchPanel
          workspaceId={currentWsId}
          onClose={() => {
            setWebSearchOpen(false)
            void refreshWorkspaceAssets(currentWsId) // 取り込んだ資料を一覧へ反映
          }}
        />
      )}
      <div className="app-body">
        <Sidebar
        workspaces={workspaces}
        currentWorkspaceId={currentWsId}
        docs={docs}
        currentDocId={currentDoc?.id ?? null}
        sources={sources}
        images={images}
        onSelectWorkspace={(id) => void selectWorkspace(id)}
        onSelectDoc={(id) => void selectDoc(id)}
        onCreateWorkspace={(name) => void createWorkspace(name)}
        onCreateDoc={(title) => void createDoc(title)}
        onRenameWorkspace={(id, name) => void renameWorkspace(id, name)}
        onDeleteWorkspace={(id) => void deleteWorkspace(id)}
        onRenameDoc={(id, title) => void renameDoc(id, title)}
        onDeleteDoc={(id) => void deleteDoc(id)}
        onAddSourceFiles={(files) => void addSourceFiles(files)}
        onViewSource={setViewingSource}
        onDeleteSource={(s) => void deleteSource(s)}
        onInsertImage={insertImage}
        onDeleteImage={(img) => void deleteImage(img)}
      />
      <main className="editor-area">
        {backendError && (
          <div className="backend-banner">
            {backendError}
            <button onClick={() => void refreshWorkspaces()}>再接続</button>
          </div>
        )}
        {currentDoc ? (
          <div className="doc-view">
            <input
              className="doc-title"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder="タイトル"
            />
            <Editor
              key={currentDoc.id}
              docId={currentDoc.id}
              initialContent={currentDoc.content_json}
              draft={currentDoc.draft_json}
              draftSavedAt={currentDoc.draft_saved_at}
              onSaved={handleSaved}
              onImageUploaded={() => void refreshWorkspaceAssets(currentWsId)}
              registerImageInserter={(fn) => {
                imageInserter.current = fn
              }}
            />
          </div>
        ) : (
          <div className="placeholder">
            {workspaces.length === 0
              ? 'サイドバーからワークスペースを作成してください。'
              : 'ドキュメントを選択または作成してください。'}
          </div>
        )}
        </main>
      </div>
      {statusBarVisible && <StatusBar />}
    </div>
  )
}
