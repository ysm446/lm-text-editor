import { useEffect, useReducer, useState, type ReactNode } from 'react'
import type { Editor as TipTapEditor } from '@tiptap/react'
import { LinkIcon, TableIcon } from '../../icons'

interface FormatToolbarProps {
  editor: TipTapEditor | null
}

interface ButtonSpec {
  key: string
  label: ReactNode
  title: string
  isActive: (ed: TipTapEditor) => boolean
  run: (ed: TipTapEditor) => void
  className?: string
}

const BUTTONS: (ButtonSpec | 'sep')[] = [
  {
    key: 'bold',
    label: 'B',
    title: '太字（Ctrl+B）',
    className: 'fmt-bold',
    isActive: (ed) => ed.isActive('bold'),
    run: (ed) => ed.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: 'I',
    title: '斜体（Ctrl+I）',
    className: 'fmt-italic',
    isActive: (ed) => ed.isActive('italic'),
    run: (ed) => ed.chain().focus().toggleItalic().run(),
  },
  {
    key: 'underline',
    label: 'U',
    title: '下線（Ctrl+U）',
    className: 'fmt-underline',
    isActive: (ed) => ed.isActive('underline'),
    run: (ed) => ed.chain().focus().toggleUnderline().run(),
  },
  {
    key: 'strike',
    label: 'S',
    title: '打ち消し線（Ctrl+Shift+S）',
    className: 'fmt-strike',
    isActive: (ed) => ed.isActive('strike'),
    run: (ed) => ed.chain().focus().toggleStrike().run(),
  },
  {
    key: 'code',
    label: '<>',
    title: 'インラインコード（Ctrl+E）',
    isActive: (ed) => ed.isActive('code'),
    run: (ed) => ed.chain().focus().toggleCode().run(),
  },
  'sep',
  {
    key: 'h1',
    label: 'H1',
    title: '見出し 1',
    isActive: (ed) => ed.isActive('heading', { level: 1 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'h2',
    label: 'H2',
    title: '見出し 2',
    isActive: (ed) => ed.isActive('heading', { level: 2 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'h3',
    label: 'H3',
    title: '見出し 3',
    isActive: (ed) => ed.isActive('heading', { level: 3 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  'sep',
  {
    key: 'bullet',
    label: '•',
    title: '箇条書き',
    isActive: (ed) => ed.isActive('bulletList'),
    run: (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'ordered',
    label: '1.',
    title: '番号付きリスト',
    isActive: (ed) => ed.isActive('orderedList'),
    run: (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'quote',
    label: '❝',
    title: '引用',
    isActive: (ed) => ed.isActive('blockquote'),
    run: (ed) => ed.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'codeblock',
    label: '{ }',
    title: 'コードブロック',
    isActive: (ed) => ed.isActive('codeBlock'),
    run: (ed) => ed.chain().focus().toggleCodeBlock().run(),
  },
  {
    key: 'hr',
    label: '―',
    title: '水平線',
    isActive: () => false,
    run: (ed) => ed.chain().focus().setHorizontalRule().run(),
  },
  {
    key: 'table',
    label: <TableIcon />,
    title: '表を挿入（3×3・ヘッダ行あり）',
    isActive: (ed) => ed.isActive('table'),
    run: (ed) =>
      ed.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  'sep',
  {
    key: 'undo',
    label: '↩',
    title: '元に戻す（Ctrl+Z）',
    isActive: () => false,
    run: (ed) => ed.chain().focus().undo().run(),
  },
  {
    key: 'redo',
    label: '↪',
    title: 'やり直す（Ctrl+Y）',
    isActive: () => false,
    run: (ed) => ed.chain().focus().redo().run(),
  },
]

// 選択位置・書式の変化に追従してアクティブ状態を再描画する書式ツールバー
export default function FormatToolbar({ editor }: FormatToolbarProps) {
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  useEffect(() => {
    if (!editor) return
    editor.on('transaction', forceUpdate)
    editor.on('selectionUpdate', forceUpdate)
    return () => {
      editor.off('transaction', forceUpdate)
      editor.off('selectionUpdate', forceUpdate)
    }
  }, [editor])

  if (!editor) return null

  const toggleLink = () => {
    if (editor.isActive('link')) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    if (editor.state.selection.empty) return // リンクは選択範囲に付ける
    setLinkUrl('')
    setLinkOpen(true)
  }

  const applyLink = () => {
    const href = linkUrl.trim()
    if (href) {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setLinkOpen(false)
  }

  return (
    <div className="format-toolbar">
      {BUTTONS.map((b, i) =>
        b === 'sep' ? (
          <span key={`sep-${i}`} className="format-sep" />
        ) : (
          <button
            key={b.key}
            className={`format-btn ${b.className ?? ''}${b.isActive(editor) ? ' active' : ''}`}
            title={b.title}
            // フォーカスをエディタから奪わないよう mousedown を抑止
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => b.run(editor)}
          >
            {b.label}
          </button>
        ),
      )}
      <span className="format-sep" />
      <button
        className={`format-btn${editor.isActive('link') ? ' active' : ''}`}
        title={editor.isActive('link') ? 'リンクを解除' : 'リンクを挿入（テキストを選択してから）'}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggleLink}
      >
        <LinkIcon />
      </button>
      {linkOpen && (
        <input
          className="format-link-input"
          autoFocus
          placeholder="https://…（Enter で確定 / Esc で取消）"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyLink()
            if (e.key === 'Escape') setLinkOpen(false)
          }}
          onBlur={() => setLinkOpen(false)}
        />
      )}
    </div>
  )
}
