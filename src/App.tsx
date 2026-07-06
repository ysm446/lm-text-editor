import { useCallback, useEffect, useState } from 'react'
import Sidebar from './workspace/Sidebar'
import Editor from './editor/Editor'
import ModelBar from './ModelBar'
import LibrarySwitcher from './LibrarySwitcher'
import { api, type Doc, type DocMeta, type Workspace } from './api/client'

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWsId, setCurrentWsId] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [currentDoc, setCurrentDoc] = useState<Doc | null>(null)
  const [titleDraft, setTitleDraft] = useState('')
  const [backendError, setBackendError] = useState<string | null>(null)

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

  const selectWorkspace = useCallback(async (id: number) => {
    setCurrentWsId(id)
    setCurrentDoc(null)
    setDocs(await api.listDocs(id))
  }, [])

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
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  return (
    <div className="app">
      <div className="top-bar">
        <LibrarySwitcher onSwitched={handleLibrarySwitched} />
        <ModelBar />
      </div>
      <div className="app-body">
        <Sidebar
        workspaces={workspaces}
        currentWorkspaceId={currentWsId}
        docs={docs}
        currentDocId={currentDoc?.id ?? null}
        onSelectWorkspace={(id) => void selectWorkspace(id)}
        onSelectDoc={(id) => void selectDoc(id)}
        onCreateWorkspace={(name) => void createWorkspace(name)}
        onCreateDoc={(title) => void createDoc(title)}
        onRenameWorkspace={(id, name) => void renameWorkspace(id, name)}
        onDeleteWorkspace={(id) => void deleteWorkspace(id)}
        onRenameDoc={(id, title) => void renameDoc(id, title)}
        onDeleteDoc={(id) => void deleteDoc(id)}
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
    </div>
  )
}
