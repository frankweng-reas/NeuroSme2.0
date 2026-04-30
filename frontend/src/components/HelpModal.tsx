/** 共用 Online Help modal：依 url 動態載入 Markdown 並渲染 */
import { useEffect, useState } from 'react'
import { BookOpen, Loader2, X } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export interface HelpModalProps {
  open: boolean
  onClose: () => void
  /** help 檔案 URL，預設 /help-sourcefile.md */
  url?: string
  /** modal 標題，預設「使用說明」 */
  title?: string
}

const MARKDOWN_COMPONENTS = {
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-3 mt-4 text-2xl font-bold text-slate-900 first:mt-0" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-3 mt-6 flex items-center gap-2.5 text-xl font-bold text-slate-800" {...props}>
      <span className="inline-block h-5 w-1 shrink-0 rounded-full bg-blue-500" aria-hidden="true" />
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-4 flex items-center gap-1.5 text-[1.05rem] font-semibold text-slate-700" {...props}>
      <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden="true" />
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 leading-relaxed text-slate-600" {...props}>
      {children}
    </p>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-3 ml-4 list-disc space-y-1 text-slate-600" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-3 ml-4 list-decimal list-outside pl-6 space-y-1 text-slate-600" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>
      {children}
    </li>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-blue-700" {...props}>
      {children}
    </strong>
  ),
  code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] text-slate-700" {...props}>
      {children}
    </code>
  ),
  hr: () => <hr className="my-5 border-slate-200" />,
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="min-w-full border-collapse text-base" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-slate-700 text-white" {...props}>
      {children}
    </thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="px-4 py-2.5 text-left text-sm font-semibold tracking-wide text-white" {...props}>
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border-t border-slate-100 px-4 py-2.5 text-slate-700" {...props}>
      {children}
    </td>
  ),
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className="even:bg-slate-50" {...props}>{children}</tr>
  ),
  tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody {...props}>{children}</tbody>
  ),
}

export default function HelpModal({
  open,
  onClose,
  url = '/help-sourcefile.md',
  title = '使用說明',
}: HelpModalProps) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setContent(null)
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('載入失敗'))))
      .then(setContent)
      .catch(() => setContent('# 載入失敗\n\n請稍後再試或聯絡管理員。'))
      .finally(() => setLoading(false))
  }, [open, url])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-[63rem] flex-col rounded-3xl bg-white shadow-2xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between rounded-t-3xl bg-gradient-to-r from-slate-700 to-slate-600 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <BookOpen className="h-5 w-5 text-white" aria-hidden />
            </div>
            <h2 id="help-modal-title" className="text-xl font-bold tracking-tight text-white">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-blue-400" aria-hidden />
            </div>
          ) : (
            <div className="text-[17px]">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content ?? ''}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 justify-end rounded-b-3xl border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  )
}
