import { useEffect, useState } from 'react'
import { api, type SystemResources } from './api/client'
import { ChartIcon } from './icons'

const POLL_MS = 1000

function meterColor(percent: number): string {
  if (percent < 50) return '#4a9eff'
  if (percent < 80) return '#e8814a'
  return '#e84a4a'
}

function formatPercent(value: number) {
  return `${Math.min(100, Math.max(0, value)).toFixed(0)}%`
}

function formatGb(used: number, total: number) {
  return `${used.toFixed(1)} / ${total.toFixed(1)} GB`
}

function Meter({ label, percent, value }: { label: string; percent: number; value: string }) {
  const clamped = Math.min(100, Math.max(0, percent))
  return (
    <div className="statusbar-meter" title={`${label} ${value}`}>
      <span className="statusbar-meter-label">{label}</span>
      <div className="statusbar-meter-track">
        <div
          className="statusbar-meter-fill"
          style={{ width: `${clamped}%`, background: meterColor(clamped) }}
        />
      </div>
      <span className="statusbar-meter-value">{value}</span>
    </div>
  )
}

interface StatusBarProps {
  visible: boolean // メーターの表示 / 非表示（バー自体と右端トグルは常時表示）
  onToggle: () => void
}

const STATUS_MS = 2600

// 下部リソースモニター（lm-chat の StatusBar を移植。表示中のみ 1 秒ポーリング）
export default function StatusBar({ visible, onToggle }: StatusBarProps) {
  const [resources, setResources] = useState<SystemResources | null>(null)
  // 左端の内部処理ステータス（コピー/貼り付け・保存・資料/画像追加など）を短時間表示
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let timer: number | undefined
    const show = (message: string) => {
      setStatus(message)
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setStatus(null), STATUS_MS)
    }
    const onStatus = (e: Event) =>
      show((e as CustomEvent<{ message: string }>).detail.message)
    // クリップボード操作（Ctrl+C/V/X・右クリックメニューの両方で発火）
    const onCopy = () => show('コピーしました')
    const onCut = () => show('切り取りました')
    const onPaste = () => show('貼り付けました')
    window.addEventListener('lm-editor:toast', onStatus)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      if (timer) window.clearTimeout(timer)
      window.removeEventListener('lm-editor:toast', onStatus)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    const load = async () => {
      try {
        const next = await api.systemResources()
        if (!cancelled) setResources(next)
      } catch {
        if (!cancelled) setResources(null)
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [visible])

  const gpu = resources?.gpus[0] ?? null

  return (
    <footer className={`statusbar${visible ? '' : ' collapsed'}`}>
      {status && <span className="statusbar-status">{status}</span>}
      {visible && (resources ? (
        <>
          <Meter
            label="CPU"
            percent={resources.cpu_percent}
            value={formatPercent(resources.cpu_percent)}
          />
          <Meter
            label="RAM"
            percent={resources.ram_percent}
            value={formatGb(resources.ram_used_gb, resources.ram_total_gb)}
          />
          {gpu ? (
            <>
              <Meter
                label="GPU"
                percent={gpu.gpu_percent}
                value={formatPercent(gpu.gpu_percent)}
              />
              <Meter
                label="VRAM"
                percent={gpu.vram_percent}
                value={formatGb(gpu.vram_used_gb, gpu.vram_total_gb)}
              />
            </>
          ) : (
            <span className="statusbar-dim">GPU: N/A</span>
          )}
        </>
      ) : (
        <span className="statusbar-dim">リソース情報を取得できません</span>
      ))}
      <button
        className={`statusbar-toggle${visible ? ' active' : ''}`}
        onClick={onToggle}
        title={visible ? 'リソースモニターを隠す' : 'リソースモニターを表示'}
      >
        <ChartIcon />
      </button>
    </footer>
  )
}
