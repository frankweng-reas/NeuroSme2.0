/** PDF 預覽 Modal：顯示文字＋圖表，提供下載與關閉 */
import { useEffect, useRef, useState } from 'react'
import { FileDown, Loader2, X } from 'lucide-react'
import ChartForPdf from '@/components/ChartForPdf'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import html2pdf from 'html2pdf.js'
import type { ChartData } from './ChartModal'

const CHAT_MARKDOWN_COMPONENTS = {
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-2 last:mb-0 leading-relaxed text-[18px] text-gray-900" {...props}>{children}</p>
  ),
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-2 mt-3 text-xl font-semibold text-gray-900 first:mt-0" {...props}>{children}</h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-2 mt-3 border-b border-gray-200 pb-1 text-lg font-semibold text-gray-900" {...props}>{children}</h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-2 text-base font-semibold text-gray-800" {...props}>{children}</h3>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul className="mb-2 ml-4 list-disc space-y-1 text-[18px] text-gray-900" {...props}>{children}</ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1 text-[18px] text-gray-900" {...props}>{children}</ol>
  ),
  li: ({ children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
    <li className="leading-relaxed" {...props}>{children}</li>
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-semibold text-gray-900" {...props}>{children}</strong>
  ),
  code: ({ children, className, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes('language-')
    if (isBlock) return <code className="block whitespace-pre overflow-x-auto" {...props}>{children}</code>
    return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[16px]" {...props}>{children}</code>
  },
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-gray-100 p-3 text-[16px]" {...props}>{children}</pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-2 overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-200 text-[16px]" {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className="bg-gray-100" {...props}>{children}</thead>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th className="border border-gray-200 px-3 py-2 text-left font-semibold text-gray-900" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td className="border border-gray-200 px-3 py-2 text-gray-900" {...props}>{children}</td>
  ),
  tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => <tr {...props}>{children}</tr>,
  tbody: ({ children, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => <tbody {...props}>{children}</tbody>,
}

interface PdfPreviewModalProps {
  open: boolean
  content: string
  chartData?: ChartData
  onClose: () => void
  onDownloadError?: () => void
}

export default function PdfPreviewModal({ open, content, chartData, onClose, onDownloadError }: PdfPreviewModalProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  async function handleDownload() {
    const el = contentRef.current
    if (!el || downloading) return
    setDownloading(true)
    try {
      const opt = {
        margin: 12,
        filename: `chat-export-${Date.now()}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.95 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
      }
      await html2pdf().set(opt).from(el).save()
      onClose()
    } catch {
      onDownloadError?.()
    } finally {
      setDownloading(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="PDF 預覽"
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 bg-slate-100 px-6 py-4">
          <h2 className="text-[18px] font-semibold text-slate-800">PDF 預覽</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl p-2 text-slate-600 transition-colors hover:bg-slate-200"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          <div ref={contentRef} className="bg-white">
            <div className="prose prose-sm max-w-none text-gray-900">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={CHAT_MARKDOWN_COMPONENTS}
              >
                {content.replace(/\\n/g, '\n')}
              </ReactMarkdown>
            </div>
            {chartData && (
              <div className="mt-6">
                <ChartForPdf data={chartData} />
              </div>
            )}
          </div>
        </div>
        <footer className="flex flex-shrink-0 justify-end gap-3 border-t border-slate-200 bg-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-300 bg-white px-5 py-2.5 text-[16px] font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            關閉
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 rounded-2xl border border-slate-300 bg-slate-700 px-5 py-2.5 text-[16px] font-medium text-white shadow-sm hover:bg-slate-600 disabled:opacity-50"
          >
            {downloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                下載中...
              </>
            ) : (
              <>
                <FileDown className="h-4 w-4" />
                下載
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
