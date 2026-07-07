import { useEffect, useRef, useState } from 'react'
import { api, type LibraryState } from './api/client'
import { BookIcon, ChevronDownIcon } from './icons'

interface LibrarySwitcherProps {
  onSwitched: () => void // 切替後に App 側で全状態をリロードする
}

// ライブラリ（データルートフォルダ）の表示・切替・新規作成（lm-chat 参考）
export default function LibrarySwitcher({ onSwitched }: LibrarySwitcherProps) {
  const [state, setState] = useState<LibraryState | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.libraryState().then(setState).catch(() => setState(null))
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const active = state?.libraries.find((l) => l.active)

  const apply = async (next: LibraryState) => {
    setState(next)
    onSwitched()
  }

  const handleSwitch = async (path: string) => {
    setMenuOpen(false)
    setBusy(true)
    setError(null)
    try {
      await apply(await api.librarySwitch(path))
    } catch (e) {
      setError(e instanceof Error ? e.message : '切り替えに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  const pickFolder = async (mode: 'open' | 'create') => {
    setMenuOpen(false)
    if (!window.lmEditor?.chooseLibraryFolder) {
      setError('フォルダ選択はデスクトップアプリでのみ利用できます')
      return null
    }
    return window.lmEditor.chooseLibraryFolder(mode)
  }

  const handleOpen = async () => {
    const path = await pickFolder('open')
    if (path) await handleSwitch(path)
  }

  const handleCreate = async () => {
    const path = await pickFolder('create')
    if (!path) return
    setBusy(true)
    setError(null)
    try {
      await apply(await api.libraryCreate(path))
    } catch (e) {
      setError(e instanceof Error ? e.message : '作成に失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="library-switcher" ref={rootRef}>
      <button
        className="library-switcher-btn"
        onClick={() => setMenuOpen((v) => !v)}
        disabled={busy}
        title={active?.path ?? 'ライブラリ'}
      >
        <BookIcon /> {busy ? '切り替え中…' : (active?.name ?? 'ライブラリ')}{' '}
        <ChevronDownIcon />
      </button>
      {error && <span className="library-switcher-error">{error}</span>}
      {menuOpen && (
        <div className="library-menu">
          <div className="library-menu-label">ライブラリ</div>
          {state?.libraries.map((lib) => (
            <button
              key={lib.path}
              className={`library-menu-item${lib.active ? ' active' : ''}`}
              onClick={() => !lib.active && lib.exists && void handleSwitch(lib.path)}
              disabled={!lib.exists && !lib.active}
              title={lib.path}
            >
              {lib.active ? '● ' : ''}
              {lib.name}
              {!lib.exists && '（見つかりません）'}
            </button>
          ))}
          <div className="library-menu-sep" />
          <button className="library-menu-item" onClick={() => void handleOpen()}>
            フォルダを開く…
          </button>
          <button className="library-menu-item" onClick={() => void handleCreate()}>
            新規作成…
          </button>
        </div>
      )}
    </div>
  )
}
