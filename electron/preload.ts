import { contextBridge, ipcRenderer } from 'electron'

// FastAPI backend (localhost) の接続情報。
// renderer はこの baseUrl 経由で backend を叩く（spec.md §10）。
contextBridge.exposeInMainWorld('lmEditor', {
  backend: {
    baseUrl: 'http://127.0.0.1:8000',
  },
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
  },
  chooseLibraryFolder: (mode?: 'open' | 'create') =>
    ipcRenderer.invoke('lm-editor:choose-library-folder', mode) as Promise<
      string | null
    >,
})
