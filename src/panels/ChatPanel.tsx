import { Fragment, useEffect, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { BoltIcon, ClockIcon, PromptIcon } from '../icons'
import type { ChatSource } from '../api/client'
import SaveChatNoteModal from './SaveChatNoteModal'

// 返答は Markdown で表示する。html:false で生 HTML はエスケープ（LLM 出力の安全側）。
// リンククリックは Electron 側の will-navigate が外部ブラウザへ流す。
const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

export interface ChatMeta {
  tokens: number | null
  elapsed: number | null // 秒
  tps: number | null // tok/sec
  finish_reason: string | null
}

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
  meta?: ChatMeta | null // assistant 返答の生成統計（完了後に付く）
  sources?: ChatSource[] | null // Web 検索の出典（use_web のとき）
}

function MetaLine({ meta }: { meta: ChatMeta }) {
  const items: React.ReactNode[] = []
  if (meta.tps != null)
    items.push(
      <span key="tps" className="chat-meta-item">
        <BoltIcon size={12} />
        {meta.tps} tok/sec
      </span>,
    )
  if (meta.tokens != null)
    items.push(
      <span key="tok" className="chat-meta-item">
        <PromptIcon size={12} />
        {meta.tokens} tokens
      </span>,
    )
  if (meta.elapsed != null)
    items.push(
      <span key="el" className="chat-meta-item">
        <ClockIcon size={12} />
        {meta.elapsed}s
      </span>,
    )
  if (meta.finish_reason)
    items.push(
      <span key="fr" className="chat-meta-item">
        Finish reason: {meta.finish_reason}
      </span>,
    )
  return (
    <>
      {items.map((it, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="chat-meta-sep">·</span>}
          {it}
        </Fragment>
      ))}
    </>
  )
}

export interface ChatContext {
  used: number // 直近ターンで消費したコンテキストトークン（履歴+文脈+応答）
  limit: number // コンテキスト長（n_ctx）
}

// コンテキスト長に対する使用率の円形ゲージ（送信ボタン横）。
function ContextGauge({ used, limit }: ChatContext) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const pct = Math.round(ratio * 100)
  const size = 20
  const stroke = 2.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // 80% 超は警告色（コンテキスト溢れが近い）
  const color =
    ratio >= 0.9 ? 'var(--danger, #e5484d)' : ratio >= 0.8 ? '#e5a23d' : 'var(--accent)'
  return (
    <span
      className="chat-ctx-gauge"
      title={`コンテキスト使用量: ${used.toLocaleString()} / ${limit.toLocaleString()} トークン（${pct}%）`}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="chat-ctx-pct">{pct}%</span>
    </span>
  )
}

export interface ChatState {
  messages: ChatMsg[]
  streaming: boolean
  error?: string | null
  context?: ChatContext | null // 直近ターンのコンテキスト使用量（送信ボタン横のゲージ用）
}

interface ChatPanelProps {
  chat: ChatState
  workspaceId: number // チャット→資料（ノート）保存に使う
  onSend: (text: string, useDoc: boolean, useRag: boolean, useWeb: boolean) => void
  onClear: () => void
  onClose: () => void
  onRagChanged?: () => void // 資料へ保存した後にサイドバーを更新する
}

// 保存モーダルに渡す内容（返答 + 直前の質問 + 出典）
interface SaveTarget {
  question: string | null
  answer: string
  sources?: ChatSource[] | null
}

export default function ChatPanel({
  chat,
  workspaceId,
  onSend,
  onClear,
  onClose,
  onRagChanged,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [useDoc, setUseDoc] = useState(true) // 既定 ON（編集中の文章を文脈に含める）
  const [useRag, setUseRag] = useState(true) // 既定 ON（過去記事・資料を文脈に含める）
  const [useWeb, setUseWeb] = useState(false) // 既定 OFF（明示的に ON にしたときだけ検索）
  const [saveTarget, setSaveTarget] = useState<SaveTarget | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 新しいトークン・メッセージが来たら末尾へスクロール
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages, chat.streaming])

  const send = () => {
    const text = input.trim()
    if (!text || chat.streaming) return
    onSend(text, useDoc, useRag, useWeb)
    setInput('')
  }

  // 返答の直前のユーザー発話（保存時のタイトル候補に使う）
  const questionBefore = (index: number): string | null => {
    for (let i = index - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') return chat.messages[i].content
    }
    return null
  }

  return (
    <div className="chat-panel">
      <div className="chat-panel-header">
        <span>チャット</span>
        <div className="chat-panel-header-actions">
          {chat.messages.length > 0 && (
            <button onClick={onClear} title="会話をリセット">
              クリア
            </button>
          )}
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>

      <div className="chat-panel-messages" ref={scrollRef}>
        {chat.messages.length === 0 && (
          <div className="chat-empty">
            編集中の記事を文脈に相談できます。
            <br />
            「この段落をレビューして」「導入をもっと簡潔に」など。
          </div>
        )}
        {chat.messages.map((m, i) => {
          const isLast = i === chat.messages.length - 1
          const streamingThis = chat.streaming && isLast && m.role === 'assistant'
          return (
            <div key={i} className={`chat-msg chat-msg-${m.role}`}>
              {m.role === 'assistant' ? (
                <div className="chat-msg-body chat-md">
                  <div dangerouslySetInnerHTML={{ __html: md.render(m.content) }} />
                  {streamingThis && <span className="diff-caret">▌</span>}
                </div>
              ) : (
                <div className="chat-msg-body">{m.content}</div>
              )}
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <div className="chat-msg-sources">
                  <span className="chat-sources-label">出典:</span>
                  {m.sources.map((s, j) => (
                    <a
                      key={j}
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      title={s.url}
                    >
                      [{j + 1}] {s.title || s.url}
                    </a>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && !streamingThis && m.content && (
                <div className="chat-msg-meta">
                  {m.meta && <MetaLine meta={m.meta} />}
                  <button
                    className="chat-save-btn"
                    title="この返答を資料（RAG）へ保存します（新規ノート / 既存ノートへ追記）"
                    onClick={() =>
                      setSaveTarget({
                        question: questionBefore(i),
                        answer: m.content,
                        sources: m.sources,
                      })
                    }
                  >
                    資料へ保存
                  </button>
                </div>
              )}
            </div>
          )
        })}
        {chat.error && <div className="diff-error">{chat.error}</div>}
      </div>

      <div className="chat-panel-input">
        <textarea
          placeholder="メッセージを入力（Enter で送信 / Shift+Enter で改行）"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="chat-panel-input-row">
          <button
            type="button"
            className={`rag-toggle-btn${useDoc ? ' active' : ''}`}
            aria-pressed={useDoc}
            title="編集中の文章（全文 + 選択範囲）を文脈に含めます。OFF にすると本文と無関係な調べものができます"
            onClick={() => setUseDoc((v) => !v)}
          >
            本文
          </button>
          <button
            type="button"
            className={`rag-toggle-btn${useRag ? ' active' : ''}`}
            aria-pressed={useRag}
            title="RAG（過去記事・リファレンス・Web 取得資料）を検索して文脈に含めます"
            onClick={() => setUseRag((v) => !v)}
          >
            RAG
          </button>
          <button
            type="button"
            className={`rag-toggle-btn${useWeb ? ' active' : ''}`}
            aria-pressed={useWeb}
            title="Web 検索（DuckDuckGo）して結果のスニペットを文脈に含めます"
            onClick={() => setUseWeb((v) => !v)}
          >
            Web
          </button>
          {chat.context && (
            <ContextGauge used={chat.context.used} limit={chat.context.limit} />
          )}
          <button className="primary" disabled={chat.streaming || !input.trim()} onClick={send}>
            {chat.streaming ? '応答中…' : '送信'}
          </button>
        </div>
      </div>

      {saveTarget && (
        <SaveChatNoteModal
          workspaceId={workspaceId}
          question={saveTarget.question}
          answer={saveTarget.answer}
          sources={saveTarget.sources}
          onSaved={() => onRagChanged?.()}
          onClose={() => setSaveTarget(null)}
        />
      )}
    </div>
  )
}
