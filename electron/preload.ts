import { contextBridge } from 'electron'

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
})
