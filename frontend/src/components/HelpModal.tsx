/** 共用 Online Help modal：依 url 動態載入 Markdown 並渲染 */
import { useEffect, useRef, useState } from 'react'
import { BookOpen, Download, Loader2, X } from 'lucide-react'
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
  const contentRef = useRef<HTMLDivElement>(null)

  function handleDownloadPdf() {
    if (!contentRef.current) return
    const html = contentRef.current.innerHTML
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif; max-width: 820px; margin: 40px auto; padding: 0 24px; color: #1e293b; font-size: 15px; line-height: 1.7; }
    h1 { font-size: 22px; font-weight: 700; margin: 0 0 16px; color: #0f172a; }
    h2 { font-size: 18px; font-weight: 700; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #3b82f6; color: #1e3a5f; }
    h3 { font-size: 15px; font-weight: 600; margin: 20px 0 8px; color: #334155; }
    p  { margin: 0 0 10px; }
    ul, ol { margin: 0 0 12px 20px; padding: 0; }
    li { margin-bottom: 4px; }
    strong { color: #1d4ed8; font-weight: 600; }
    code { background: #f1f5f9; border-radius: 4px; padding: 1px 6px; font-size: 13px; }
    pre { background: #f1f5f9; border-radius: 6px; padding: 12px 16px; overflow-x: auto; }
    blockquote { border-left: 4px solid #3b82f6; margin: 12px 0; padding: 6px 16px; background: #eff6ff; color: #1e40af; border-radius: 0 6px 6px 0; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
    th { background: #334155; color: white; padding: 8px 12px; text-align: left; font-weight: 600; }
    td { border: 1px solid #e2e8f0; padding: 7px 12px; }
    tr:nth-child(even) td { background: #f8fafc; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
    @media print { body { margin: 20px; } }
  </style>
</head>
<body>${html}</body>
</html>`)
    win.document.close()
    setTimeout(() => { win.print() }, 400)
  }

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
            <div className="text-[17px]" ref={contentRef}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {content ?? ''}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between rounded-b-3xl border-t border-slate-100 bg-slate-50 px-6 py-3">
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={loading || !content}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            下載 PDF
          </button>
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
