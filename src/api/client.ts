// FastAPI backend への薄いクライアント（spec.md §10）

export interface Workspace {
  id: number
  name: string
  created_at: string
}

export interface DocMeta {
  id: number
  title: string
  updated_at: string
}

export interface Doc {
  id: number
  workspace_id: number
  title: string
  content_json: unknown
  content_md: string | null
  updated_at: string
}

export interface Asset {
  id: number
  document_id: number
  rel_path: string
  caption: string | null
  created_at: string
  url: string // 絶対 URL（baseUrl 込み）
}

const baseUrl = window.lmEditor?.backend.baseUrl ?? 'http://127.0.0.1:8000'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

export interface Library {
  path: string
  name: string
  exists: boolean
  active: boolean
}

export interface LibraryState {
  active: string
  libraries: Library[]
}

export interface LocalModel {
  id: string
  path: string
  size_bytes: number
}

export interface LlamaStatus {
  status: 'stopped' | 'loading' | 'ready'
  active_model_path: string | null
  external: boolean
}

// ストリーミング API（text/plain チャンク）を async generator として読む
export async function* streamText(
  path: string,
  body: unknown,
): AsyncGenerator<string> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `${res.status}`
    try {
      detail = (JSON.parse(await res.text()) as { detail?: string }).detail ?? detail
    } catch {
      // JSON でなければステータスコードのまま
    }
    throw new Error(detail)
  }
  if (!res.body) throw new Error('response body is empty')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    yield decoder.decode(value, { stream: true })
  }
}

export const api = {
  listWorkspaces: () => request<Workspace[]>('/workspaces'),

  createWorkspace: (name: string) =>
    request<Workspace>('/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  listDocs: (workspaceId: number) =>
    request<DocMeta[]>(`/workspaces/${workspaceId}/docs`),

  createDoc: (workspaceId: number, title: string) =>
    request<Doc>('/docs', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, title }),
    }),

  getDoc: (docId: number) => request<Doc>(`/docs/${docId}`),

  updateDoc: (
    docId: number,
    body: { content_json?: unknown; content_md?: string; title?: string },
  ) =>
    request<{ ok: boolean }>(`/docs/${docId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  libraryState: () => request<LibraryState>('/library'),

  librarySwitch: (path: string) =>
    request<LibraryState>('/library/switch', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  libraryCreate: (path: string) =>
    request<LibraryState>('/library/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  listLocalModels: () => request<LocalModel[]>('/models/local'),

  llamaStatus: () => request<LlamaStatus>('/llama/status'),

  llamaSwitch: (modelPath: string) =>
    request<{ status: string }>('/llama/switch', {
      method: 'POST',
      body: JSON.stringify({ model_path: modelPath }),
    }),

  llamaEject: () =>
    request<{ status: string }>('/llama/eject', { method: 'POST' }),

  uploadAsset: async (body: {
    document_id: number
    filename: string
    data_base64: string
  }): Promise<Asset> => {
    const asset = await request<Omit<Asset, 'url'> & { url: string }>('/assets', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return { ...asset, url: `${baseUrl}${asset.url}` }
  },
}
