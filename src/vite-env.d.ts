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
    chooseLibraryFolder: (mode?: 'open' | 'create') => Promise<string | null>
  }
}
