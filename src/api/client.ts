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
  draft_json: unknown | null
  draft_saved_at: string | null
}

export interface RevisionMeta {
  id: number
  title: string
  created_at: string
}

export interface Revision extends RevisionMeta {
  document_id: number
  content_json: unknown
  content_md: string | null
}

export interface Asset {
  id: number
  workspace_id: number
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

export interface RagSource {
  source_type: string // 'article' | 'reference' | 'web' | 'note'
  source_url: string | null
  chunk_count: number
  note_count: number
  fetched_at: string | null
  note_id?: number | null // source_type === 'note' のときの手動ノート id
  title?: string | null // 手動ノートの表示タイトル
}

export interface NoteContent {
  id: number
  workspace_id: number | null
  title: string
  content: string
}

export interface SourceDetail {
  chunks: { id: number; chunk_text: string; fetched_at: string | null }[]
  notes: { id: number; summary: string; fetched_at: string | null }[]
}

export interface WorkspaceImage {
  id: number
  workspace_id: number
  rel_path: string
  caption: string | null
  created_at: string
  url: string
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
  query: string
}

export interface WebIngestResult {
  url: string
  title: string
  chunk_ids: number[]
  note_id: number | null
  summary: string | null
}

export interface AppSettings {
  theme: string // 'light' | 'dark'（今後パターン追加予定）
  editor_font_size: number
  tavily_api_key: string
  writing_model_path: string // 文章用 LLM（'' = 未設定）。検索・要約もこのモデルを使う
  context_length: number // llama-server の -c（次回起動時から反映）
  review_system_prompt: string // 校正のシステムプロンプト上書き（'' = 既定）
}

export interface GpuStat {
  name: string
  gpu_percent: number
  vram_used_gb: number
  vram_total_gb: number
  vram_percent: number
}

export interface SystemResources {
  cpu_percent: number
  ram_used_gb: number
  ram_total_gb: number
  ram_percent: number
  gpus: GpuStat[]
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

export interface EmbedStatus {
  model: string
  installed: boolean
  loaded: boolean
  installing: boolean
  error: string | null
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

  renameDoc: (docId: number, title: string) =>
    request<{ ok: boolean }>(`/docs/${docId}`, {
      method: 'PUT',
      body: JSON.stringify({ title }),
    }),

  saveDoc: (
    docId: number,
    body: { content_json: unknown; content_md?: string; title?: string },
  ) =>
    request<{ ok: boolean }>(`/docs/${docId}/save`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  saveDraft: (docId: number, contentJson: unknown) =>
    request<{ ok: boolean }>(`/docs/${docId}/draft`, {
      method: 'POST',
      body: JSON.stringify({ content_json: contentJson }),
    }),

  clearDraft: (docId: number) =>
    request<{ ok: boolean }>(`/docs/${docId}/draft`, {
      method: 'POST',
      body: JSON.stringify({ content_json: null }),
    }),

  listRevisions: (docId: number) =>
    request<RevisionMeta[]>(`/docs/${docId}/revisions`),

  getRevision: (revisionId: number) =>
    request<Revision>(`/revisions/${revisionId}`),

  deleteDoc: (docId: number) =>
    request<{ ok: boolean }>(`/docs/${docId}`, { method: 'DELETE' }),

  renameWorkspace: (workspaceId: number, name: string) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    }),

  deleteWorkspace: (workspaceId: number) =>
    request<{ ok: boolean }>(`/workspaces/${workspaceId}`, { method: 'DELETE' }),

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

  promptDefaults: () => request<{ review_system: string }>('/prompts/defaults'),

  embedStatus: () => request<EmbedStatus>('/embed/status'),

  embedInstall: () => request<EmbedStatus>('/embed/install', { method: 'POST' }),

  systemResources: () => request<SystemResources>('/system/resources'),

  getSettings: () => request<AppSettings>('/settings'),

  updateSettings: (patch: Partial<AppSettings>) =>
    request<AppSettings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  listRagSources: (workspaceId: number) =>
    request<RagSource[]>(`/rag/sources?workspace_id=${workspaceId}`),

  ragIngest: (body: {
    source_type: string
    content: string
    workspace_id: number | null
    source_url?: string
  }) =>
    request<{ ok: boolean; chunk_ids: number[] }>('/rag/ingest', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createNote: (workspaceId: number, title: string, content: string) =>
    request<NoteContent & { source_url: string }>('/rag/note', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, title, content }),
    }),

  getNote: (noteId: number) => request<NoteContent>(`/rag/note/${noteId}`),

  updateNote: (noteId: number, title: string, content: string) =>
    request<NoteContent & { source_url: string }>(`/rag/note/${noteId}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content }),
    }),

  getRagSourceDetail: (
    workspaceId: number,
    sourceType: string,
    sourceUrl: string | null,
  ) =>
    request<SourceDetail>('/rag/sources/detail', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId,
        source_type: sourceType,
        source_url: sourceUrl,
      }),
    }),

  deleteRagSource: (
    workspaceId: number,
    sourceType: string,
    sourceUrl: string | null,
  ) =>
    request<{ ok: boolean }>('/rag/sources/delete', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: workspaceId,
        source_type: sourceType,
        source_url: sourceUrl,
      }),
    }),

  listWorkspaceImages: (workspaceId: number) =>
    request<WorkspaceImage[]>(`/workspaces/${workspaceId}/images`).then((imgs) =>
      imgs.map((i) => ({ ...i, url: `${baseUrl}${i.url}` })),
    ),

  deleteAsset: (assetId: number) =>
    request<{ ok: boolean }>(`/assets/${assetId}`, { method: 'DELETE' }),

  webSearch: (query: string, maxResults = 8) =>
    request<{ queries: string[]; results: WebSearchResult[]; provider: string }>(
      '/web/search',
      {
        method: 'POST',
        body: JSON.stringify({ query, max_results: maxResults }),
      },
    ),

  webIngest: (url: string, workspaceId: number | null) =>
    request<WebIngestResult>('/web/ingest', {
      method: 'POST',
      body: JSON.stringify({ url, workspace_id: workspaceId }),
    }),

  uploadAsset: async (body: {
    workspace_id: number
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
