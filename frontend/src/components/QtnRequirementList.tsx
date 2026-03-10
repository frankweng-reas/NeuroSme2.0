/** 需求描述：使用 SourceListManager + QtnSourceAdapter，UI 與 SourceFileManager 統一 */
import { useMemo, useState } from 'react'
import SourceListManager from '@/components/SourceListManager'
import { createQtnSourceAdapter } from '@/adapters/qtnSourceAdapter'

export interface QtnRequirementListProps {
  projectId: string | null
  collapsible?: boolean
  /** 點擊後縮小左側區塊（由父層傳入） */
  onCollapseLeft?: () => void
}

export default function QtnRequirementList({
  projectId,
  collapsible = true,
  onCollapseLeft,
}: QtnRequirementListProps) {
  const [collapsed, setCollapsed] = useState(false)
  const adapter = useMemo(
    () => (projectId ? createQtnSourceAdapter(projectId, 'REQUIREMENT') : null),
    [projectId]
  )

  if (!projectId) {
    return (
      <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50">
        <div className="flex min-h-[60px] shrink-0 w-full items-center justify-between gap-2 rounded-t-xl bg-sky-100 px-4 py-3">
          <h4 className="text-base font-medium text-gray-700">需求描述</h4>
          {onCollapseLeft && (
            <button
              type="button"
              onClick={onCollapseLeft}
              className="shrink-0 rounded-2xl p-1 text-gray-600 transition-colors hover:bg-sky-200 hover:text-gray-800"
              aria-label="縮小左側區塊"
              title="縮小左側區塊"
            >
              &lt;&lt;
            </button>
          )}
        </div>
        <p className="px-4 py-4 text-base text-gray-500">請先選擇專案</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50">
      <div className="flex min-h-[60px] shrink-0 w-full items-center justify-between gap-2 rounded-t-xl bg-sky-100 px-4 py-3">
        <button
          type="button"
          className={`flex flex-1 items-center text-left ${collapsible ? '' : 'cursor-default'}`}
          onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        >
          <h4 className="text-base font-medium text-gray-700">需求描述</h4>
        </button>
        {onCollapseLeft && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onCollapseLeft()
            }}
            className="shrink-0 rounded-2xl p-1 text-gray-600 transition-colors hover:bg-sky-200 hover:text-gray-800"
            aria-label="縮小左側區塊"
            title="縮小左側區塊"
          >
            &lt;&lt;
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-t border-gray-200">
          <SourceListManager adapter={adapter!} title="" showHelp={false} hideHeader={true} />
        </div>
      )}
    </div>
  )
}
