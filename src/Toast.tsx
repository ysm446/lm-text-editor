import { useEffect, useState } from 'react'

// 画面右下に短時間表示するアクション通知（コピー / 貼り付け / 保存など）

interface ToastItem {
  id: number
  message: string
}

let seq = 0

export function showToast(message: string) {
  window.dispatchEvent(
    new CustomEvent('lm-editor:toast', { detail: { id: ++seq, message } }),
  )
}

const TOAST_MS = 1800

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    const onToast = (e: Event) => {
      const item = (e as CustomEvent<ToastItem>).detail
      setToasts((t) => [...t.slice(-3), item]) // 最大 4 件まで
      window.setTimeout(() => {
        setToasts((t) => t.filter((x) => x.id !== item.id))
      }, TOAST_MS)
    }
    window.addEventListener('lm-editor:toast', onToast)

    // クリップボード操作の通知（Ctrl+C/V/X・右クリックメニューの両方で発火する）
    const onCopy = () => showToast('コピーしました')
    const onCut = () => showToast('切り取りました')
    const onPaste = () => showToast('貼り付けました')
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)

    return () => {
      window.removeEventListener('lm-editor:toast', onToast)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  if (toasts.length === 0) return null
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  )
}
