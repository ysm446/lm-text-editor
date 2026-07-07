import { useEffect, useState, type ReactNode } from 'react'
import type { AppSettings } from '../api/client'
import { PencilIcon, SearchIcon, SunIcon } from '../icons'

type Category = 'appearance' | 'editor' | 'websearch'

const CATEGORIES: { key: Category; label: string; icon: ReactNode }[] = [
  { key: 'appearance', label: '外観', icon: <SunIcon /> },
  { key: 'editor', label: 'エディタ', icon: <PencilIcon size={14} /> },
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
