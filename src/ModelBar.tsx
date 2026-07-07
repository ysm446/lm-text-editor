import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type LlamaStatus, type LocalModel } from './api/client'
import { ChevronDownIcon, CpuIcon } from './icons'

const POLL_MS = 3000

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function sizeGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// LLM のモデル状態を示すピル + クリックで開くモデル選択モーダル（video-content-analyzer 参考）
export default function ModelBar() {
  const [models, setModels] = useState<LocalModel[]>([])
  const [status, setStatus] = useState<LlamaStatus | null>(null)
  const [selected, setSelected] = useState('')
  const [switching, setSwitching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
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
    // 設定の既定モデル（文章用）を初期選択にする
    void api
      .getSettings()
      .then((s) => {
        if (s.writing_model_path) setSelected((cur) => cur || s.writing_model_path)
      })
      .catch(() => undefined)
    void poll()
    timer.current = window.setInterval(() => void poll(), POLL_MS)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [poll])

  // アクティブモデルが分かったら選択に反映
  useEffect(() => {
    if (status?.active_model_path) setSelected(status.active_model_path)
  }, [status?.active_model_path])

  const start = async () => {
    if (!selected) return
    setError(null)
    setSwitching(true)
    setModalOpen(false) // ロード状態はピルで見せる
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
  const ready = st === 'ready'
  const isActiveSelected = ready && status?.active_model_path === selected

  // ピルの状態クラスとラベル
  const pillState = loading ? 'loading' : ready ? 'on' : 'off'
  const label =
    status == null
      ? 'backend 未接続'
      : loading
        ? '起動中…（1〜2分）'
        : ready
          ? status.external
            ? '外部起動の LLM (:8080)'
            : status.active_model_path
              ? fileName(status.active_model_path)
              : 'LLM 稼働中'
          : 'モデルをロードしてください'

  return (
    <>
      <button
        className={`model-pill ${pillState}`}
        onClick={() => setModalOpen(true)}
        title="クリックしてモデルを選択・ロード"
      >
        <span className="model-pill-icon">
          <CpuIcon size={15} />
        </span>
        <span className="model-pill-text">{label}</span>
        <span className="model-pill-caret">
          <ChevronDownIcon size={13} />
        </span>
      </button>

      {modalOpen && (
        <div className="model-modal" onMouseDown={() => setModalOpen(false)}>
          <div className="model-modal-panel" onMouseDown={(e) => e.stopPropagation()}>
            <div className="model-modal-header">
              <span>モデル管理</span>
              <button className="model-modal-close" onClick={() => setModalOpen(false)}>
                ✕
              </button>
            </div>
            <div className="model-modal-body">
              <div className="modal-model-list">
                {models.length === 0 && (
                  <div className="revision-empty">models/ に GGUF が見つかりません。</div>
                )}
                {models.map((m) => {
                  const active = ready && status?.active_model_path === m.path
                  return (
                    <button
                      key={m.path}
                      className={`modal-model-item${selected === m.path ? ' selected' : ''}`}
                      onClick={() => setSelected(m.path)}
                    >
                      <div className="modal-model-main">
                        <div className="modal-model-name">{m.id}</div>
                        <div className="modal-model-meta">{sizeGB(m.size_bytes)}</div>
                      </div>
                      {active && <span className="modal-model-active">● ロード中</span>}
                    </button>
                  )
                })}
              </div>

              {error && <div className="model-bar-error">{error}</div>}

              <div className="modal-footer-row">
                <span className="modal-status-text">
                  {status == null
                    ? 'backend 未接続'
                    : loading
                      ? '起動中…'
                      : status.external
                        ? '外部起動の LLM'
                        : ready
                          ? 'ロード済み'
                          : '未ロード'}
                </span>
                <div className="modal-footer-actions">
                  <button
                    className="primary"
                    disabled={
                      !selected ||
                      loading ||
                      status == null ||
                      status.external ||
                      isActiveSelected
                    }
                    onClick={() => void start()}
                  >
                    {ready && !status?.external ? '切替' : 'ロード'}
                  </button>
                  <button
                    disabled={st === 'stopped' || status?.external || status == null}
                    onClick={() => void eject()}
                  >
                    アンロード
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
