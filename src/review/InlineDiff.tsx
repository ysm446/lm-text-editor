import { useMemo } from 'react'
import DiffMatchPatch from 'diff-match-patch'

interface InlineDiffProps {
  original: string
  revised: string
  status: 'streaming' | 'ready' | 'error'
  error?: string
  onAccept: () => void
  onReject: () => void
}

export default function InlineDiff({
  original,
  revised,
  status,
  error,
  onAccept,
  onReject,
}: InlineDiffProps) {
  // 日本語は単語区切りがないため文字単位 diff + semantic cleanup を使う
  const diffs = useMemo(() => {
    if (status !== 'ready') return null
    const dmp = new DiffMatchPatch()
    const d = dmp.diff_main(original, revised)
    dmp.diff_cleanupSemantic(d)
    return d
  }, [original, revised, status])

  return (
    <div className="inline-diff">
      <div className="inline-diff-header">
        <span>
          {status === 'streaming' && '校正中…'}
          {status === 'ready' && '校正案（赤: 削除 / 緑: 追加）'}
          {status === 'error' && '校正に失敗しました'}
        </span>
        <div className="inline-diff-actions">
          {status === 'ready' && <button onClick={onAccept}>採用</button>}
          <button onClick={onReject}>{status === 'ready' ? '破棄' : '閉じる'}</button>
        </div>
      </div>
      <div className="inline-diff-body">
        {status === 'error' && <span className="diff-error">{error}</span>}
        {status === 'streaming' && (
          <>
            {revised}
            <span className="diff-caret">▌</span>
          </>
        )}
        {status === 'ready' &&
          diffs?.map(([op, text], i) =>
            op === 0 ? (
              <span key={i}>{text}</span>
            ) : op === -1 ? (
              <del key={i}>{text}</del>
            ) : (
              <ins key={i}>{text}</ins>
            ),
          )}
      </div>
    </div>
  )
}
