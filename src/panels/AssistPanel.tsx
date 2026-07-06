import { useState } from 'react'

export interface AssistState {
  status: 'streaming' | 'ready' | 'error'
  output: string
  error?: string
}

interface AssistPanelProps {
  assist: AssistState | null // null = 生成前（入力待ち）
  onContinue: () => void
  onGenerateSection: (instruction: string) => void
  onInsert: () => void
  onClose: () => void
}

export default function AssistPanel({
  assist,
  onContinue,
  onGenerateSection,
  onInsert,
  onClose,
}: AssistPanelProps) {
  const [instruction, setInstruction] = useState('')
  const streaming = assist?.status === 'streaming'

  return (
    <div className="assist-panel">
      <div className="assist-panel-header">
        <span>執筆支援</span>
        <div className="assist-panel-actions">
          {assist?.status === 'ready' && (
            <button className="primary" onClick={onInsert}>
              カーソル位置に挿入
            </button>
          )}
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
      <div className="assist-panel-controls">
        <button disabled={streaming} onClick={onContinue}>
          続きを生成
        </button>
        <input
          placeholder="セクションの指示（例: sqlite-vec の導入手順を書いて）"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && instruction.trim() && !streaming) {
              onGenerateSection(instruction.trim())
            }
          }}
          disabled={streaming}
        />
        <button
          disabled={streaming || !instruction.trim()}
          onClick={() => onGenerateSection(instruction.trim())}
        >
          指示から生成
        </button>
      </div>
      {assist && (
        <div className="assist-panel-output">
          {assist.status === 'error' ? (
            <span className="diff-error">{assist.error}</span>
          ) : (
            <>
              {assist.output}
              {streaming && <span className="diff-caret">▌</span>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
