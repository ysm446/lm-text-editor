import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { api, streamText } from '../api/client'
import InlineDiff from '../review/InlineDiff'
import AssistPanel, { type AssistState } from '../panels/AssistPanel'

const SAVE_DEBOUNCE_MS = 800
const REVIEW_CONTEXT_CHARS = 500
const CONTINUE_BEFORE_CHARS = 2000
const CONTINUE_AFTER_CHARS = 500

interface EditorProps {
  docId: number
  initialContent: unknown
  onSave: (docId: number, contentJson: unknown, contentMd: string) => void
}

interface ReviewState {
  status: 'streaming' | 'ready' | 'error'
  original: string
  revised: string
  from: number
  to: number
  error?: string
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    // dataURL の "data:image/png;base64," プレフィックスを剥がす
    reader.onload = () => resolve((reader.result as string).split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function imageFiles(list: FileList | undefined | null): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

// 1 ドキュメント = 1 インスタンス。App 側で key={docId} を付けて切替時に作り直す。
export default function Editor({ docId, initialContent, onSave }: EditorProps) {
  const editorRef = useRef<TipTapEditor | null>(null)
  const saveTimer = useRef<number | null>(null)
  const pending = useRef<{ json: unknown; md: string } | null>(null)
  const [selectionEmpty, setSelectionEmpty] = useState(true)
  const [review, setReview] = useState<ReviewState | null>(null)
  const [assistOpen, setAssistOpen] = useState(false)
  const [assist, setAssist] = useState<AssistState | null>(null)
  const assistInsertPos = useRef<number | null>(null)

  const flush = () => {
    if (pending.current) {
      onSave(docId, pending.current.json, pending.current.md)
      pending.current = null
    }
  }

  const uploadAndInsert = async (file: File) => {
    const asset = await api.uploadAsset({
      document_id: docId,
      filename: file.name || 'image.png',
      data_base64: await fileToBase64(file),
    })
    editorRef.current?.chain().focus().setImage({ src: asset.url }).run()
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
    ],
    content: initialContent ?? undefined,
    autofocus: 'end',
    editorProps: {
      handlePaste(_view, event) {
        const files = imageFiles(event.clipboardData?.files)
        if (files.length === 0) return false
        for (const file of files) void uploadAndInsert(file)
        return true
      },
      handleDrop(_view, event, _slice, moved) {
        if (moved) return false
        const files = imageFiles(event.dataTransfer?.files)
        if (files.length === 0) return false
        event.preventDefault()
        for (const file of files) void uploadAndInsert(file)
        return true
      },
    },
    onUpdate({ editor }) {
      pending.current = {
        json: editor.getJSON(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        md: (editor.storage as any).markdown.getMarkdown() as string,
      }
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(flush, SAVE_DEBOUNCE_MS)
    },
    onSelectionUpdate({ editor }) {
      setSelectionEmpty(editor.state.selection.empty)
    },
  })
  editorRef.current = editor

  // アンマウント（ドキュメント切替）時は保存待ちを即時フラッシュ
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      flush()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startReview = async () => {
    const ed = editorRef.current
    if (!ed) return
    const { from, to } = ed.state.selection
    if (from === to) return
    const doc = ed.state.doc
    const original = doc.textBetween(from, to, '\n')
    const contextBefore = doc.textBetween(
      Math.max(0, from - REVIEW_CONTEXT_CHARS),
      from,
      '\n',
    )
    const contextAfter = doc.textBetween(
      to,
      Math.min(doc.content.size, to + REVIEW_CONTEXT_CHARS),
      '\n',
    )

    setReview({ status: 'streaming', original, revised: '', from, to })
    try {
      let revised = ''
      for await (const chunk of streamText('/review/inline', {
        text: original,
        context_before: contextBefore,
        context_after: contextAfter,
      })) {
        revised += chunk
        setReview((r) => (r ? { ...r, revised } : r))
      }
      setReview((r) =>
        r ? { ...r, status: 'ready', revised: revised.trim() } : r,
      )
    } catch (e) {
      setReview((r) =>
        r ? { ...r, status: 'error', error: String(e instanceof Error ? e.message : e) } : r,
      )
    }
  }

  const runAssist = async (path: string, body: unknown) => {
    const ed = editorRef.current
    if (!ed) return
    assistInsertPos.current = ed.state.selection.head
    setAssist({ status: 'streaming', output: '' })
    try {
      let output = ''
      for await (const chunk of streamText(path, body)) {
        output += chunk
        setAssist((a) => (a ? { ...a, output } : a))
      }
      setAssist((a) => (a ? { ...a, status: 'ready', output: output.trim() } : a))
    } catch (e) {
      setAssist((a) =>
        a
          ? { ...a, status: 'error', error: String(e instanceof Error ? e.message : e) }
          : a,
      )
    }
  }

  const assistContinue = () => {
    const ed = editorRef.current
    if (!ed) return
    const pos = ed.state.selection.head
    const doc = ed.state.doc
    void runAssist('/generate/continue', {
      doc_id: docId,
      before: doc.textBetween(Math.max(0, pos - CONTINUE_BEFORE_CHARS), pos, '\n'),
      after: doc.textBetween(
        pos,
        Math.min(doc.content.size, pos + CONTINUE_AFTER_CHARS),
        '\n',
      ),
    })
  }

  const assistSection = (instruction: string) => {
    const ed = editorRef.current
    if (!ed) return
    void runAssist('/generate/section', {
      doc_id: docId,
      instruction,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      document_md: (ed.storage as any).markdown.getMarkdown() as string,
    })
  }

  const assistInsert = () => {
    if (!assist || assist.status !== 'ready') return
    const pos = assistInsertPos.current ?? editorRef.current?.state.selection.head ?? 0
    // tiptap-markdown により Markdown 文字列はパースされて挿入される
    editorRef.current?.chain().focus().insertContentAt(pos, assist.output).run()
    setAssist(null)
    setAssistOpen(false)
  }

  const acceptReview = () => {
    if (!review || review.status !== 'ready') return
    editorRef.current
      ?.chain()
      .focus()
      .insertContentAt({ from: review.from, to: review.to }, review.revised)
      .run()
    setReview(null)
  }

  return (
    <div className="editor-root">
      <div className="editor-toolbar">
        <button
          disabled={selectionEmpty || review?.status === 'streaming'}
          onClick={() => void startReview()}
          title="選択した範囲を LLM で校正します"
        >
          選択範囲を校正
        </button>
        <button
          onClick={() => {
            setAssistOpen((v) => !v)
            if (assistOpen) setAssist(null)
          }}
          title="続き生成・セクション生成"
        >
          執筆支援
        </button>
      </div>
      {assistOpen && (
        <AssistPanel
          assist={assist}
          onContinue={assistContinue}
          onGenerateSection={assistSection}
          onInsert={assistInsert}
          onClose={() => {
            setAssist(null)
            setAssistOpen(false)
          }}
        />
      )}
      {review && (
        <InlineDiff
          original={review.original}
          revised={review.revised}
          status={review.status}
          error={review.error}
          onAccept={acceptReview}
          onReject={() => setReview(null)}
        />
      )}
      <EditorContent editor={editor} className="tiptap-root" />
    </div>
  )
}
