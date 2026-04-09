/** NeuroSme 通用 LLM 對話殼（NsChat）；與 AgentChat 分離，供 ChatAgent 等擴充 */
import { useEffect, useRef, useState, type FormEvent, type HTMLAttributes, type ReactNode } from 'react'
import type { ChatMessageAttachmentMeta } from '@/api/chatThreads'
import { ChevronDown, Copy, Loader2, RotateCcw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-[18px] text-gray-900" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold text-gray-900 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-lg font-semibold text-gray-900" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-2 text-base font-semibold text-gray-800" {...props}>
      {children}
    </h3>
  ),
  ul: ({ children, ...props }: HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, className, ...props }: HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes('language-')
    if (isBlock) {
      return (
        <code className="block whitespace-pre overflow-x-auto" {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[16px]" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children, ...props }: HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[16px]" {...props}>
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children, ...props }: HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 text-[16px]" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-100" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-gray-900" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  tbody: ({ children, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props}>{children}</tbody>
  ),
}

function isImageAttachmentMeta(a: ChatMessageAttachmentMeta): boolean {
  const t = (a.content_type || '').toLowerCase()
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') {
    return true
  }
  const n = a.original_filename || ''
  const i = n.lastIndexOf('.')
  const ext = i >= 0 ? n.slice(i).toLowerCase() : ''
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
}

export interface NsChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface NsChatResponseMeta {
  model: string
  /** 上游有時不回 usage；仍顯示 model / finish */
  usage?: NsChatUsage | null
  finish_reason: string | null
}

function formatAssistantMetaLine(meta: NsChatResponseMeta): string | null {
  const parts: string[] = []
  const m = meta.model?.trim()
  if (m) parts.push(`model: ${m}`)
  if (meta.usage) {
    parts.push(
      `prompt: ${meta.usage.prompt_tokens} · completion: ${meta.usage.completion_tokens} · total: ${meta.usage.total_tokens}`
    )
  }
  if (meta.finish_reason != null && meta.finish_reason !== '') {
    parts.push(`finish: ${meta.finish_reason}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

export interface NsChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 後端 chat_messages.id，有則可搭配 onRetryLastAssistant 再試一次 */
  id?: string
  /** 為 true 時為串流進行中，不顯示「再試一次」 */
  streaming?: boolean
  meta?: NsChatResponseMeta
  /** user 訊息之附件 meta（圖片等由 attachmentBlobUrls 對應顯示） */
  attachments?: ChatMessageAttachmentMeta[]
}

export interface NsChatProps {
  messages: NsChatMessage[]
  onSubmit: (text: string) => void
  isLoading: boolean
  headerTitle?: string
  headerActions?: ReactNode
  emptyPlaceholder?: string
  emptyPlaceholderClassName?: string
  /** 輸入框 placeholder，未傳則用 emptyPlaceholder */
  inputPlaceholder?: string
  /** 思考中顯示文字，預設「助理思考中」 */
  loadingLabel?: string
  submitDisabled?: boolean
  submitDisabledTitle?: string
  onCopySuccess?: () => void
  onCopyError?: () => void
  /** 僅在最後一則助理訊息顯示「再試一次」；由父層負責打 API／刪除舊訊息等 */
  onRetryLastAssistant?: () => void
  /** 為 true 時不畫外框（由外層容器套用 rounded-2xl / border / shadow，對齊 AgentBusinessUI 主面板） */
  embedded?: boolean
  /**
   * 為 true 時允許輸入框空白仍送出（例如僅附加檔時由父層填入預設訊息寫入 DB）
   */
  allowSubmitEmptyInput?: boolean
  /** 送出列上方（例如待併入本則訊息的附件列表） */
  composerAboveForm?: ReactNode
  /** 與輸入框同一列、位於輸入框左側（例如附加檔按鈕） */
  composerLeading?: ReactNode
  /** stored_file id → object URL，供 user 圖片附件顯示 */
  attachmentBlobUrls?: Record<string, string>
}

export default function NsChat({
  messages,
  onSubmit,
  isLoading,
  headerTitle = '',
  headerActions,
  emptyPlaceholder = '輸入訊息…',
  emptyPlaceholderClassName,
  inputPlaceholder,
  loadingLabel = '助理思考中',
  submitDisabled = false,
  submitDisabledTitle,
  onCopySuccess,
  onCopyError,
  onRetryLastAssistant,
  embedded = false,
  allowSubmitEmptyInput = false,
  composerAboveForm,
  composerLeading,
  attachmentBlobUrls = {},
}: NsChatProps) {
  const [input, setInput] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isAtBottom) {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

  function handleChatScroll() {
    const el = scrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    setIsAtBottom(atBottom)
  }

  function scrollToBottom() {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const t = input.trim()
    if ((!t && !allowSubmitEmptyInput) || isLoading || submitDisabled) return
    onSubmit(t)
    setInput('')
  }

  const rootClass = embedded
    ? 'flex h-full min-h-0 flex-col bg-white'
    : 'flex h-full min-h-0 flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50'

  return (
    <div className={rootClass}>
      {(headerTitle?.trim() || headerActions != null) && (
        <header className="flex shrink-0 flex-wrap items-center justify-start gap-2 border-b border-gray-200 px-3 py-2">
          {headerTitle?.trim() ? (
            <h2 className="text-lg font-semibold text-gray-800">{headerTitle.trim()}</h2>
          ) : null}
          {headerActions != null ? (
            <div className="flex min-w-0 flex-wrap items-center gap-2">{headerActions}</div>
          ) : null}
        </header>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
        <div className="relative mb-2 flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            onScroll={handleChatScroll}
            className="h-full min-h-0 overflow-y-auto rounded-xl border border-gray-200/80 bg-gray-50/60 p-4 ring-1 ring-gray-200/40"
            role="log"
            aria-live="polite"
          >
            {messages.length === 0 && !isLoading ? (
              <p
                className={`whitespace-pre-line ${emptyPlaceholderClassName ?? 'text-center text-[18px] text-gray-400'}`}
              >
                {emptyPlaceholder}
              </p>
            ) : (
              <ul className="flex flex-col space-y-4">
                {messages.map((m, i) => (
                  <li
                    key={m.id ?? `${i}-${m.role}-${m.content.slice(0, 48)}`}
                    className={`flex flex-col px-4 py-3 shadow-sm ${
                      m.role === 'user'
                        ? 'ml-auto w-fit max-w-[85%] rounded-3xl bg-gray-800 text-white ring-1 ring-gray-700/50'
                        : 'mr-4 rounded-xl border border-gray-100 bg-white text-gray-900 ring-1 ring-gray-200/50 sm:mr-8'
                    }`}
                  >
                    <span className="sr-only">{m.role === 'user' ? '您：' : '助理：'}</span>
                    {m.role === 'user' ? (
                      <div className="space-y-2">
                        <p className="whitespace-pre-wrap text-[18px] leading-relaxed">{m.content}</p>
                        {m.attachments?.filter(isImageAttachmentMeta).map((a) => {
                          const url = attachmentBlobUrls[a.file_id]
                          return (
                            <div key={a.file_id} className="max-w-full">
                              {url ? (
                                <img
                                  src={url}
                                  alt={a.original_filename}
                                  className="max-h-72 max-w-full rounded-lg object-contain ring-1 ring-white/25"
                                />
                              ) : (
                                <p className="text-[15px] text-white/75">圖片載入中…</p>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          components={CHAT_MARKDOWN_COMPONENTS}
                        >
                          {m.content.replace(/\\n/g, '\n')}
                        </ReactMarkdown>
                      </div>
                    )}
                    {(() => {
                      if (m.role !== 'assistant' || m.meta == null) return null
                      const line = formatAssistantMetaLine(m.meta)
                      if (!line) return null
                      return (
                        <div className="mt-2 border-t border-gray-200 pt-2 text-[15px] text-gray-600">{line}</div>
                      )
                    })()}
                    {m.role === 'assistant' && !m.streaming && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content)}
                          className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[16px] text-gray-600 transition-colors hover:bg-gray-200"
                        >
                          <Copy className="h-4 w-4" />
                          複製
                        </button>
                        {onRetryLastAssistant != null &&
                          i === messages.length - 1 &&
                          !isLoading &&
                          m.id != null &&
                          m.id !== '' && (
                            <button
                              type="button"
                              onClick={() => onRetryLastAssistant()}
                              className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[16px] text-gray-600 transition-colors hover:bg-gray-200"
                            >
                              <RotateCcw className="h-4 w-4" />
                              再試一次
                            </button>
                          )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isLoading && (
              <p className="mt-2 flex items-center gap-2 text-[18px] text-gray-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                <span>{loadingLabel}</span>
                <span className="animate-thinking-dots inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
          </div>
          {!isAtBottom && messages.length > 0 ? (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-700 shadow-lg transition-colors hover:bg-gray-50"
              aria-label="捲到最新訊息"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {composerAboveForm != null ? (
          <div className="mb-2 shrink-0 space-y-2">{composerAboveForm}</div>
        ) : null}

        <form onSubmit={handleSubmit} className="flex shrink-0 gap-2">
          {composerLeading != null ? (
            <div className="flex shrink-0 items-center">{composerLeading}</div>
          ) : null}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
            }}
            placeholder={inputPlaceholder ?? emptyPlaceholder}
            disabled={isLoading || submitDisabled}
            title={submitDisabled ? submitDisabledTitle : undefined}
            className="min-w-0 flex-1 rounded-lg border border-gray-300 px-4 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-50"
            aria-label="訊息輸入"
          />
          <button
            type="submit"
            disabled={isLoading || submitDisabled || (!input.trim() && !allowSubmitEmptyInput)}
            title={submitDisabled ? submitDisabledTitle : undefined}
            className="shrink-0 rounded-2xl bg-gray-800 px-5 py-2 text-[18px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
