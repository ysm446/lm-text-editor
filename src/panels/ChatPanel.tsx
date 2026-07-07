import { Fragment, useEffect, useRef, useState } from 'react'
import MarkdownIt from 'markdown-it'
import { BoltIcon, ClockIcon, PromptIcon } from '../icons'

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

export interface ChatState {
  messages: ChatMsg[]
  streaming: boolean
  error?: string | null
}

interface ChatPanelProps {
  chat: ChatState
  onSend: (text: string, useRag: boolean) => void
  onClear: () => void
  onClose: () => void
}

export default function ChatPanel({
  chat,
  onSend,
  onClear,
  onClose,
}: ChatPanelProps) {
  const [input, setInput] = useState('')
  const [useRag, setUseRag] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // 新しいトークン・メッセージが来たら末尾へスクロール
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.messages, chat.streaming])

  const send = () => {
    const text = input.trim()
    if (!text || chat.streaming) return
    onSend(text, useRag)
    setInput('')
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
              {m.role === 'assistant' && m.meta && !streamingThis && (
                <div className="chat-msg-meta">
                  <MetaLine meta={m.meta} />
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
          <label
            className="assist-rag-toggle"
            title="RAG（過去記事・リファレンス・Web 取得資料）を検索して文脈に含めます"
          >
            <input
              type="checkbox"
              checked={useRag}
              onChange={(e) => setUseRag(e.target.checked)}
            />
            RAG
          </label>
          <button className="primary" disabled={chat.streaming || !input.trim()} onClick={send}>
            {chat.streaming ? '応答中…' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}
