import { useRef, useState, type ReactNode } from 'react'

const POS_KEY = 'lm-tool-palette-pos'

function clamp(p: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.min(Math.max(8, p.x), window.innerWidth - 80),
    y: Math.min(Math.max(40, p.y), window.innerHeight - 80),
  }
}

function initialPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (raw) return clamp(JSON.parse(raw) as { x: number; y: number })
  } catch {
    /* 壊れた保存値は無視して既定位置に戻す */
  }
  return { x: window.innerWidth - 220, y: 108 }
}

/** ドラッグで移動できるフローティングパレット。位置は localStorage に記憶する */
export default function ToolPalette({ title, children }: { title: string; children: ReactNode }) {
  const [pos, setPos] = useState(initialPos)
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const off = dragOffset.current
    if (!off) return
    setPos(clamp({ x: e.clientX - off.dx, y: e.clientY - off.dy }))
  }

  const onPointerUp = () => {
    if (!dragOffset.current) return
    dragOffset.current = null
    setDragging(false)
    setPos((p) => {
      localStorage.setItem(POS_KEY, JSON.stringify(p))
      return p
    })
  }

  return (
    <div className="tool-palette" style={{ left: pos.x, top: pos.y }}>
      <div
        className={`tool-palette-grip${dragging ? ' dragging' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        title="ドラッグで移動"
      >
        <span className="tool-palette-grip-dots">⠿</span>
        {title}
      </div>
      <div className="tool-palette-body">{children}</div>
    </div>
  )
}
