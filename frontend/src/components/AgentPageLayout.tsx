/** 共用：Agent 頁面 header + 內容區，與 template 樣式一致 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export interface AgentPageLayoutProps {
  /** 標題（顯示於 header） */
  title: string
  /** 返回按鈕連結，預設 "/" */
  backHref?: string
  /** 可選：自訂 header 圖示元件 */
  headerIcon?: ReactNode
  /** 內容區 */
  children: ReactNode
}

export default function AgentPageLayout({
  title,
  backHref = '/',
  headerIcon,
  children,
}: AgentPageLayoutProps) {
  return (
    <div className="flex h-full flex-col p-4 text-[18px]">
      <header
        className="flex-shrink-0 rounded-2xl border-b border-gray-200 px-6 py-4 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {headerIcon}
            <h1 className="text-2xl font-bold text-white">{title}</h1>
          </div>
          <Link
            to={backHref}
            className="flex items-center text-white transition-opacity hover:opacity-80"
            aria-label="返回"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
        </div>
      </header>
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  )
}
