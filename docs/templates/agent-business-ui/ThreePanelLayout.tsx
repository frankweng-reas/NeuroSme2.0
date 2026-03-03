/**
 * Template: 三欄可拖曳調整大小的商務型 UI 版面
 *
 * 使用方式：複製此檔案到專案中，依需求修改。
 *
 * 依賴套件：
 *   - react
 *   - react-router-dom
 *   - lucide-react
 *   - react-resizable-panels
 *   - tailwindcss
 *
 * 安裝：npm install react-resizable-panels lucide-react
 */

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Bot } from 'lucide-react'
import { Group, Panel, Separator } from 'react-resizable-panels'

export interface ThreePanelLayoutProps {
  /** 標題（顯示於 header） */
  title: string
  /** 返回按鈕連結，預設 "/" */
  backHref?: string
  /** 可選：自訂 header 圖示元件，不傳則使用預設 Bot 圖示 */
  headerIcon?: ReactNode
}

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <Separator
      className={`flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-100 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${className}`}
    >
      <div
        className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300"
        aria-hidden
      />
    </Separator>
  )
}

export default function ThreePanelLayout({
  title,
  backHref = '/',
  headerIcon,
}: ThreePanelLayoutProps) {
  return (
    <div className="flex h-full flex-col p-4 text-[18px]">
      {/* Header */}
      <header
        className="flex-shrink-0 rounded-2xl border-b border-gray-200 px-6 py-4 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {headerIcon ?? <Bot className="h-6 w-6 text-white" />}
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

      {/* 左、中、右三欄可拖曳調整大小的獨立容器 */}
      <Group orientation="horizontal" className="mt-4 flex min-h-0 flex-1 gap-1">
        <Panel
          defaultSize={25}
          minSize="200px"
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <header className="flex-shrink-0 rounded-t-xl border-b-2 border-gray-300 bg-gray-100 px-4 py-3 font-semibold text-gray-800">
            左側
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <p className="text-gray-500">左側</p>
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={50}
          minSize="300px"
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <header className="flex-shrink-0 rounded-t-xl border-b-2 border-gray-300 bg-gray-100 px-4 py-3 font-semibold text-gray-800">
            中間
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <p className="text-gray-500">中間</p>
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={25}
          minSize="200px"
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <header className="flex-shrink-0 rounded-t-xl border-b-2 border-gray-300 bg-gray-100 px-4 py-3 font-semibold text-gray-800">
            右側
          </header>
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            <p className="text-gray-500">右側</p>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
