/** 共用確認 modal：標題、訊息、取消／確認按鈕 */
interface ConfirmModalProps {
  open: boolean
  title: string
  message: string
  cancelText?: string
  confirmText: string
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  open,
  title,
  message,
  cancelText = '取消',
  confirmText,
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!open) return null

  const confirmClass =
    variant === 'danger'
      ? 'rounded-2xl bg-red-600 px-4 py-2 text-white hover:bg-red-700'
      : 'rounded-2xl px-4 py-2 text-white hover:opacity-90'
  const confirmStyle = variant === 'primary' ? { backgroundColor: '#4b5563' } : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative z-10 min-w-[320px] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 font-semibold text-gray-800">{title}</h2>
        <p className="mb-6 text-gray-600">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-2xl border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={confirmClass}
            style={confirmStyle}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
