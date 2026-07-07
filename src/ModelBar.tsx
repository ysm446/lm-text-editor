import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type LlamaStatus, type LocalModel } from './api/client'

const POLL_MS = 3000

function sizeGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// LLM (llama-server) の状態表示・モデル選択・起動/停止バー
export default function ModelBar() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [status, setStatus] = useState<LlamaStatus | null>(null)
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
  const isActiveSelected =
    st === 'ready' && status?.active_model_path === selected

  return (
    <div className={`model-bar${loading ? ' loading' : ''}`}>
      <span className={`model-dot ${loading ? 'loading' : st}`} />
      {/* 状態は原則バー（ドット + セレクト）で表現。特殊な状態だけテキストを出す */}
      {status == null && <span className="model-bar-status">backend 未接続</span>}
      {status != null && loading && (
        <span className="model-bar-status">起動中…（1〜2分）</span>
      )}
      {status != null && !loading && st === 'ready' && status.external && (
        <span className="model-bar-status">外部起動の LLM (:8080)</span>
      )}

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
      </div>
    </div>
  )
}
