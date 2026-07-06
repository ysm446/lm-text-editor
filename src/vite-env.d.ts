/// <reference types="vite/client" />

interface Window {
  lmEditor: {
    backend: {
      baseUrl: string
    }
    versions: {
      electron: string
      node: string
    }
  }
}
