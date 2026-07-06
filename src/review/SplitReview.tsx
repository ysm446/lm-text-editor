import DiffText from './DiffText'

export interface SplitRow {
  pos: number // エディタ内のブロック開始位置（採用時に更新される）
  original: string
  revised: string | null // null = 校正待ち
  decided: 'pending' | 'accepted' | 'rejected'
}

export interface SplitReviewState {
  status: 'streaming' | 'ready' | 'error'
  rows: SplitRow[]
  error?: string
}

interface SplitReviewProps {
  state: SplitReviewState
  onAccept: (rowIndex: number) => void
  onReject: (rowIndex: number) => void
  onAcceptAll: () => void
  onClose: () => void
}

export default function SplitReview({
  state,
  onAccept,
  onReject,
  onAcceptAll,
  onClose,
}: SplitReviewProps) {
  const { status, rows } = state
  const doneCount = rows.filter((r) => r.revised != null).length
  const hasPending = rows.some(
    (r) => r.decided === 'pending' && r.revised != null && r.revised !== r.original,
  )

  return (
    <div className="split-review-overlay">
      <div className="split-review">
        <div className="split-review-header">
          <span>
            分割ビュー校正
            {status === 'streaming' && ` — 校正中… (${doneCount}/${rows.length})`}
            {status === 'ready' && ` — 完了 (${rows.length} 段落)`}
            {status === 'error' && ' — エラー'}
          </span>
          <div className="split-review-actions">
            <button
              className="primary"
              disabled={status !== 'ready' || !hasPending}
              onClick={onAcceptAll}
            >
              残りをすべて採用
            </button>
            <button onClick={onClose}>閉じる</button>
          </div>
        </div>
        {status === 'error' && (
          <div className="split-review-error">{state.error}</div>
        )}
        <div className="split-review-columns-label">
          <span>現行</span>
          <span>改稿案</span>
        </div>
        <div className="split-review-rows">
          {rows.map((row, i) => {
            const unchanged = row.revised != null && row.revised === row.original
            return (
              <div key={i} className={`split-row ${row.decided}`}>
                <div className="split-cell">{row.original}</div>
                <div className="split-cell revised">
                  {row.revised == null ? (
                    <span className="split-waiting">校正待ち…</span>
                  ) : unchanged ? (
                    <span className="split-unchanged">変更なし</span>
                  ) : (
                    <DiffText original={row.original} revised={row.revised} />
                  )}
                </div>
                <div className="split-row-actions">
                  {row.decided === 'accepted' && <span className="split-badge">採用済み</span>}
                  {row.decided === 'rejected' && <span className="split-badge">スキップ</span>}
                  {row.decided === 'pending' && row.revised != null && !unchanged && (
                    <>
                      <button className="primary" onClick={() => onAccept(i)}>
                        採用
                      </button>
                      <button onClick={() => onReject(i)}>スキップ</button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
