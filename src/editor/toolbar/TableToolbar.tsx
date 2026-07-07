import { useEffect, useReducer } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'

interface TableToolbarProps {
  editor: TipTapEditor | null
}

interface TableAction {
  key: string
  label: string
  title: string
  run: (ed: TipTapEditor) => void
  className?: string
}

const ACTIONS: (TableAction | 'sep')[] = [
  {
    key: 'row-before',
    label: '＋行上',
    title: '上に行を追加',
    run: (ed) => ed.chain().focus().addRowBefore().run(),
  },
  {
    key: 'row-after',
    label: '＋行下',
    title: '下に行を追加',
    run: (ed) => ed.chain().focus().addRowAfter().run(),
  },
  {
    key: 'col-before',
    label: '＋列左',
    title: '左に列を追加',
    run: (ed) => ed.chain().focus().addColumnBefore().run(),
  },
  {
    key: 'col-after',
    label: '＋列右',
    title: '右に列を追加',
    run: (ed) => ed.chain().focus().addColumnAfter().run(),
  },
  'sep',
  {
    key: 'row-del',
    label: '行削除',
    title: 'この行を削除',
    run: (ed) => ed.chain().focus().deleteRow().run(),
  },
  {
    key: 'col-del',
    label: '列削除',
    title: 'この列を削除',
    run: (ed) => ed.chain().focus().deleteColumn().run(),
  },
  'sep',
  {
    key: 'merge',
    label: '結合/分割',
    title: '選択セルを結合、または結合セルを分割（GFM 化不可・書き出しで落ちます）',
    run: (ed) => ed.chain().focus().mergeOrSplit().run(),
  },
  {
    key: 'header-row',
    label: 'ヘッダ行',
    title: '先頭行のヘッダを切り替え（GFM ではヘッダ行が必須）',
    run: (ed) => ed.chain().focus().toggleHeaderRow().run(),
  },
  'sep',
  {
    key: 'delete',
    label: '表を削除',
    title: '表全体を削除',
    className: 'table-toolbar-danger',
    run: (ed) => ed.chain().focus().deleteTable().run(),
  },
]

// カーソルが表の中にあるときだけ表示する文脈ツールバー。
// 書式パレット内に FormatToolbar の下段として並ぶ。
export default function TableToolbar({ editor }: TableToolbarProps) {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0)

  useEffect(() => {
    if (!editor) return
    editor.on('transaction', forceUpdate)
    editor.on('selectionUpdate', forceUpdate)
    return () => {
      editor.off('transaction', forceUpdate)
      editor.off('selectionUpdate', forceUpdate)
    }
  }, [editor])

  if (!editor || !editor.isActive('table')) return null

  return (
    <div className="format-toolbar table-toolbar">
      <span className="table-toolbar-label">表</span>
      {ACTIONS.map((a, i) =>
        a === 'sep' ? (
          <span key={`sep-${i}`} className="format-sep" />
        ) : (
          <button
            key={a.key}
            className={`format-btn ${a.className ?? ''}`}
            title={a.title}
            // フォーカスをエディタから奪わないよう mousedown を抑止
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => a.run(editor)}
          >
            {a.label}
          </button>
        ),
      )}
    </div>
  )
}
