/** Agent 頁面共用聊天元件：訊息列表、輸入框、loading、捲到底 */
import { useEffect, useRef, useState } from 'react'
import { BarChart3, ChevronDown, Copy, Loader2 } from 'lucide-react'
import ChartModal, { type ChartData } from '@/components/ChartModal'
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
}

interface AgentChatProps {
  messages: Message[]
  onSubmit: (text: string) => void
  isLoading: boolean
  onCopySuccess?: () => void
  onCopyError?: () => void
  emptyPlaceholder?: string
  headerTitle?: string
  headerActions?: React.ReactNode
}

export default function AgentChat({
  messages,
  onSubmit,
  isLoading,
  onCopySuccess,
  onCopyError,
  emptyPlaceholder = '輸入訊息開始對話...',
  headerTitle = '對話',
  headerActions,
}: AgentChatProps) {
  const [input, setInput] = useState('')
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [chartModalIndex, setChartModalIndex] = useState<number | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isAtBottom) {
      chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages, isLoading, isAtBottom])

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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    onSubmit(text)
  }

  function handleCopy(content: string) {
    navigator.clipboard.writeText(content).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
        <span>{headerTitle}</span>
        {headerActions}
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
        <div className="relative mb-4 flex-1 min-h-0">
          <div
            ref={chatScrollRef}
            onScroll={handleChatScroll}
            className="h-full overflow-y-auto rounded-xl border border-gray-200/80 bg-gray-50/60 ring-1 ring-gray-200/40 p-4"
          >
            {messages.length === 0 ? (
              <p className="text-[18px] text-gray-400">{emptyPlaceholder}</p>
            ) : (
              <ul className="flex flex-col space-y-3">
                {messages.map((m, i) => (
                  <li
                    key={i}
                    className={`flex flex-col rounded-lg px-3 py-2 shadow-sm ${
                      m.role === 'user'
                        ? 'ml-auto w-fit max-w-[85%] bg-blue-100 text-blue-900 ring-1 ring-blue-200/40'
                        : 'mr-8 bg-white text-gray-900 ring-1 ring-gray-200/50'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="whitespace-pre-wrap text-[18px]">{m.content}</p>
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
                    {m.role === 'assistant' && (
                      <div className="mt-2 border-t border-amber-200 bg-amber-50/50 rounded p-2 text-[14px] text-amber-900">
                        <div className="font-mono font-semibold text-amber-700">[debug]</div>
                        <div className="mt-1">
                          <span className="text-amber-700">text:</span>{' '}
                          <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words text-[13px]">
                            {m.content}
                          </pre>
                        </div>
                        <div className="mt-1">
                          <span className="text-amber-700">data:</span>{' '}
                          <pre className="mt-0.5 overflow-x-auto text-[13px]">
                            {m.chartData ? JSON.stringify(m.chartData, null, 2) : 'null'}
                          </pre>
                        </div>
                      </div>
                    )}
                    {m.role === 'assistant' && m.meta && (
                      <div className="mt-2 border-t border-gray-200 pt-2 text-[18px] text-gray-600">
                        model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                        {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                        {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                      </div>
                    )}
                    {m.role === 'assistant' && (
                      <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                        <button
                          type="button"
                          onClick={() => handleCopy(m.content)}
                          className="flex items-center gap-1 rounded-2xl px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                        >
                          <Copy className="h-4 w-4" />
                          複製
                        </button>
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
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {isLoading && (
              <p className="mt-2 flex items-center gap-2 text-[18px] text-gray-500">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                <span>助理思考中</span>
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
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
            }}
            placeholder="輸入訊息..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="rounded-2xl px-4 py-2 text-[18px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#4b5563' }}
          >
            送出
          </button>
        </form>
      </div>
    </div>
  )
}
