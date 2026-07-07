import { useEffect, useRef, useState, type ReactNode } from 'react'

const POS_KEY = 'lm-tool-palette-pos'
const DEFAULT_WIDTH = 560 // 初期センタリング用のバー幅の目安

interface Pos {
  x: number
  y: number
}

/**
 * ドラッグで移動できるフローティングバー。
 * ビューポートではなく本文ステージ（.doc-stage）に付随する:
 * sticky なアンカー（高さ 0）を基準に絶対配置するため、ペインの開閉で
 * ステージが動けばバーも一緒に動き、スクロールしても画面内に留まる。
 * 位置はステージ相対座標で localStorage に記憶する。
 */
export default function ToolPalette({ title, children }: { title: string; children: ReactNode }) {
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const paletteRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<Pos | null>(() => {
    try {
      const raw = localStorage.getItem(POS_KEY)
      if (raw) return JSON.parse(raw) as Pos
    } catch {
      /* 壊れた保存値は無視して既定位置に戻す */
    }
    return null // アンカー幅が分かってから既定位置を決める
  })
  const dragOffset = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const clampToStage = (p: Pos): Pos => {
    const anchor = anchorRef.current
    const w = anchor?.clientWidth ?? window.innerWidth
    const stage = anchor?.closest('.doc-stage')
    const h = stage instanceof HTMLElement ? stage.clientHeight : window.innerHeight
    // パレットの実寸で右端・下端が収まるようにクランプ（幅が足りなければ x=0 のまま右へはみ出す＝許容）
    const palette = paletteRef.current
    const pw = palette?.offsetWidth ?? DEFAULT_WIDTH
    const ph = palette?.offsetHeight ?? 48
    return {
      x: Math.min(Math.max(0, p.x), Math.max(0, w - pw)),
      y: Math.min(Math.max(4, p.y), Math.max(4, h - ph - 4)),
    }
  }

  // 初期位置（保存値なし）はステージ上部の中央。以降はステージのリサイズごとにはみ出しを防ぐ
  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    setPos((p) =>
      p !== null
        ? clampToStage(p)
        : clampToStage({ x: Math.round((anchor.clientWidth - DEFAULT_WIDTH) / 2), y: 56 }),
    )
    const reclamp = () => setPos((p) => (p !== null ? clampToStage(p) : p))
    // ウィンドウ高さのみの変更は ResizeObserver が拾わないので resize も監視する
    window.addEventListener('resize', reclamp)
    let ro: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      // アンカー幅（ペイン開閉・横幅）とパレット自身のサイズ変化の両方で収め直す
      ro = new ResizeObserver(reclamp)
      ro.observe(anchor)
      if (paletteRef.current) ro.observe(paletteRef.current)
    }
    return () => {
      window.removeEventListener('resize', reclamp)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!rect || !pos) return
    dragOffset.current = { dx: e.clientX - rect.left - pos.x, dy: e.clientY - rect.top - pos.y }
    setDragging(true)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const off = dragOffset.current
    const rect = anchorRef.current?.getBoundingClientRect()
    if (!off || !rect) return
    setPos(clampToStage({ x: e.clientX - rect.left - off.dx, y: e.clientY - rect.top - off.dy }))
  }

  const onPointerUp = () => {
    if (!dragOffset.current) return
    dragOffset.current = null
    setDragging(false)
    setPos((p) => {
      if (p) localStorage.setItem(POS_KEY, JSON.stringify(p))
      return p
    })
  }

  return (
    <div className="tool-palette-anchor" ref={anchorRef}>
      <div
        className="tool-palette"
        ref={paletteRef}
        style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      >
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
    </div>
  )
}
