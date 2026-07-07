import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent, type Editor as TipTapEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { Markdown } from 'tiptap-markdown'
import type { Node as PMNode } from '@tiptap/pm/model'
import { api, streamText } from '../api/client'
import InlineDiff from '../review/InlineDiff'
import { showToast } from '../Toast'
import SplitReview, {
  type SplitReviewState,
  type SplitRow,
} from '../review/SplitReview'
import RevisionPanel from '../review/RevisionPanel'
import AssistPanel, { type AssistState } from '../panels/AssistPanel'
import FormatToolbar from './toolbar/FormatToolbar'
import TableToolbar from './toolbar/TableToolbar'
import ToolPalette from './ToolPalette'

const DRAFT_DEBOUNCE_MS = 1500
const REVIEW_CONTEXT_CHARS = 500
const CONTINUE_BEFORE_CHARS = 2000
const CONTINUE_AFTER_CHARS = 500

interface EditorProps {
  docId: number
  initialContent: unknown
  draft: unknown | null // 前回の未保存編集（ドラフト退避）
  draftSavedAt: string | null
  onSaved: (docId: number) => void
  onImageUploaded?: () => void // ペースト/ドロップで画像を保存した後の通知
  registerImageInserter?: (fn: (url: string) => void) => void // サイドバーからの挿入用
  assistOpen: boolean // 右ペイン（執筆支援）の開閉は App が管理
  onToggleAssist: () => void
  titleSlot?: ReactNode // タイトル入力（App が管理）。ツールバーと本文の間に表示する
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

// 分割ビューに切り替えるしきい値（N 段落以上）。設定 UI はフェーズ 5 で追加予定
function splitThreshold(): number {
  const raw = window.localStorage.getItem('lm-editor.splitThreshold')
  const n = raw ? Number.parseInt(raw, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 2
}

// トップレベルのテキストブロックを収集（コードブロックと画像は校正対象外）
function collectBlocks(
  doc: PMNode,
  range?: { from: number; to: number },
): { pos: number; text: string }[] {
  const blocks: { pos: number; text: string }[] = []
  doc.forEach((node, offset) => {
    if (!node.isTextblock || node.type.name === 'codeBlock') return
    if (range && (offset + node.nodeSize <= range.from || offset >= range.to)) return
    if (!node.textContent.trim()) return
    blocks.push({ pos: offset, text: node.textContent })
  })
  return blocks
}

function buildOutline(doc: PMNode): string {
  const lines: string[] = []
  doc.forEach((node) => {
    if (node.type.name === 'heading') {
      lines.push(`${'#'.repeat(node.attrs.level as number)} ${node.textContent}`)
    }
  })
  return lines.join('\n')
}

// 1 ドキュメント = 1 インスタンス。App 側で key={docId} を付けて切替時に作り直す。
export default function Editor({
  docId,
  initialContent,
  draft,
  draftSavedAt,
  onSaved,
  onImageUploaded,
  registerImageInserter,
  assistOpen,
  onToggleAssist,
  titleSlot,
}: EditorProps) {
  const editorRef = useRef<TipTapEditor | null>(null)
  const draftTimer = useRef<number | null>(null)
  const pendingDraft = useRef<unknown | null>(null)
  const savedContent = useRef<string>('') // 最後に保存した内容（正規化 JSON 文字列）
  const wasDirty = useRef(false)
  const [selectionEmpty, setSelectionEmpty] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [draftBanner, setDraftBanner] = useState(draft != null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyMd, setHistoryMd] = useState('')
  const [review, setReview] = useState<ReviewState | null>(null)
  const [assist, setAssist] = useState<AssistState | null>(null)
  const assistInsertPos = useRef<number | null>(null)
  // 右ペイン（App 側の DOM）へ portal で描画する
  const [assistPaneEl, setAssistPaneEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setAssistPaneEl(document.getElementById('assist-pane-root'))
  }, [])
  // ペインが閉じられたら生成状態もリセット
  useEffect(() => {
    if (!assistOpen) setAssist(null)
  }, [assistOpen])
  const [splitReview, setSplitReview] = useState<SplitReviewState | null>(null)

  const getMarkdown = () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((editorRef.current?.storage as any)?.markdown.getMarkdown() as string) ?? ''

  const flushDraft = () => {
    if (pendingDraft.current != null) {
      void api.saveDraft(docId, pendingDraft.current).catch(() => undefined)
      pendingDraft.current = null
    }
  }

  // 保存時点との実差分で未保存判定する（編集して元に戻したらマークは消える）
  const updateDirty = (ed: TipTapEditor): boolean => {
    const isDirty = JSON.stringify(ed.getJSON()) !== savedContent.current
    setDirty(isDirty)
    if (!isDirty && wasDirty.current) {
      // 元に戻った: ドラフト退避も取り消す
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      pendingDraft.current = null
      void api.clearDraft(docId).catch(() => undefined)
    }
    wasDirty.current = isDirty
    return isDirty
  }

  // 明示保存: 本文更新 + リビジョン追加 + ドラフトクリア
  const save = async () => {
    const ed = editorRef.current
    if (!ed || saving || !dirty) return
    setSaving(true)
    setSaveError(null)
    try {
      const contentJson = ed.getJSON()
      await api.saveDoc(docId, {
        content_json: contentJson,
        content_md: getMarkdown(),
      })
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      pendingDraft.current = null
      savedContent.current = JSON.stringify(contentJson)
      wasDirty.current = false
      setDirty(false)
      setDraftBanner(false)
      showToast('保存しました')
      onSaved(docId)
    } catch (e) {
      setSaveError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const restoreDraft = () => {
    const ed = editorRef.current
    if (draft != null && ed) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ed.commands.setContent(draft as any)
      updateDirty(ed)
    }
    setDraftBanner(false)
  }

  const discardDraft = () => {
    void api.clearDraft(docId).catch(() => undefined)
    setDraftBanner(false)
  }

  const uploadAndInsert = async (file: File) => {
    const asset = await api.uploadAsset({
      document_id: docId,
      filename: file.name || 'image.png',
      data_base64: await fileToBase64(file),
    })
    editorRef.current?.chain().focus().setImage({ src: asset.url }).run()
    onImageUploaded?.()
  }

  // サイドバーの画像クリックでカーソル位置に挿入できるよう登録する
  useEffect(() => {
    registerImageInserter?.((url) => {
      editorRef.current?.chain().focus().setImage({ src: url }).run()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      // GFM テーブル: tiptap-markdown が simple table（ヘッダ行あり・1セル1段落・結合なし）を
      // `| ... |` に往復変換する。結合・複数段落セルは Markdown 化できず HTML 化 → html:false のため書き出しで落ちる。
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
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
    onCreate({ editor }) {
      // DB の JSON とエディタの正規化後 JSON の差異で誤検知しないよう、
      // ロード直後のエディタ状態を「保存済み」の基準にする
      savedContent.current = JSON.stringify(editor.getJSON())
    },
    onUpdate({ editor }) {
      if (!updateDirty(editor)) return
      // ドラフト退避（クラッシュ対策）。正式な保存は保存ボタン / Ctrl+S のみ
      pendingDraft.current = editor.getJSON()
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      draftTimer.current = window.setTimeout(() => {
        flushDraft()
      }, DRAFT_DEBOUNCE_MS)
    },
    onSelectionUpdate({ editor }) {
      setSelectionEmpty(editor.state.selection.empty)
    },
  })
  editorRef.current = editor

  // アンマウント（ドキュメント切替）時はドラフト退避を即時フラッシュ
  useEffect(() => {
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current)
      flushDraft()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startSplitReview = async (blocks: { pos: number; text: string }[]) => {
    const ed = editorRef.current
    if (!ed || blocks.length === 0) return
    const rows: SplitRow[] = blocks.map((b) => ({
      pos: b.pos,
      original: b.text,
      revised: null,
      decided: 'pending',
    }))
    setSplitReview({ status: 'streaming', rows })
    try {
      let buffer = ''
      for await (const chunk of streamText('/review/split', {
        blocks: rows.map((r) => r.original),
        outline: buildOutline(ed.state.doc),
      })) {
        buffer += chunk
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl)
          buffer = buffer.slice(nl + 1)
          if (!line.trim()) continue
          const { index, revised } = JSON.parse(line) as {
            index: number
            revised: string
          }
          setSplitReview((prev) =>
            prev
              ? {
                  ...prev,
                  rows: prev.rows.map((r, j) => (j === index ? { ...r, revised } : r)),
                }
              : prev,
          )
        }
      }
      setSplitReview((prev) => (prev ? { ...prev, status: 'ready' } : prev))
    } catch (e) {
      setSplitReview((prev) =>
        prev
          ? { ...prev, status: 'error', error: String(e instanceof Error ? e.message : e) }
          : prev,
      )
    }
  }

  // 指定ブロックの本文を revised に置き換え、後続ブロックの位置を補正する
  const applyRowToEditor = (row: SplitRow): number | null => {
    const ed = editorRef.current
    if (!ed || row.revised == null) return null
    const node = ed.state.doc.nodeAt(row.pos)
    if (!node) return null
    const sizeBefore = ed.state.doc.content.size
    ed.chain()
      .insertContentAt({ from: row.pos + 1, to: row.pos + 1 + node.content.size }, row.revised)
      .run()
    return ed.state.doc.content.size - sizeBefore
  }

  const acceptSplitRow = (rowIndex: number) => {
    if (!splitReview) return
    const row = splitReview.rows[rowIndex]
    if (row.decided !== 'pending' || row.revised == null) return
    const delta = applyRowToEditor(row)
    if (delta == null) return
    setSplitReview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r, j) =>
              j === rowIndex
                ? { ...r, decided: 'accepted' }
                : r.pos > row.pos
                  ? { ...r, pos: r.pos + delta }
                  : r,
            ),
          }
        : prev,
    )
  }

  const rejectSplitRow = (rowIndex: number) => {
    setSplitReview((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r, j) =>
              j === rowIndex ? { ...r, decided: 'rejected' } : r,
            ),
          }
        : prev,
    )
  }

  const acceptAllSplit = () => {
    if (!splitReview) return
    const pending = splitReview.rows.filter(
      (r) => r.decided === 'pending' && r.revised != null && r.revised !== r.original,
    )
    // 位置ずれを避けるため文書の後ろから適用する
    for (const row of [...pending].sort((a, b) => b.pos - a.pos)) {
      applyRowToEditor(row)
    }
    setSplitReview(null)
  }

  const startReview = async () => {
    const ed = editorRef.current
    if (!ed) return
    const { from, to } = ed.state.selection
    if (from === to) return
    const doc = ed.state.doc

    // 選択範囲がしきい値以上の段落数なら分割ビュー校正へ（spec §6.2）
    const selectedBlocks = collectBlocks(doc, { from, to })
    if (selectedBlocks.length >= splitThreshold()) {
      void startSplitReview(selectedBlocks)
      return
    }

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

  const assistSection = (instruction: string, useRag: boolean) => {
    const ed = editorRef.current
    if (!ed) return
    void runAssist('/generate/section', {
      doc_id: docId,
      instruction,
      use_rag: useRag,
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
    onToggleAssist() // 挿入後はペインを閉じる
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
      {/* 書式ツール（太字・見出し・リスト等）は本文に付随する浮いたバー（ドラッグで移動可・位置は記憶） */}
      <ToolPalette title="書式">
        <FormatToolbar editor={editor} />
        <TableToolbar editor={editor} />
      </ToolPalette>
      {/* スクロールしても操作ツールバーは上部に固定表示する */}
      <div className="editor-toolbars">
      <div className="toolbar-row">
      <div className="editor-toolbar">
        <button
          disabled={selectionEmpty || review?.status === 'streaming'}
          onClick={() => void startReview()}
          title="選択した範囲を LLM で校正します"
        >
          選択範囲を校正
        </button>
        <button
          disabled={splitReview?.status === 'streaming'}
          onClick={() => {
            const ed = editorRef.current
            if (ed) void startSplitReview(collectBlocks(ed.state.doc))
          }}
          title="文書全体を左右分割ビューで校正します"
        >
          全体を校正
        </button>
        <button
          className={assistOpen ? 'active-toggle' : ''}
          onClick={onToggleAssist}
          title="続き生成・セクション生成（右ペインに表示）"
        >
          執筆支援
        </button>
        <button
          onClick={() => {
            if (!historyOpen) setHistoryMd(getMarkdown())
            setHistoryOpen((v) => !v)
          }}
          title="保存履歴の一覧・差分・読み込み"
        >
          履歴
        </button>
        {saveError && <span className="save-error">{saveError}</span>}
        {dirty && !saving && (
          <span className="dirty-indicator" title="未保存の変更があります">
            ● 未保存
          </span>
        )}
        <button
          className="save-btn"
          disabled={!dirty || saving}
          onClick={() => void save()}
          title="保存（Ctrl+S）。保存のたびに履歴が残ります"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
      </div>
      {/* 校正結果は sticky ラッパー内に置き、スクロール位置に関係なくツールバー直下に見せる */}
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
      </div>
      {/* 並び: ツールバー → タイトル → 本文 */}
      {titleSlot}
      {draftBanner && (
        <div className="draft-banner">
          <span>
            未保存の下書きがあります
            {draftSavedAt ? `（${new Date(draftSavedAt).toLocaleString('ja-JP')}）` : ''}
            。復元しますか？
          </span>
          <div className="draft-banner-actions">
            <button className="primary" onClick={restoreDraft}>
              復元
            </button>
            <button onClick={discardDraft}>破棄</button>
          </div>
        </div>
      )}
      {historyOpen && (
        <RevisionPanel
          docId={docId}
          currentMd={historyMd}
          onLoadRevision={(json) => {
            const ed = editorRef.current
            if (!ed) return
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ed.commands.setContent(json as any)
            updateDirty(ed)
          }}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {splitReview && (
        <SplitReview
          state={splitReview}
          onAccept={acceptSplitRow}
          onReject={rejectSplitRow}
          onAcceptAll={acceptAllSplit}
          onClose={() => setSplitReview(null)}
        />
      )}
      {assistOpen &&
        assistPaneEl &&
        createPortal(
          <AssistPanel
            assist={assist}
            onContinue={assistContinue}
            onGenerateSection={assistSection}
            onInsert={assistInsert}
            onClose={onToggleAssist}
          />,
          assistPaneEl,
        )}
      <EditorContent editor={editor} className="tiptap-root" />
    </div>
  )
}
