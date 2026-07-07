import { useEffect, useState, type ReactNode } from 'react'
import { api, type AppSettings, type LocalModel } from '../api/client'
import { BookIcon, PencilIcon, SearchIcon, SunIcon } from '../icons'

type Category = 'appearance' | 'editor' | 'llm' | 'websearch'

const CATEGORIES: { key: Category; label: string; icon: ReactNode }[] = [
  { key: 'appearance', label: '外観', icon: <SunIcon /> },
  { key: 'editor', label: 'エディタ', icon: <PencilIcon size={14} /> },
  { key: 'llm', label: 'LLM', icon: <BookIcon size={14} /> },
  { key: 'websearch', label: 'Web 検索', icon: <SearchIcon /> },
]

// テーマのパターンを増やす場合はここに追加（styles.css の [data-theme='…'] と対応）
const THEMES: { value: string; label: string }[] = [
  { value: 'light', label: 'ライト' },
  { value: 'dark', label: 'ダーク' },
]

const FONT_SIZES = [14, 15, 16, 17, 18, 20]

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

  useEffect(() => {
    void api.listLocalModels().then(setModels).catch(() => setModels([]))
  }, [])

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
                  <h3>文章用 LLM（執筆・校正）</h3>
                  <p className="settings-desc">
                    モデルバーの「起動」で使われる既定モデル。切替は次回起動時から。
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
                  <h3>Web 検索用 LLM（クエリ分解・要約）</h3>
                  <p className="settings-desc">
                    「文章用と同じ」にすると 1 つの LLM で兼用します（VRAM
                    節約。検索用の個別起動が不要になります）。
                  </p>
                  <select
                    value={settings.search_model_path}
                    onChange={(e) => onChange({ search_model_path: e.target.value })}
                  >
                    <option value="">既定（ornith 9B）</option>
                    <option value="same">文章用と同じ（1 つの LLM で兼用）</option>
                    {models.map((m) => (
                      <option key={m.path} value={m.path}>
                        {m.id}（{(m.size_bytes / 1024 ** 3).toFixed(1)} GB）
                      </option>
                    ))}
                  </select>
                </section>
              </>
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
