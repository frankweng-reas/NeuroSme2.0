/** Agent 頁面共用聊天元件：訊息列表、輸入框、loading、捲到底 */
import { useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, Copy, FileDown, Loader2, X } from 'lucide-react'
import type { ExamplePromptItem } from '@/types/examplePrompts'
import ChartModal, { type ChartData } from '@/components/ChartModal'
import PdfPreviewModal from '@/components/PdfPreviewModal'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-[18px] text-gray-900" {...props}>
      {children}
    </p>
  ),
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold text-gray-900 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-lg font-semibold text-gray-900" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-2 text-base font-semibold text-gray-800" {...props}>
      {children}
    </h3>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[18px] text-gray-900" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
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
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[16px]" {...props}>
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 text-[16px]" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-100" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-gray-900" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr {...props}>{children}</tr>
  ),
  tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props}>{children}</tbody>
  ),
}

export interface ResponseMeta {
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string | null
}

export type { ChartData } from '@/components/ChartModal'

export interface Message {
  role: 'user' | 'assistant'
  content: string
  meta?: ResponseMeta
  chartData?: ChartData
  sources?: { filename: string }[]
}

/** 三階段 loading 文字（意圖解析 → 計算 → 分析建議） */
export type LoadingStage = 'intent' | 'compute' | 'text'

const LOADING_STAGE_LABELS: Record<LoadingStage, string> = {
  intent: '意圖解析中…',
  compute: '計算中…',
  text: '分析建議…',
}

export type { ExamplePromptItem }

const MAX_CUSTOM_EXAMPLE_CHARS = 280

interface AgentChatProps {
  messages: Message[]
  onSubmit: (text: string) => void
  isLoading: boolean
  /** 三階段進度，有值時取代預設「助理思考中」 */
  loadingStage?: LoadingStage | null
  onCopySuccess?: () => void
  onCopyError?: () => void
  emptyPlaceholder?: string
  /** 覆寫空狀態字級／顏色（預設 text-[18px] text-gray-400） */
  emptyPlaceholderClassName?: string
  /** 為 true 時無法送出（仍可在輸入框打字） */
  submitDisabled?: boolean
  submitDisabledTitle?: string
  headerTitle?: string
  headerActions?: React.ReactNode
  /** 系統 + 使用者範例（點選帶入輸入框） */
  examplePrompts?: readonly ExamplePromptItem[]
  /** 刪除一則使用者範例（系統範例 id 父層應忽略） */
  onExamplePromptRemove?: (id: string) => void
  /** 新增一則使用者範例 */
  onExamplePromptAdd?: (text: string) => void
  /**
   * inline：在輸入框上方展開區塊（預設）
   * modal：由父層開啟獨立視窗，此處不顯示例區；請搭配 chatInputSeed 帶入文字
   */
  exampleLayout?: 'inline' | 'modal'
  /** 父層選好範例後遞增 n 並帶入 text，會寫入輸入框並 focus */
  chatInputSeed?: { n: number; text: string } | null
  onChatInputSeedApplied?: () => void
  /** 控制訊息下方動作列顯示哪些按鈕（預設全開） */
  showCopy?: boolean
  showChart?: boolean
  showPdf?: boolean
  /** 輸入框左側插槽（例：語音輸入按鈕） */
  composerLeading?: React.ReactNode
  /** 外部注入文字（每次值變化時 append 到輸入框並 focus） */
  appendInputText?: string
  /** 外部取代文字（每次值變化時完整取代輸入框內容，適合語音輸入） */
  replaceInputText?: string
  /** 帶入文字並自動送出（語音確認後直接送出） */
  appendAndSendText?: string
  /** 緊湊模式：移除訊息區卡片邊框與外距，適合全螢幕 Widget */
  compact?: boolean
}

export default function AgentChat({
  messages,
  onSubmit,
  isLoading,
  loadingStage,
  onCopySuccess,
  onCopyError,
  emptyPlaceholder = '輸入訊息開始對話...',
  emptyPlaceholderClassName,
  submitDisabled = false,
  submitDisabledTitle,
  headerTitle = '對話',
  headerActions,
  examplePrompts,
  onExamplePromptRemove,
  onExamplePromptAdd,
  exampleLayout = 'inline',
  chatInputSeed,
  onChatInputSeedApplied,
  showCopy = true,
  showChart = true,
  showPdf = true,
  composerLeading,
  appendInputText,
  replaceInputText,
  appendAndSendText,
  compact = false,
}: AgentChatProps) {
  const [input, setInput] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [chartModalIndex, setChartModalIndex] = useState<number | null>(null)
  const [pdfPreviewTarget, setPdfPreviewTarget] = useState<{ content: string; chartData?: ChartData } | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const [exampleDraft, setExampleDraft] = useState('')
  const [examplePanelOpen, setExamplePanelOpen] = useState(true)
  const prevMessageCountRef = useRef(messages.length)

  const hasExampleBlock = Boolean(
    exampleLayout === 'inline' &&
      ((examplePrompts && examplePrompts.length > 0) || onExamplePromptAdd)
  )

  const onSeedAppliedRef = useRef(onChatInputSeedApplied)
  onSeedAppliedRef.current = onChatInputSeedApplied
  const lastSeedNRef = useRef<number | null>(null)

  useEffect(() => {
    if (!chatInputSeed) return
    if (lastSeedNRef.current === chatInputSeed.n) return
    lastSeedNRef.current = chatInputSeed.n
    setInput(chatInputSeed.text)
    queueMicrotask(() => chatInputRef.current?.focus())
    onSeedAppliedRef.current?.()
  }, [chatInputSeed?.n, chatInputSeed?.text])

  useEffect(() => {
    if (isAtBottom) {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

  useEffect(() => {
    const prev = prevMessageCountRef.current
    if (prev === 0 && messages.length > 0) setExamplePanelOpen(false)
    if (messages.length === 0) setExamplePanelOpen(true)
    prevMessageCountRef.current = messages.length
  }, [messages.length])

  function handleChatScroll() {
    const el = chatScrollRef.current
    if (!el) return
    const { scrollTop, scrollHeight, clientHeight } = el
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    setIsAtBottom(atBottom)
  }

  function scrollToBottom() {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    setIsAtBottom(true)
  }

  // 外部注入文字（append 模式）
  useEffect(() => {
    if (!appendInputText) return
    setInput((prev) => prev ? `${prev} ${appendInputText}` : appendInputText)
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [appendInputText])

  // 外部取代文字（語音輸入：直接替換整個輸入框）
  useEffect(() => {
    if (replaceInputText === undefined || replaceInputText === '') return
    setInput(replaceInputText)
    setTimeout(() => chatInputRef.current?.focus(), 0)
  }, [replaceInputText])

  // 語音確認自動送出
  useEffect(() => {
    if (!appendAndSendText) return
    const text = appendAndSendText.trim()
    if (!text || isLoading || submitDisabled) return
    onSubmit(text)
    setInput('')
  }, [appendAndSendText])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading || submitDisabled) return
    setInput('')
    onSubmit(text)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  function handleOpenPdfPreview(content: string, chartData?: ChartData) {
    setPdfPreviewTarget({ content, chartData })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {(headerTitle || headerActions) && (
        <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
          <span>{headerTitle}</span>
          {headerActions}
        </header>
      )}
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${compact ? 'p-0' : 'p-3 sm:p-4'}`}>
        <div className={`relative flex-1 min-h-0 ${compact ? 'mb-2' : 'mb-4'}`}>
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className={`h-full overflow-y-auto p-4 ${compact ? 'bg-gray-50' : 'rounded-xl border border-gray-200/80 bg-gray-50/60 ring-1 ring-gray-200/40'}`}
          >
            {messages.length === 0 ? (
              <p
                className={`whitespace-pre-line ${emptyPlaceholderClassName ?? 'text-[18px] text-gray-400'}`}
              >
                {emptyPlaceholder}
              </p>
            ) : (
              <ul className="flex flex-col space-y-4">
                {messages.map((m, i) => {
                  if (m.role === 'assistant' && !m.content) return null
                  return (
                  <li
                    key={i}
                    className={`flex flex-col rounded-xl px-4 py-3 shadow-sm ${
                      m.role === 'user'
                        ? 'ml-auto w-fit max-w-[85%] bg-gray-800 text-white ring-1 ring-gray-700/50'
                        : 'mr-8 border border-gray-100 bg-white text-gray-900 ring-1 ring-gray-200/50'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-[18px] leading-relaxed">{m.content}</p>
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
                    {m.role === 'assistant' && m.meta && (
                      <div className="mt-2 border-t border-gray-200 pt-2 text-[18px] text-gray-600">
                        model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                        {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                        {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                      </div>
                    )}
                    {m.role === 'assistant' && m.content && (showCopy || showChart || showPdf) && (
                      <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                        {showCopy && (
                          <button
                            type="button"
                            onClick={() => handleCopy(m.content)}
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <Copy className="h-4 w-4" />
                            複製
                          </button>
                        )}
                        {showChart && (
                          <button
                            type="button"
                            onClick={() => m.chartData && setChartModalIndex(i)}
                            disabled={!m.chartData}
                            title={m.chartData ? '檢視圖表' : '此回覆無圖表資料'}
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                          >
                            <BarChart3 className="h-4 w-4" />
                            圖表
                          </button>
                        )}
                        {showPdf && (
                          <button
                            type="button"
                            onClick={() => handleOpenPdfPreview(m.content, m.chartData)}
                            title="匯出 PDF"
                            className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <FileDown className="h-4 w-4" />
                            PDF
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                  )
                })}
              </ul>
            )}
            {isLoading && (
              <p className="mt-2 flex items-center gap-2 text-[18px] text-gray-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                <span>{loadingStage ? LOADING_STAGE_LABELS[loadingStage] : '助理思考中'}</span>
                <span className="animate-thinking-dots inline-flex">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
          </div>
          {!isAtBottom && messages.length > 0 && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center justify-center rounded-full border border-gray-300 bg-white p-2 text-gray-700 shadow-lg transition-colors hover:bg-gray-50"
              aria-label="跳到最後"
            >
              <ChevronDown className="h-5 w-5" />
            </button>
          )}
        </div>
        {chartModalIndex != null && messages[chartModalIndex]?.chartData && (
          <ChartModal
            open
            data={messages[chartModalIndex].chartData!}
            onClose={() => setChartModalIndex(null)}
          />
        )}
        {pdfPreviewTarget && (
          <PdfPreviewModal
            open
            content={pdfPreviewTarget.content}
            chartData={pdfPreviewTarget.chartData}
            onClose={() => setPdfPreviewTarget(null)}
            onDownloadError={onCopyError}
          />
        )}
        {hasExampleBlock && (
          <div className="mb-3 shrink-0 rounded-xl border border-gray-200/80 bg-white/90 px-3 py-2 ring-1 ring-gray-200/40">
            <button
              type="button"
              onClick={() => setExamplePanelOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-left text-[16px] text-gray-800 transition-colors hover:bg-gray-50"
              aria-expanded={examplePanelOpen}
            >
              <span>
                <span className="font-semibold text-gray-800">範例問題</span>
                <span className="ml-2 font-normal text-gray-500">點選帶入下方輸入框</span>
              </span>
              <ChevronDown
                className={`h-5 w-5 shrink-0 text-gray-500 transition-transform ${examplePanelOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {examplePanelOpen && (
              <div className="mt-2 space-y-3 border-t border-gray-100 pt-3">
                {examplePrompts != null && examplePrompts.some((p) => p.isSystem) && (
                  <div>
                    <p className="mb-1.5 text-[14px] font-medium text-gray-500">系統提供</p>
                    <div className="flex flex-wrap gap-2">
                      {examplePrompts
                        .filter((p) => p.isSystem)
                        .map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setInput(p.text)
                              chatInputRef.current?.focus()
                            }}
                            disabled={isLoading}
                            className="max-w-full rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-left text-[15px] leading-snug text-gray-800 transition-colors hover:border-slate-300 hover:bg-slate-100 disabled:opacity-50"
                          >
                            <span className="line-clamp-2">{p.text}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
                {examplePrompts != null && examplePrompts.some((p) => !p.isSystem) && (
                  <div>
                    <p className="mb-1.5 text-[14px] font-medium text-gray-500">我的範例</p>
                    <div className="flex flex-wrap gap-2">
                      {examplePrompts
                        .filter((p) => !p.isSystem)
                        .map((p) => (
                          <div
                            key={p.id}
                            className="flex max-w-full items-center gap-0.5 rounded-full border border-blue-200 bg-blue-50/80 pl-3 pr-1 py-1"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setInput(p.text)
                                chatInputRef.current?.focus()
                              }}
                              disabled={isLoading}
                              className="min-w-0 max-w-[min(100%,24rem)] text-left text-[15px] leading-snug text-gray-800 transition-opacity hover:opacity-90 disabled:opacity-50"
                            >
                              <span className="line-clamp-2">{p.text}</span>
                            </button>
                            {onExamplePromptRemove && (
                              <button
                                type="button"
                                onClick={() => onExamplePromptRemove(p.id)}
                                className="shrink-0 rounded-full p-1 text-blue-700/80 transition-colors hover:bg-blue-100 hover:text-blue-900"
                                aria-label={`刪除範例：${p.text.slice(0, 20)}${p.text.length > 20 ? '…' : ''}`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {examplePrompts != null &&
                  examplePrompts.length === 0 &&
                  !onExamplePromptAdd && (
                    <p className="text-[15px] text-gray-500">目前沒有範例問題。</p>
                  )}
                {onExamplePromptAdd && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      value={exampleDraft}
                      onChange={(e) => setExampleDraft(e.target.value.slice(0, MAX_CUSTOM_EXAMPLE_CHARS))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.nativeEvent.isComposing) return
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const t = exampleDraft.trim()
                          if (!t) return
                          onExamplePromptAdd(t)
                          setExampleDraft('')
                        }
                      }}
                      placeholder="新增我的範例…"
                      maxLength={MAX_CUSTOM_EXAMPLE_CHARS}
                      disabled={isLoading}
                      className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[15px] text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={isLoading || !exampleDraft.trim()}
                      onClick={() => {
                        const t = exampleDraft.trim()
                        if (!t) return
                        onExamplePromptAdd(t)
                        setExampleDraft('')
                      }}
                      className="shrink-0 rounded-xl bg-gray-200 px-4 py-2 text-[15px] font-medium text-gray-800 transition-colors hover:bg-gray-300 disabled:opacity-40"
                    >
                      加入
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <form onSubmit={handleSubmit} className={`flex gap-1.5 sm:gap-2 ${compact ? 'px-3 pb-2 sm:px-4' : ''}`}>
          {composerLeading}
          <input
            ref={chatInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
            }}
            placeholder="輸入訊息..."
            className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 sm:px-4 sm:text-[18px]"
            disabled={isLoading}
          />
          <button
            type="submit"
            title={submitDisabled ? submitDisabledTitle : undefined}
            disabled={isLoading || !input.trim() || submitDisabled}
            className="min-h-[44px] min-w-[64px] rounded-2xl bg-gray-800 px-4 py-2 text-[16px] font-medium text-white transition-colors hover:bg-gray-900 disabled:opacity-40 sm:px-5 sm:text-[18px]"
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
