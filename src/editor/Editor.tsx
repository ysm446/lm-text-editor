import { useEffect, useRef } from 'react'
import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { api } from '../api/client'

const SAVE_DEBOUNCE_MS = 800

interface EditorProps {
  docId: number
  initialContent: unknown
  onSave: (docId: number, contentJson: unknown, contentMd: string) => void
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

  return <EditorContent editor={editor} className="tiptap-root" />
}
