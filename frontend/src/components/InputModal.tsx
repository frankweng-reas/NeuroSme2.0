/** 共用輸入 modal：標題、表單內容、取消／儲存按鈕 */
import type { ReactNode } from 'react'

interface InputModalProps {
  open: boolean
  title: string
  children: ReactNode
  submitLabel: string
  loading?: boolean
  onSubmit: () => void
  onClose: () => void
}

export default function InputModal({
  open,
  title,
  children,
  submitLabel,
  loading = false,
  onSubmit,
  onClose,
}: InputModalProps) {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative z-10 max-h-[90vh] min-w-[320px] max-w-[90vw] overflow-y-auto rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-[20px] font-semibold text-gray-800">{title}</h2>
        <div className="mb-6">{children}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-[18px] font-medium text-gray-700 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={loading}
            className="rounded-lg px-4 py-2 text-[18px] font-medium text-white shadow-sm disabled:opacity-50"
            style={{ backgroundColor: '#4b5563' }}
          >
            {loading ? '儲存中...' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
