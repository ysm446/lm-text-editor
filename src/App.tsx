import { useCallback, useEffect, useState } from 'react'
import Sidebar from './workspace/Sidebar'
import Editor from './editor/Editor'
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

  const saveDoc = useCallback(
    (docId: number, contentJson: unknown, contentMd: string) => {
      void api.updateDoc(docId, { content_json: contentJson, content_md: contentMd })
    },
    [],
  )

  const saveTitle = useCallback(async () => {
    if (!currentDoc) return
    const title = titleDraft.trim() || '無題'
    if (title !== currentDoc.title) {
      await api.updateDoc(currentDoc.id, { title })
      setCurrentDoc({ ...currentDoc, title })
      if (currentWsId != null) {
        setDocs(await api.listDocs(currentWsId))
      }
    }
  }, [currentDoc, currentWsId, titleDraft])

  return (
    <div className="app">
      <Sidebar
        workspaces={workspaces}
        currentWorkspaceId={currentWsId}
        docs={docs}
        currentDocId={currentDoc?.id ?? null}
        onSelectWorkspace={(id) => void selectWorkspace(id)}
        onSelectDoc={(id) => void selectDoc(id)}
        onCreateWorkspace={(name) => void createWorkspace(name)}
        onCreateDoc={(title) => void createDoc(title)}
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
              onSave={saveDoc}
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
  )
}
