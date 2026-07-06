import { useMemo } from 'react'
import DiffMatchPatch from 'diff-match-patch'

// 日本語向けに文字単位 diff + semantic cleanup で描画する共通コンポーネント
export default function DiffText({
  original,
  revised,
}: {
  original: string
  revised: string
}) {
  const diffs = useMemo(() => {
    const dmp = new DiffMatchPatch()
    const d = dmp.diff_main(original, revised)
    dmp.diff_cleanupSemantic(d)
    return d
  }, [original, revised])

  return (
    <>
      {diffs.map(([op, text], i) =>
        op === 0 ? (
          <span key={i}>{text}</span>
        ) : op === -1 ? (
          <del key={i}>{text}</del>
        ) : (
          <ins key={i}>{text}</ins>
        ),
      )}
    </>
  )
}
