import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type LlamaStatus, type LocalModel } from './api/client'

const POLL_MS = 3000

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function sizeGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// LLM (llama-server) の状態表示・モデル選択・起動/停止バー
export default function ModelBar() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [status, setStatus] = useState<LlamaStatus | null>(null)
  const [ornith, setOrnith] = useState<LlamaStatus | null>(null)
  const [selected, setSelected] = useState('')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const poll = useCallback(async () => {
    try {
      const s = await api.llamaStatus()
      setStatus(s)
      if (s.status !== 'loading') setSwitching(false)
    } catch {
      setStatus(null) // backend 自体が落ちている
    }
    try {
      setOrnith(await api.ornithStatus())
    } catch {
      setOrnith(null)
    }
  }, [])

  useEffect(() => {
    void api.listLocalModels().then(setModels).catch(() => setModels([]))
    // 設定の既定モデル（文章用）をドロップダウンの初期選択にする
    void api
      .getSettings()
      .then((s) => {
        if (s.writing_model_path) {
          setSelected((cur) => cur || s.writing_model_path)
        }
      })
      .catch(() => undefined)
    void poll()
    timer.current = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [poll])

  // アクティブモデルが分かったらセレクトに反映
  useEffect(() => {
    if (status?.active_model_path) setSelected(status.active_model_path)
  }, [status?.active_model_path])

  const start = async () => {
    if (!selected) return
    setError(null)
    setSwitching(true)
    try {
      await api.llamaSwitch(selected)
      void poll()
    } catch (e) {
      setSwitching(false)
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const eject = async () => {
    setError(null)
    try {
      await api.llamaEject()
      void poll()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const st = status?.status ?? 'stopped'
  const loading = switching || st === 'loading'
  const activeName = status?.active_model_path
    ? fileName(status.active_model_path)
    : null
  const isActiveSelected =
    st === 'ready' && status?.active_model_path === selected

  return (
    <div className="model-bar">
      <span className={`model-dot ${loading ? 'loading' : st}`} />
      <span className="model-bar-status">
        {status == null && 'backend 未接続'}
        {status != null && loading && `モデル起動中…（1〜2分）${activeName ? ` ${activeName}` : ''}`}
        {status != null && !loading && st === 'ready' &&
          (status.external ? `外部起動の LLM (:8080)` : activeName ?? 'LLM 稼働中')}
        {status != null && !loading && st === 'stopped' && 'LLM 未起動'}
      </span>

      <div className="model-bar-controls">
        {error && <span className="model-bar-error">{error}</span>}
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={loading || models.length === 0}
        >
          <option value="">モデルを選択…</option>
          {models.map((m) => (
            <option key={m.path} value={m.path}>
              {m.id}（{sizeGB(m.size_bytes)}）
            </option>
          ))}
        </select>
        <button
          disabled={!selected || loading || status == null || status.external || isActiveSelected}
          onClick={() => void start()}
          title="選択したモデルで llama-server を起動（切替時は再起動）"
        >
          {st === 'ready' && !status?.external ? '切替' : '起動'}
        </button>
        {st !== 'stopped' && !status?.external && (
          <button
            disabled={status == null}
            onClick={() => void eject()}
            title="llama-server を停止して VRAM を解放"
          >
            停止
          </button>
        )}

        <span className="model-bar-divider" />
        <span
          className={`model-dot ${ornith?.status === 'loading' ? 'loading' : ornith?.status === 'shared' ? (st === 'ready' ? 'ready' : 'stopped') : (ornith?.status ?? 'stopped')}`}
        />
        <span className="ornith-label" title="検索クエリ分解・要約用の LLM (:8081)">
          検索LLM
        </span>
        {ornith?.status === 'shared' && (
          <span className="ornith-shared" title="設定で「文章用と同じ」が選ばれています">
            文章用と共用
          </span>
        )}
        {ornith?.status === 'stopped' && (
          <button
            disabled={ornith == null}
            onClick={() => void api.ornithStart().then(poll).catch((e) => setError(String(e)))}
            title="ornith 9B を起動（Web 検索のクエリ分解・要約に使用）"
          >
            起動
          </button>
        )}
        {ornith != null &&
          ornith.status !== 'stopped' &&
          ornith.status !== 'shared' &&
          !ornith.external && (
          <button
            onClick={() => void api.ornithStop().then(poll).catch((e) => setError(String(e)))}
            title="ornith 9B を停止"
          >
            停止
          </button>
        )}
      </div>
    </div>
  )
}
