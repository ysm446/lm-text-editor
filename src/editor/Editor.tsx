import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

export default function Editor() {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({
        html: false,
        transformPastedText: true,
      }),
    ],
    content: '<h1>無題</h1><p></p>',
    autofocus: 'end',
  })

  return <EditorContent editor={editor} className="tiptap-root" />
}
