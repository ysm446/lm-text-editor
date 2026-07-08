import { useCallback, useEffect, useRef, useState } from 'react'
import Sidebar from './workspace/Sidebar'
import PaneResizer from './workspace/PaneResizer'
import Editor, { type RightTab } from './editor/Editor'
import ModelBar from './ModelBar'
import WebSearchPanel from './panels/WebSearchPanel'
import SourceViewer from './panels/SourceViewer'
import ImageLightbox from './panels/ImageLightbox'
import { showToast } from './Toast'
import StatusBar from './StatusBar'
import SettingsModal from './settings/SettingsModal'
import { GearIcon } from './icons'
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
  // 選択中ワークスペースの記憶（ライブラリ別。ID はライブラリ固有なのでパスでキーを分ける）
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null)
  const restoredWsRef = useRef(false) // 起動/ライブラリ切替後、保存済み選択の復元を一度だけ行う
  const selectedWsKey = (lib: string) => `lm-selected-ws:${lib}`
  const [titleDraft, setTitleDraft] = useState('')
  const [backendError, setBackendError] = useState<string | null>(null)
  const [webSearchOpen, setWebSearchOpen] = useState(false)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sources, setSources] = useState<RagSource[]>([])
  const [viewingSource, setViewingSource] = useState<RagSource | null>(null)
  const [viewingImage, setViewingImage] = useState<WorkspaceImage | null>(null)
  const [rightTab, setRightTab] = useState<RightTab>(null) // 右ペイン: 執筆支援 / チャット / 閉
  // ペイン幅（px・ドラッグで可変・localStorage に記憶）
  const PANE_MIN = 280
  const PANE_MAX = 900
  const [leftPaneWidth, setLeftPaneWidth] = useState(
    () => Number(localStorage.getItem('lm-pane-left-width')) || 480,
  )
  const [rightPaneWidth, setRightPaneWidth] = useState(
    () => Number(localStorage.getItem('lm-pane-right-width')) || 480,
  )
  const [paneResizing, setPaneResizing] = useState(false) // ドラッグ中は幅のトランジションを止める
  // 閉じるアニメーション中も内容を保持しておく（スライドアウトが空にならないように）
  const lastSource = useRef<RagSource | null>(null)
  if (viewingSource) lastSource.current = viewingSource
  const paneSource = viewingSource ?? lastSource.current
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
      if (activeLibrary) {
        localStorage.setItem(selectedWsKey(activeLibrary), String(id))
      }
    },
    [refreshWorkspaceAssets, activeLibrary],
  )

  // 起動時にアクティブライブラリのパスを取得（選択WS記憶のキーに使う）
  useEffect(() => {
    void api
      .libraryState()
      .then((s) => setActiveLibrary(s.active))
      .catch(() => undefined)
  }, [])

  // 保存済みの選択ワークスペースを復元する（ライブラリとワークスペース一覧が揃ったら一度だけ）
  useEffect(() => {
    if (restoredWsRef.current || activeLibrary == null || workspaces.length === 0) return
    restoredWsRef.current = true
    const raw = localStorage.getItem(selectedWsKey(activeLibrary))
    const id = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(id) && workspaces.some((w) => w.id === id)) {
      void selectWorkspace(id)
    }
  }, [activeLibrary, workspaces, selectWorkspace])

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

  // ライブラリ切替後は選択状態を捨てて全リロード。新ライブラリの保存済み選択を復元し直す
  const handleLibrarySwitched = useCallback(() => {
    setCurrentWsId(null)
    setDocs([])
    setCurrentDoc(null)
    setSources([])
    setImages([])
    restoredWsRef.current = false
    void api
      .libraryState()
      .then((s) => setActiveLibrary(s.active))
      .catch(() => setActiveLibrary(null))
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
      showToast('資料を追加しました')
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

  // 新規作成: 空のノートを即作成 → サイドバーへ反映 → 左ペインで編集を開く
  const createNote = useCallback(async () => {
    if (currentWsId == null) return
    const note = await api.createNote(currentWsId, '無題', '')
    await refreshWorkspaceAssets(currentWsId)
    setViewingSource({
      source_type: 'note',
      source_url: note.source_url,
      note_id: note.id,
      title: note.title,
      chunk_count: 0,
      note_count: 0,
      fetched_at: null,
    })
  }, [currentWsId, refreshWorkspaceAssets])

  const deleteSource = useCallback(
    async (source: RagSource) => {
      if (currentWsId == null) return
      if (!window.confirm('この資料を RAG から削除しますか？')) return
      await api.deleteRagSource(currentWsId, source.source_type, source.source_url)
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

  // 画像: カーソル位置に挿入 / ファイル追加 / 削除
  const insertImage = useCallback((image: WorkspaceImage) => {
    imageInserter.current?.(image.url)
  }, [])

  const addImageFiles = useCallback(
    async (files: FileList) => {
      if (currentWsId == null) return
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve((reader.result as string).split(',')[1])
          reader.onerror = () => reject(reader.error)
          reader.readAsDataURL(file)
        })
        await api.uploadAsset({
          workspace_id: currentWsId,
          filename: file.name || 'image.png',
          data_base64: base64,
        })
      }
      showToast('画像を追加しました')
      void refreshWorkspaceAssets(currentWsId)
    },
    [currentWsId, refreshWorkspaceAssets],
  )

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
        <div className="top-bar-left" />
        <div className="top-bar-center">
          <ModelBar />
        </div>
        <div className="top-bar-right">
          <button
            className="statusbar-toggle"
            onClick={() => void openSettings()}
            title="設定"
          >
            <GearIcon />
          </button>
        </div>
      </div>
      {viewingImage && (
        <ImageLightbox
          image={viewingImage}
          canInsert={currentDoc != null}
          onInsert={() => insertImage(viewingImage)}
          onDelete={() => {
            void deleteImage(viewingImage).then(() => setViewingImage(null))
          }}
          onClose={() => setViewingImage(null)}
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
        currentSource={viewingSource}
        onAddSourceFiles={(files) => void addSourceFiles(files)}
        onCreateNote={() => void createNote()}
        onWebSearch={() => setWebSearchOpen(true)}
        onViewSource={(s) =>
          // もう一度同じ資料を押したら閉じる（トグル）。閉じると選択も解除される
          setViewingSource((cur) =>
            cur &&
            cur.source_type === s.source_type &&
            (cur.source_url ?? '') === (s.source_url ?? '')
              ? null
              : s,
          )
        }
        onDeleteSource={(s) => void deleteSource(s)}
        canAddImages={currentWsId != null}
        onAddImageFiles={(files) => void addImageFiles(files)}
        onViewImage={setViewingImage}
        onDeleteImage={(img) => void deleteImage(img)}
        onLibrarySwitched={handleLibrarySwitched}
      />
      <main className="editor-area">
        <div className={`workbench${paneResizing ? ' resizing' : ''}`}>
          {/* 左ペイン: 資料（サイドバーの資料クリックでスライドイン） */}
          <aside
            className={`pane pane-left${viewingSource ? ' open' : ''}`}
            style={viewingSource ? { flexBasis: leftPaneWidth } : undefined}
          >
            <div className="pane-inner">
              {paneSource && currentWsId != null && (
                <SourceViewer
                  workspaceId={currentWsId}
                  source={paneSource}
                  onSaved={() => void refreshWorkspaceAssets(currentWsId)}
                  onClose={() => setViewingSource(null)}
                />
              )}
            </div>
          </aside>
          {viewingSource && (
            <PaneResizer
              side="left"
              width={leftPaneWidth}
              min={PANE_MIN}
              max={PANE_MAX}
              onChange={(w) => {
                setPaneResizing(true)
                setLeftPaneWidth(w)
              }}
              onCommit={(w) => {
                setPaneResizing(false)
                localStorage.setItem('lm-pane-left-width', String(w))
              }}
            />
          )}

          {/* 中央: 編集中の文章 */}
          <div className="doc-stage">
            {backendError && (
              <div className="backend-banner">
                {backendError}
                <button onClick={() => void refreshWorkspaces()}>再接続</button>
              </div>
            )}
            {currentDoc ? (
              <div className="doc-view">
                <Editor
                  key={currentDoc.id}
                  docId={currentDoc.id}
                  workspaceId={currentDoc.workspace_id}
                  initialContent={currentDoc.content_json}
                  draft={currentDoc.draft_json}
                  draftSavedAt={currentDoc.draft_saved_at}
                  onSaved={handleSaved}
                  onImageUploaded={() => void refreshWorkspaceAssets(currentWsId)}
                  registerImageInserter={(fn) => {
                    imageInserter.current = fn
                  }}
                  rightTab={rightTab}
                  onSetRightTab={setRightTab}
                  hasCustomReviewPrompt={Boolean(settings?.review_system_prompt?.trim())}
                  titleSlot={
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
                  }
                />
              </div>
            ) : (
              <div className="placeholder">
                {workspaces.length === 0
                  ? 'サイドバーからワークスペースを作成してください。'
                  : 'ドキュメントを選択または作成してください。'}
              </div>
            )}
          </div>

          {/* 右ペイン: 執筆支援 / チャット（Editor が portal で描画する） */}
          {rightTab && currentDoc && (
            <PaneResizer
              side="right"
              width={rightPaneWidth}
              min={PANE_MIN}
              max={PANE_MAX}
              onChange={(w) => {
                setPaneResizing(true)
                setRightPaneWidth(w)
              }}
              onCommit={(w) => {
                setPaneResizing(false)
                localStorage.setItem('lm-pane-right-width', String(w))
              }}
            />
          )}
          <aside
            className={`pane pane-right${rightTab && currentDoc ? ' open' : ''}`}
            style={rightTab && currentDoc ? { flexBasis: rightPaneWidth } : undefined}
          >
            <div className="pane-inner" id="assist-pane-root" />
          </aside>
        </div>
      </main>
      </div>
      <StatusBar visible={statusBarVisible} onToggle={toggleStatusBar} />
    </div>
  )
}
