/** Test02 Agent 專用 UI */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Plus } from 'lucide-react'
import AgentIcon from '@/components/AgentIcon'
import AgentPageLayout from '@/components/AgentPageLayout'
import { listMappingTemplates, type MappingTemplateItem } from '@/api/test01'
import type { Agent } from '@/types'

interface AgentTest02UIProps {
  agent: Agent
}

interface BlockItem {
  id: string
  selectedTemplateName: string
  selectedFiles: File[]
}

/** 從 CSV 檔案讀取第一行作為 headers */
function parseCsvHeadersFromFile(file: File): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const firstLine = text.trim().split('\n')[0] ?? ''
      const headers = firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      resolve(headers)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'UTF-8')
  })
}

/** 檢查是否為相同檔案 */
function isSameFile(a: File, b: File): boolean {
  return a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
}

/** 檢查 CSV headers 是否與模板格式相同（順序可不同） */
function headersMatch(templateHeaders: string[] | null, csvHeaders: string[]): boolean {
  if (!templateHeaders || templateHeaders.length === 0) return false
  const setA = new Set(templateHeaders.map((h) => h.trim()))
  const setB = new Set(csvHeaders.map((h) => h.trim()))
  if (setA.size !== setB.size) return false
  for (const h of setA) {
    if (!setB.has(h)) return false
  }
  return true
}

function ResizeHandle() {
  return (
    <Separator
      className="flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
    >
      <div className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80" aria-hidden />
    </Separator>
  )
}

function BlockCard({
  block,
  templates,
  canDelete,
  onTemplateChange,
  onFilesChange,
  onRemoveFile,
  onClearFiles,
  onDelete,
  onValidationError,
  fileInputId,
}: {
  block: BlockItem
  templates: MappingTemplateItem[]
  canDelete: boolean
  onTemplateChange: (id: string, value: string) => void
  onFilesChange: (id: string, files: File[]) => void
  onRemoveFile: (id: string, index: number) => void
  onClearFiles: (id: string) => void
  onDelete: (id: string) => void
  onValidationError: (message: string) => void
  fileInputId: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      const fileList = Array.from(files)
      const template = templates.find((t) => t.template_name === block.selectedTemplateName)
      const templateHeaders = template?.csv_headers ?? null

      const validFiles: File[] = []
      const invalidFiles: { file: File; reason: string }[] = []
      const duplicateFiles: File[] = []

      for (const file of fileList) {
        if (block.selectedFiles.some((f) => isSameFile(file, f))) {
          duplicateFiles.push(file)
          continue
        }
        try {
          if (!templateHeaders || templateHeaders.length === 0) {
            invalidFiles.push({ file, reason: '該模板未定義格式，無法驗證' })
            continue
          }
          const csvHeaders = await parseCsvHeadersFromFile(file)
          if (csvHeaders.length === 0) {
            invalidFiles.push({ file, reason: '無法讀取 CSV 欄位' })
            continue
          }
          if (!headersMatch(templateHeaders, csvHeaders)) {
            invalidFiles.push({
              file,
              reason: `格式不符：模板需 ${templateHeaders.join(', ')}，但檔案為 ${csvHeaders.join(', ')}`,
            })
            continue
          }
          if (validFiles.some((f) => isSameFile(file, f))) {
            duplicateFiles.push(file)
            continue
          }
          validFiles.push(file)
        } catch {
          invalidFiles.push({ file, reason: '無法讀取檔案' })
        }
      }

      if (validFiles.length > 0) {
        onFilesChange(block.id, [...block.selectedFiles, ...validFiles])
      }
      const messages: string[] = []
      if (duplicateFiles.length > 0) {
        const names = duplicateFiles.map((f) => f.name).join('、')
        messages.push(duplicateFiles.length > 1 ? `${names} 等檔案已存在，已略過` : `${names} 已存在，已略過`)
      }
      if (invalidFiles.length > 0) {
        const names = invalidFiles.map(({ file }) => file.name).join('、')
        messages.push(
          invalidFiles.length > 1 ? `${names} 等 ${invalidFiles.length} 個檔案格式與模板不符` : `${names}：${invalidFiles[0].reason}`
        )
      }
      if (messages.length > 0) {
        onValidationError(messages.join('；'))
      }

      setTimeout(() => {
        if (e.target) e.target.value = ''
      }, 0)
    },
    [block.id, block.selectedTemplateName, block.selectedFiles, templates, onFilesChange, onValidationError]
  )

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border-2 border-gray-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-3">
        <span className="text-lg font-medium text-gray-700">區塊</span>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(block.id)}
            className="rounded p-1 text-2xl leading-none text-gray-500 transition-colors hover:bg-red-100 hover:text-red-600"
            aria-label="刪除區塊"
          >
            ×
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex flex-col gap-5 p-4">
        {/* 資料模板區 */}
        <div className="flex flex-col gap-2">
          <label className="text-lg font-medium text-gray-700">資料模板</label>
          <select
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            value={block.selectedTemplateName}
            onChange={(e) => onTemplateChange(block.id, e.target.value)}
          >
            <option value="">— 未選擇 —</option>
            {templates.map((t) => (
              <option key={t.template_name} value={t.template_name}>
                {t.template_name}
              </option>
            ))}
          </select>
        </div>

        {/* 上傳檔案區：點擊或拖曳至此 */}
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => block.selectedTemplateName && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && block.selectedTemplateName) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (block.selectedTemplateName) e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
              if (!block.selectedTemplateName || !e.dataTransfer.files?.length) return
              const input = inputRef.current
              if (input) {
                const dt = new DataTransfer()
                for (const file of e.dataTransfer.files) dt.items.add(file)
                input.files = dt.files
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-3 transition-colors ${
              block.selectedTemplateName
                ? 'hover:border-gray-300 hover:bg-gray-100'
                : 'cursor-not-allowed opacity-60'
            }`}
            title={!block.selectedTemplateName ? '請先選擇資料模板' : '點擊或拖曳檔案至此'}
          >
            <div className="flex items-center justify-between px-3">
              <span className="text-lg text-gray-600">
                {block.selectedFiles.length > 0
                  ? `已選擇 ${block.selectedFiles.length} 個檔案`
                  : '點擊或拖曳檔案至此'}
              </span>
              {block.selectedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClearFiles(block.id)
                  }}
                  className="text-lg text-red-600 hover:underline"
                >
                  清除全部
                </button>
              )}
            </div>
            <ul
              className={`overflow-auto px-3 pb-2 ${
                block.selectedFiles.length > 0 ? 'min-h-0 max-h-28' : 'min-h-[2.5rem]'
              }`}
            >
              {block.selectedFiles.length > 0 ? (
                block.selectedFiles.map((file, i) => (
                  <li
                    key={`${file.name}-${file.lastModified}-${i}`}
                    className="flex items-center justify-between gap-2 border-b border-gray-200 py-1.5 last:border-b-0"
                  >
                    <span className="truncate text-lg text-gray-700" title={file.name}>
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemoveFile(block.id, i)
                      }}
                      className="shrink-0 text-lg text-red-500 hover:text-red-700"
                      aria-label={`移除 ${file.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))
              ) : null}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AgentTest02UI({ agent }: AgentTest02UIProps) {
  const nextIdRef = useRef(0)
  const [templates, setTemplates] = useState<MappingTemplateItem[]>([])
  const [blocks, setBlocks] = useState<BlockItem[]>(() => [
    { id: '0', selectedTemplateName: '', selectedFiles: [] },
  ])
  const [toast, setToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'csv' | 'data-adapter'>('csv')

  const loadTemplates = useCallback(() => {
    listMappingTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  const addBlock = () => {
    nextIdRef.current += 1
    setBlocks((prev) => [
      ...prev,
      { id: String(nextIdRef.current), selectedTemplateName: '', selectedFiles: [] },
    ])
  }

  const updateBlockTemplate = (id: string, value: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, selectedTemplateName: value, selectedFiles: [] } : b
      )
    )
  }

  const updateBlockFiles = (id: string, files: File[]) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selectedFiles: files } : b))
    )
  }

  const removeFileFromBlock = (id: string, index: number) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id
          ? { ...b, selectedFiles: b.selectedFiles.filter((_, i) => i !== index) }
          : b
      )
    )
  }

  const clearBlockFiles = (id: string) => {
    setBlocks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, selectedFiles: [] } : b))
    )
  }

  const removeBlock = (id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }

  return (
    <AgentPageLayout
      title={agent.agent_name}
      headerIcon={<AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />}
    >
      <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1 text-lg">
        {/* 左側空容器 */}
        <Panel
          defaultSize={20}
          minSize={15}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col p-4" />
        </Panel>
        <ResizeHandle />
        {/* 來源區塊：CSV / Data Adapter */}
        <Panel
          defaultSize={40}
          minSize={20}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex shrink-0 gap-1 border-b-2 border-gray-200 bg-gray-100 px-2 pt-2">
            <button
              type="button"
              onClick={() => setActiveTab('csv')}
              className={`rounded-t-2xl px-5 py-3 text-lg font-medium transition-colors ${
                activeTab === 'csv'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-800'
              }`}
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('data-adapter')}
              className={`rounded-t-2xl px-5 py-3 text-lg font-medium transition-colors ${
                activeTab === 'data-adapter'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-200/60 hover:text-gray-800'
              }`}
            >
              Data Adapter
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-lg">
            {activeTab === 'csv' && (
              <>
                {blocks.map((block) => (
                  <BlockCard
                    key={block.id}
                    block={block}
                    templates={templates}
                    canDelete={blocks.length > 1}
                    onTemplateChange={updateBlockTemplate}
                    onFilesChange={updateBlockFiles}
                    onRemoveFile={removeFileFromBlock}
                    onClearFiles={clearBlockFiles}
                    onDelete={removeBlock}
                    onValidationError={(msg) => setToast(msg)}
                    fileInputId={`file-input-${block.id}`}
                  />
                ))}
                <button
                  type="button"
                  onClick={addBlock}
                  className="flex shrink-0 items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-lg text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50"
                  aria-label="新增區塊"
                >
                  <Plus className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  className="flex shrink-0 items-center justify-center rounded-lg bg-blue-600 py-4 text-lg text-white transition-colors hover:bg-blue-700"
                >
                  匯入資料
                </button>
              </>
            )}
            {activeTab === 'data-adapter' && (
              <div className="flex flex-1 items-center justify-center text-gray-500">
                Data Adapter 開發中
              </div>
            )}
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={40}
          minSize={20}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col p-4 text-lg">
            <p className="text-lg text-gray-600">右側容器</p>
          </div>
        </Panel>
      </Group>
      {toast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg bg-red-600 px-4 py-2 text-lg text-white shadow-lg"
          role="alert"
        >
          {toast}
        </div>
      )}
    </AgentPageLayout>
  )
}
