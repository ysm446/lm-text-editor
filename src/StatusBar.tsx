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

// 下部リソースモニター（lm-chat の StatusBar を移植。表示中のみ 1 秒ポーリング）
export default function StatusBar({ visible, onToggle }: StatusBarProps) {
  const [resources, setResources] = useState<SystemResources | null>(null)

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
