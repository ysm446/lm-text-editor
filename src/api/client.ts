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
