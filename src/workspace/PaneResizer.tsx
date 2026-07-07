import { useRef, useState } from 'react'

interface PaneResizerProps {
  /** どちらのペインの幅を変えるか。left=右へドラッグで拡大、right=左へドラッグで拡大 */
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  onChange: (w: number) => void
  onCommit: (w: number) => void
}

/** ペインと本文の境界に置く縦の仕切り。ドラッグで隣接ペインの幅を変える */
export default function PaneResizer({ side, width, min, max, onChange, onCommit }: PaneResizerProps) {
  const drag = useRef<{ startX: number; startWidth: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: e.clientX, startWidth: width }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    // left ペインは右方向、right ペインは左方向へのドラッグで拡大する
    const delta = (e.clientX - d.startX) * (side === 'left' ? 1 : -1)
    onChange(Math.min(max, Math.max(min, d.startWidth + delta)))
  }

  const onPointerUp = () => {
    if (!drag.current) return
    drag.current = null
    setDragging(false)
    onCommit(width)
  }

  return (
    <div
      className={`pane-resizer${dragging ? ' dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="ドラッグで幅を変更"
    />
  )
}
