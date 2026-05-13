/** 共用 Toast：showToast(msg, type) 顯示訊息，自動消失 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const DURATION_MS = 2000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextIdRef = useRef(0)

  const showToast = useCallback((message: string, type: ToastType = 'success', duration = DURATION_MS) => {
    const id = nextIdRef.current++
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, duration)
  }, [])

  const toastStack =
    typeof document !== 'undefined'
      ? createPortal(
          <div
            className="pointer-events-none fixed bottom-8 left-1/2 z-[10000] flex max-w-[min(100vw-1rem,36rem)] -translate-x-1/2 flex-col gap-2 px-2"
            role="status"
            aria-live="polite"
          >
            {toasts.map((t) => (
              <div
                key={t.id}
                className={`pointer-events-auto rounded-lg px-4 py-2 text-center text-[18px] font-medium text-white shadow-lg ${
                  t.type === 'error' ? 'bg-red-600' : 'bg-gray-800'
                }`}
              >
                {t.message}
              </div>
            ))}
          </div>,
          document.body
        )
      : null

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toastStack}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
