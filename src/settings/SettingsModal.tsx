import { useEffect, useState, type ReactNode } from 'react'
import { api, type AppSettings, type EmbedStatus, type LocalModel } from '../api/client'
import { BookIcon, PencilIcon, PromptIcon, SearchIcon, SunIcon } from '../icons'

type Category = 'appearance' | 'editor' | 'llm' | 'prompts' | 'websearch'

const CATEGORIES: { key: Category; label: string; icon: ReactNode }[] = [
  { key: 'appearance', label: '外観', icon: <SunIcon /> },
  { key: 'editor', label: 'エディタ', icon: <PencilIcon size={14} /> },
  { key: 'llm', label: 'LLM', icon: <BookIcon size={14} /> },
  { key: 'prompts', label: 'プロンプト', icon: <PromptIcon size={14} /> },
  { key: 'websearch', label: 'Web 検索', icon: <SearchIcon /> },
]

// テーマのパターンを増やす場合はここに追加（styles.css の [data-theme='…'] と対応）
const THEMES: { value: string; label: string }[] = [
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

const FONT_SIZES = [14, 15, 16, 17, 18, 20]

// コンテキスト長スライダーの選択肢（backend/llm/manager.py の CONTEXT_LENGTHS と対応）
const CONTEXT_LENGTHS = [4096, 8192, 16384, 32768, 65536, 131072, 262144]
const ctxLabel = (n: number) => `${n / 1024}k`

interface SettingsModalProps {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void // 変更は即保存・即適用
  onClose: () => void
}

// 設定モーダル（lm-chat の SettingsModal を参考: 左カテゴリ + 右パネル、Esc で閉じる）
export default function SettingsModal({
  settings,
  onChange,
  onClose,
}: SettingsModalProps) {
  const [active, setActive] = useState<Category>('appearance')
  const [tavilyDraft, setTavilyDraft] = useState(settings.tavily_api_key)
  const [models, setModels] = useState<LocalModel[]>([])
  const [embed, setEmbed] = useState<EmbedStatus | null>(null)
  // 校正プロンプト: 既定値と編集中ドラフト（空設定のときは既定を表示して編集させる）
  const [reviewDefault, setReviewDefault] = useState('')
  const [reviewDraft, setReviewDraft] = useState(settings.review_system_prompt)

  useEffect(() => {
    void api.listLocalModels().then(setModels).catch(() => setModels([]))
    void api.embedStatus().then(setEmbed).catch(() => setEmbed(null))
    void api
      .promptDefaults()
      .then((d) => {
        setReviewDefault(d.review_system)
        // 上書きが無ければ既定を編集の起点として表示する
        if (!settings.review_system_prompt) setReviewDraft(d.review_system)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // インストール中は状態をポーリングして完了/失敗を反映する
  useEffect(() => {
    if (!embed?.installing) return
    const timer = window.setInterval(() => {
      void api.embedStatus().then(setEmbed).catch(() => undefined)
    }, 2000)
    return () => window.clearInterval(timer)
  }, [embed?.installing])

  const installEmbed = () => {
    void api
      .embedInstall()
      .then(setEmbed)
      .catch(() => setEmbed(null))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="split-review-overlay">
      <div className="settings-modal">
        <div className="settings-modal-header">
          <span>設定</span>
          <button onClick={onClose}>閉じる</button>
        </div>
        <div className="settings-modal-body">
          <nav className="settings-nav">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                className={active === c.key ? 'active' : ''}
                onClick={() => setActive(c.key)}
              >
                <span aria-hidden>{c.icon}</span> {c.label}
              </button>
            ))}
          </nav>
          <div className="settings-panel">
            {active === 'appearance' && (
              <section>
                <h3>テーマ</h3>
                <p className="settings-desc">エディタ全体の配色を切り替えます。</p>
                <div className="settings-theme-options">
                  {THEMES.map((t) => (
                    <label
                      key={t.value}
                      className={`settings-theme-option${settings.theme === t.value ? ' selected' : ''}`}
                    >
                      <input
                        type="radio"
                        name="theme"
                        checked={settings.theme === t.value}
                        onChange={() => onChange({ theme: t.value })}
                      />
                      <span className={`settings-theme-swatch theme-${t.value}`} />
                      {t.label}
                    </label>
                  ))}
                </div>
              </section>
            )}
            {active === 'editor' && (
              <section>
                <h3>本文のフォントサイズ</h3>
                <p className="settings-desc">エディタ本文の文字サイズ（px）。</p>
                <select
                  value={settings.editor_font_size}
                  onChange={(e) =>
                    onChange({ editor_font_size: Number(e.target.value) })
                  }
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}px
                    </option>
                  ))}
                </select>
              </section>
            )}
            {active === 'llm' && (
              <>
                <section>
                  <h3>LLM モデル</h3>
                  <p className="settings-desc">
                    モデルバーの「起動」で使われる既定モデル。執筆・校正・Web
                    検索のクエリ分解・要約すべてにこのモデルを使います。切替は次回起動時から。
                  </p>
                  <select
                    value={settings.writing_model_path}
                    onChange={(e) => onChange({ writing_model_path: e.target.value })}
                  >
                    <option value="">未設定（モデルバーで都度選択）</option>
                    {models.map((m) => (
                      <option key={m.path} value={m.path}>
                        {m.id}（{(m.size_bytes / 1024 ** 3).toFixed(1)} GB）
                      </option>
                    ))}
                  </select>
                </section>
                <section>
                  <h3>コンテキスト長</h3>
                  <p className="settings-desc">
                    LLM が一度に扱えるトークン数（llama-server の -c）。大きいほど長文を
                    扱えますが VRAM を多く消費します。変更は次回のモデル起動時から反映。
                  </p>
                  <div className="settings-slider">
                    <input
                      type="range"
                      min={0}
                      max={CONTEXT_LENGTHS.length - 1}
                      step={1}
                      value={Math.max(0, CONTEXT_LENGTHS.indexOf(settings.context_length))}
                      onChange={(e) =>
                        onChange({ context_length: CONTEXT_LENGTHS[Number(e.target.value)] })
                      }
                    />
                    <span className="settings-slider-value">
                      {ctxLabel(settings.context_length)}
                    </span>
                  </div>
                  <div className="settings-slider-ticks">
                    {CONTEXT_LENGTHS.map((n) => (
                      <span key={n}>{ctxLabel(n)}</span>
                    ))}
                  </div>
                </section>
                <section>
                  <h3>埋め込みモデル（RAG 検索）</h3>
                  <p className="settings-desc">
                    資料の意味検索に使う Ruri v3（{embed?.model ?? 'cl-nagoya/ruri-v3-310m'}）。
                    通常はオフラインで動作します。未インストールの場合のみ、ここから
                    HuggingFace より一度だけダウンロードします（約 0.6 GB・要ネット接続）。
                  </p>
                  {embed == null ? (
                    <p className="settings-desc">状態を取得できません（backend 未接続）。</p>
                  ) : embed.installed ? (
                    <p className="settings-embed-status ok">
                      ✓ インストール済み{embed.loaded ? '（ロード済み）' : ''}
                    </p>
                  ) : embed.installing ? (
                    <div className="settings-inline">
                      <button disabled>インストール中…（数分かかります）</button>
                    </div>
                  ) : (
                    <div className="settings-inline">
                      <button onClick={installEmbed}>インストール</button>
                    </div>
                  )}
                  {embed?.error && (
                    <p className="settings-embed-status error">
                      インストールに失敗しました: {embed.error}
                    </p>
                  )}
                </section>
              </>
            )}
            {active === 'prompts' && (
              <section className="settings-prompt-section">
                <h3>校正のシステムプロンプト</h3>
                <p className="settings-desc">
                  「選択範囲を校正」「全体を校正」で LLM に渡す指示。文体や残す/直す方針を
                  変えられます。空にして保存すると既定に戻ります。
                </p>
                <textarea
                  className="settings-prompt-textarea"
                  value={reviewDraft}
                  onChange={(e) => setReviewDraft(e.target.value)}
                  spellCheck={false}
                  placeholder={reviewDefault}
                />
                <div className="settings-inline settings-prompt-actions">
                  <button
                    className="ghost"
                    disabled={reviewDraft.trim() === reviewDefault.trim()}
                    onClick={() => {
                      setReviewDraft(reviewDefault)
                      onChange({ review_system_prompt: '' })
                    }}
                  >
                    既定に戻す
                  </button>
                  <button
                    className="primary"
                    disabled={
                      reviewDraft.trim() ===
                      (settings.review_system_prompt.trim() || reviewDefault.trim())
                    }
                    onClick={() =>
                      onChange({
                        review_system_prompt:
                          reviewDraft.trim() === reviewDefault.trim() ? '' : reviewDraft,
                      })
                    }
                  >
                    保存
                  </button>
                </div>
              </section>
            )}
            {active === 'websearch' && (
              <section>
                <h3>Tavily API キー</h3>
                <p className="settings-desc">
                  未設定の場合は DuckDuckGo（キー不要）で検索します。設定すると
                  Tavily を優先します。
                </p>
                <div className="settings-inline">
                  <input
                    type="password"
                    placeholder="tvly-…"
                    value={tavilyDraft}
                    onChange={(e) => setTavilyDraft(e.target.value)}
                  />
                  <button
                    disabled={tavilyDraft === settings.tavily_api_key}
                    onClick={() => onChange({ tavily_api_key: tavilyDraft })}
                  >
                    保存
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
