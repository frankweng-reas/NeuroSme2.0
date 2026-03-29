/**
 * agent_id 含 business 時使用：商務型 agent 專用 UI。
 * 資料匯入僅使用 biProjects.importCsvToDuckdb（bi_schemas → DuckDB），不使用 bi_sources API。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronsRight, Database, HelpCircle, Loader2, MoreVertical, Plus, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletionsComputeToolStream, type ComputeStage } from '@/api/chat'
import { ApiError } from '@/api/client'
import AISettingsPanelBasic from '@/components/AISettingsPanelBasic'
import AISettingsPanelAdvanced from '@/components/AISettingsPanelAdvanced'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import { type ChartData } from '@/components/ChartModal'
import HelpModal from '@/components/HelpModal'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import SchemaManagerOverlay from '@/components/SchemaManagerOverlayV2'
import { createBiProject, deleteBiProject, getDuckdbStatus, importCsvToDuckdb, listBiProjects, updateBiProject, type BiProjectItem, type MessageStored } from '@/api/biProjects'
import { getBiSchema, listBiSchemas, type BiSchemaItem } from '@/api/biSchemas'
import { DETAIL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from '@/constants/aiOptions'
import type { Agent } from '@/types'

interface AgentBusinessUIProps {
  agent: Agent
}

interface BlockItem {
  id: string
  selectedSchemaId: string
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

/** 從 bi_schema 的 columns 取得允許的 CSV headers（field 名稱 + 所有 aliases） */
function getAllowedHeadersFromSchema(columns: Record<string, unknown> | null | undefined): Set<string> {
  const allowed = new Set<string>()
  if (!columns || typeof columns !== 'object') return allowed
  for (const [field, col] of Object.entries(columns)) {
    if (!col || typeof col !== 'object') continue
    const c = col as Record<string, unknown>
    allowed.add(field.trim())
    const aliases = c.aliases
    if (Array.isArray(aliases)) {
      for (const a of aliases) {
        if (typeof a === 'string' && a.trim()) allowed.add(a.trim())
      }
    } else if (typeof aliases === 'string' && aliases.trim()) {
      allowed.add(aliases.trim())
    }
  }
  return allowed
}

/** 檢查 CSV headers 是否都符合 schema（每個 header 需對應到 schema 的 field 或 alias，無欄序 fallback） */
function csvHeadersMatchSchema(csvHeaders: string[], allowedHeaders: Set<string>): boolean {
  if (allowedHeaders.size === 0) return false
  for (const h of csvHeaders) {
    const trimmed = h.trim()
    if (!trimmed) continue
    if (!allowedHeaders.has(trimmed)) return false
  }
  return true
}

const STORAGE_KEY_PREFIX = 'agent-business-ui'
const PROJECT_STORAGE_KEY_PREFIX = 'agent-business-project'
interface StoredState {
  userPrompt: string
  model: string
  role: string
  language: string
  detailLevel: string
  exampleQuestionsCount: string
  selectedTemplateId: number | null
}

function getProjectStorageKey(agentId: string) {
  return `${PROJECT_STORAGE_KEY_PREFIX}-${agentId}`
}

function getSettingsStorageKey(agentId: string, projectId?: string) {
  return projectId ? `${STORAGE_KEY_PREFIX}-${agentId}:${projectId}` : `${STORAGE_KEY_PREFIX}-${agentId}`
}

function loadStored(agentId: string, projectId?: string): Partial<StoredState> | null {
  try {
    const agentKey = getSettingsStorageKey(agentId)
    const fallback = (() => {
      const raw = localStorage.getItem(agentKey)
      if (!raw) return null
      const p = JSON.parse(raw) as Partial<StoredState & { messages?: Message[] }>
      const { messages: _m, ...rest } = p
      return rest
    })()
    if (!projectId) return fallback
    const projectKey = getSettingsStorageKey(agentId, projectId)
    const raw = localStorage.getItem(projectKey)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<StoredState & { messages?: Message[] }>
    const { messages: _m, ...rest } = parsed
    return { ...fallback, ...rest }
  } catch {
    return null
  }
}

function saveStored(agentId: string, state: StoredState, projectId?: string) {
  try {
    const key = getSettingsStorageKey(agentId, projectId)
    localStorage.setItem(key, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

/** 從 DB 的 conversation_data 轉成 Message[] */
function parseConversationData(data: unknown): Message[] {
  if (!Array.isArray(data)) return []
  return data.filter((m): m is Message => m && typeof m === 'object' && (m as Message).role && typeof (m as Message).content === 'string')
}

/** 將 chatCompletionsComputeTool 回傳的 chart_data 轉為 ChartModal 格式 */
function toChartData(cd: unknown): ChartData | undefined {
  if (!cd || typeof cd !== 'object' || !('labels' in (cd as object))) return undefined
  const c = cd as Record<string, unknown>
  const meta = {
    valueSuffix: c.valueSuffix as string | undefined,
    title: c.title as string | undefined,
    yAxisLabel: (c.yAxisLabel ?? c.y_axis_label ?? c.valueLabel) as string | undefined,
    // 只有後端明確設定時才傳入，讓 ChartModal 的 getDefaultChartType 自行判斷
    ...(c.chartType ? { chartType: c.chartType as 'pie' | 'bar' | 'line' } : {}),
  }
  if (Array.isArray(c.datasets) && c.datasets.length > 0) {
    return {
      labels: c.labels as string[],
      datasets: c.datasets as { label: string; data: number[] }[],
      ...meta,
    }
  }
  if (Array.isArray(c.data)) {
    return {
      labels: c.labels as string[],
      data: c.data as number[],
      ...meta,
    }
  }
  return undefined
}

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <Separator
      className={`flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${className}`}
    >
      <div
        className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80"
        aria-hidden
      />
    </Separator>
  )
}

function BlockCard({
  block,
  schemas,
  canDelete,
  onSchemaChange,
  onFilesChange,
  onRemoveFile,
  onClearFiles,
  onDelete,
  onValidationError,
  fileInputId,
  getSchemaValidationContext,
}: {
  block: BlockItem
  schemas: BiSchemaItem[]
  canDelete: boolean
  onSchemaChange: (id: string, value: string) => void
  onFilesChange: (id: string, files: File[]) => void
  onRemoveFile: (id: string, index: number) => void
  onClearFiles: (id: string) => void
  onDelete: (id: string) => void
  onValidationError: (message: string) => void
  fileInputId: string
  getSchemaValidationContext: (schemaId: string) => Promise<{
    allowedHeaders: Set<string>
    columnFieldNames: string[]
  }>
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files?.length) return
      const fileList = Array.from(files)

      const validFiles: File[] = []
      const invalidFiles: { file: File; reason: string }[] = []
      const duplicateFiles: File[] = []

      if (!block.selectedSchemaId.trim()) {
        for (const file of fileList) {
          invalidFiles.push({ file, reason: '請先選擇資料 Schema（bi_schemas）' })
        }
      } else {
        let validationCtx: { allowedHeaders: Set<string>; columnFieldNames: string[] } | null = null
        try {
          validationCtx = await getSchemaValidationContext(block.selectedSchemaId)
        } catch {
          for (const file of fileList) {
            invalidFiles.push({ file, reason: '無法取得 Schema 定義，請稍後再試' })
          }
        }

        if (validationCtx && validationCtx.columnFieldNames.length > 0) {
          const { allowedHeaders, columnFieldNames } = validationCtx
          for (const file of fileList) {
            if (block.selectedFiles.some((f) => isSameFile(file, f))) {
              duplicateFiles.push(file)
              continue
            }
            try {
              const csvHeaders = await parseCsvHeadersFromFile(file)
              if (csvHeaders.length === 0) {
                invalidFiles.push({ file, reason: '無法讀取 CSV 欄位' })
                continue
              }
              if (!csvHeadersMatchSchema(csvHeaders, allowedHeaders)) {
                const extra = csvHeaders.filter((h) => h.trim() && !allowedHeaders.has(h.trim()))
                invalidFiles.push({
                  file,
                  reason:
                    extra.length > 0
                      ? `格式不符：以下表頭須與 Schema 欄位名或 aliases 完全一致 — ${extra.join(', ')}`
                      : `格式不符：CSV 表頭與 Schema 不一致（共 ${csvHeaders.length} 欄，Schema 需 ${columnFieldNames.length} 個可辨識表頭）`,
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
        } else if (validationCtx?.columnFieldNames.length === 0) {
          for (const file of fileList) {
            invalidFiles.push({ file, reason: 'Schema 未定義 columns，無法驗證' })
          }
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
          invalidFiles.length > 1 ? `${names} 等 ${invalidFiles.length} 個檔案無法加入` : `${names}：${invalidFiles[0].reason}`
        )
      }
      if (messages.length > 0) {
        onValidationError(messages.join('；'))
      }

      setTimeout(() => {
        if (e.target) e.target.value = ''
      }, 0)
    },
    [block.id, block.selectedSchemaId, block.selectedFiles, getSchemaValidationContext, onFilesChange, onValidationError]
  )

  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-lg border-2 border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-200 bg-gray-100 px-4 py-3">
        <span className="text-lg font-medium text-gray-700">匯入資料</span>
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
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-2">
          <label className="text-lg font-medium text-gray-700" htmlFor={`block-schema-${block.id}`}>
            資料模型-Schema
          </label>
          <select
            id={`block-schema-${block.id}`}
            aria-label="從 bi_schemas 選擇一筆 schema"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            value={block.selectedSchemaId}
            onChange={(e) => onSchemaChange(block.id, e.target.value)}
          >
            <option value="">— 未選擇 —</option>
            {schemas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name?.trim() ? s.name : s.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={inputRef}
            id={fileInputId}
            type="file"
            accept=".csv,text/csv"
            multiple={true}
            aria-label="選擇 CSV 檔案（可多選）"
            className="hidden"
            onChange={handleFileChange}
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => block.selectedSchemaId && inputRef.current?.click()}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ' ') && block.selectedSchemaId) {
                e.preventDefault()
                inputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              if (block.selectedSchemaId) e.currentTarget.classList.add('border-blue-400', 'bg-blue-50/50')
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('border-blue-400', 'bg-blue-50/50')
              if (!block.selectedSchemaId || !e.dataTransfer.files?.length) return
              const input = inputRef.current
              if (input) {
                const dt = new DataTransfer()
                for (const file of e.dataTransfer.files) dt.items.add(file)
                input.files = dt.files
                input.dispatchEvent(new Event('change', { bubbles: true }))
              }
            }}
            className={`flex cursor-pointer flex-col gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 py-3 transition-colors ${
              block.selectedSchemaId
                ? 'hover:border-gray-300 hover:bg-gray-100'
                : 'cursor-not-allowed opacity-60'
            }`}
            title={
              !block.selectedSchemaId
                ? '請先選擇資料 Schema（bi_schemas）'
                : '點擊可一次選多個 CSV；或拖曳多個檔案至此'
            }
          >
            <div className="flex items-center justify-between px-3">
              <span className="text-lg text-gray-600">
                {block.selectedFiles.length > 0
                  ? `已選擇 ${block.selectedFiles.length} 個檔案`
                  : '點擊或拖曳 CSV 至此（可複選多個檔案）'}
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

export default function AgentBusinessUI({ agent }: AgentBusinessUIProps) {
  const aiPanelRef = useRef<PanelImperativeHandle>(null)
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<BiProjectItem | null>(null)
  const [projectPanelCollapsed, setProjectPanelCollapsed] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null)
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState<string | null>(null)
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectSubmitting, setNewProjectSubmitting] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)
  const [editProject, setEditProject] = useState<BiProjectItem | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const [editProjectDesc, setEditProjectDesc] = useState('')
  const [editProjectSubmitting, setEditProjectSubmitting] = useState(false)
  const [editProjectError, setEditProjectError] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [model, setModel] = useState(() => loadStored(agent.id)?.model ?? 'gpt-4o-mini')
  const [userPrompt, setUserPrompt] = useState(() => loadStored(agent.id)?.userPrompt ?? '')
  const [role, setRole] = useState(() => loadStored(agent.id)?.role ?? 'manager')
  const [language, setLanguage] = useState(() => loadStored(agent.id)?.language ?? 'zh-TW')
  const [detailLevel, setDetailLevel] = useState(() => loadStored(agent.id)?.detailLevel ?? 'brief')
  const [exampleQuestionsCount, setExampleQuestionsCount] = useState(
    () => loadStored(agent.id)?.exampleQuestionsCount ?? '0'
  )
  const [isLoading, setIsLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState<ComputeStage | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [importCsvLoading, setImportCsvLoading] = useState(false)
  const [importDrawerOpen, setImportDrawerOpen] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    () => loadStored(agent.id)?.selectedTemplateId ?? null
  )
  const nextBlockIdRef = useRef(0)
  const [blocks, setBlocks] = useState<BlockItem[]>(() => [
    { id: '0', selectedSchemaId: '', selectedFiles: [] },
  ])
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])
  const [csvAdapterToast, setCsvAdapterToast] = useState<string | null>(null)
  const [duckdbRowCount, setDuckdbRowCount] = useState<number | null>(null)
  const [schemaManagerOpen, setSchemaManagerOpen] = useState(false)

  const loadSchemas = useCallback(() => {
    listBiSchemas(agent.agent_id)
      .then(setSchemas)
      .catch(() => setSchemas([]))
  }, [agent.agent_id])

  // 切換專案時，用已儲存的 schema_id 預填 blocks
  useEffect(() => {
    setBlocks([{
      id: '0',
      selectedSchemaId: selectedProject?.schema_id?.trim() ?? '',
      selectedFiles: [],
    }])
    nextBlockIdRef.current = 0
  }, [selectedProject?.project_id])

  const getSchemaValidationContext = useCallback(
    async (schemaId: string): Promise<{ allowedHeaders: Set<string>; columnFieldNames: string[] }> => {
      const detail = await getBiSchema(schemaId)
      const columns = detail?.schema_json?.columns as Record<string, unknown> | undefined
      const columnFieldNames =
        columns && typeof columns === 'object' ? Object.keys(columns) : []
      return {
        allowedHeaders: getAllowedHeadersFromSchema(columns),
        columnFieldNames,
      }
    },
    []
  )

  /** 送出時必讀最新值，避免 stale closure */
  const latestRef = useRef({
    model,
    role,
    language,
    detailLevel,
    exampleQuestionsCount,
    userPrompt,
  })
  latestRef.current = {
    model,
    role,
    language,
    detailLevel,
    exampleQuestionsCount,
    userPrompt,
  }

  const setModelAndRef = (v: string) => {
    setModel(v)
    latestRef.current.model = v
  }
  const setRoleAndRef = (v: string) => {
    setRole(v)
    latestRef.current.role = v
  }
  const setLanguageAndRef = (v: string) => {
    setLanguage(v)
    latestRef.current.language = v
  }
  const setDetailLevelAndRef = (v: string) => {
    setDetailLevel(v)
    latestRef.current.detailLevel = v
  }
  const setExampleQuestionsCountAndRef = (v: string) => {
    setExampleQuestionsCount(v)
    latestRef.current.exampleQuestionsCount = v
  }
  const setUserPromptAndRef = (v: string) => {
    setUserPrompt(v)
    latestRef.current.userPrompt = v
  }

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(id)
  }, [toastMessage])

  useEffect(() => {
    if (!csvAdapterToast) return
    const id = setTimeout(() => setCsvAdapterToast(null), 5000)
    return () => clearTimeout(id)
  }, [csvAdapterToast])

  useEffect(() => {
    loadSchemas()
  }, [loadSchemas])

  const fetchDuckdbStatus = useCallback(() => {
    if (!selectedProject) {
      setDuckdbRowCount(null)
      return
    }
    getDuckdbStatus(agent.id, selectedProject.project_id)
      .then((res) => setDuckdbRowCount(res.row_count))
      .catch(() => setDuckdbRowCount(null))
  }, [agent.id, selectedProject?.project_id])

  useEffect(() => {
    fetchDuckdbStatus()
  }, [fetchDuckdbStatus])

  const updateBlockSchema = (id: string, value: string) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, selectedSchemaId: value, selectedFiles: [] } : b
      )
    )
    const pid = selectedProject?.project_id
    if (!pid) return
    const sid = value.trim()
    void updateBiProject(agent.id, pid, { schema_id: sid || null })
      .then((updated) => {
        setProjects((prev) =>
          prev.map((p) => (p.project_id === updated.project_id ? { ...p, schema_id: updated.schema_id } : p))
        )
        setSelectedProject((prev) =>
          prev?.project_id === updated.project_id ? { ...prev, schema_id: updated.schema_id } : prev
        )
      })
      .catch((err) => {
        const msg =
          err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '更新專案 Schema 失敗'
        setCsvAdapterToast(String(msg))
      })
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

  /** 專案選單：點擊畫面任何處即關閉 */
  useEffect(() => {
    if (!projectMenuOpen) return
    const handleClick = () => setProjectMenuOpen(null)
    const id = setTimeout(() => document.addEventListener('click', handleClick), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handleClick)
    }
  }, [projectMenuOpen])

  useEffect(() => {
    const stored = loadStored(agent.id)
    setModel(stored?.model ?? 'gpt-4o-mini')
    setUserPrompt(stored?.userPrompt ?? '')
    setRole(stored?.role ?? 'manager')
    setLanguage(stored?.language ?? 'zh-TW')
    setDetailLevel(stored?.detailLevel ?? 'brief')
    setExampleQuestionsCount(stored?.exampleQuestionsCount ?? '0')
    setSelectedTemplateId(stored?.selectedTemplateId ?? null)
  }, [agent.id])

  /** 切換專案時載入該專案的對話紀錄與 AI 設定 */
  useEffect(() => {
    if (selectedProject) {
      setMessages(parseConversationData(selectedProject.conversation_data))
      const stored = loadStored(agent.id, selectedProject.project_id)
      if (stored?.model != null) setModel(stored.model)
      if (stored?.userPrompt != null) setUserPrompt(stored.userPrompt)
      if (stored?.role != null) setRole(stored.role)
      if (stored?.language != null) setLanguage(stored.language)
      if (stored?.detailLevel != null) setDetailLevel(stored.detailLevel)
      if (stored?.exampleQuestionsCount != null) setExampleQuestionsCount(stored.exampleQuestionsCount)
      if (stored?.selectedTemplateId != null) setSelectedTemplateId(stored.selectedTemplateId)
    } else {
      setMessages([])
    }
  }, [agent.id, selectedProject?.project_id])

  useEffect(() => {
    setProjectsLoading(true)
    listBiProjects(agent.id)
      .then((list) => {
        setProjects(list)
        setSelectedProject((prev) => {
          if (list.length === 0) return null
          try {
            const saved = localStorage.getItem(getProjectStorageKey(agent.id))
            if (saved) {
              const found = list.find((p) => p.project_id === saved)
              if (found) return found
            }
          } catch {
            // 忽略
          }
          if (prev) {
            const match = list.find((p) => p.project_id === prev.project_id)
            if (match) return match
          }
          return list[0]
        })
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
  }, [agent.id])

  const prevAgentIdRef = useRef(agent.id)
  useEffect(() => {
    if (prevAgentIdRef.current !== agent.id) {
      prevAgentIdRef.current = agent.id
      return
    }
    saveStored(agent.id, {
      userPrompt,
      model,
      role,
      language,
      detailLevel,
      exampleQuestionsCount,
      selectedTemplateId,
    }, selectedProject?.project_id)
  }, [agent.id, userPrompt, model, role, language, detailLevel, exampleQuestionsCount, selectedTemplateId, selectedProject?.project_id])

  /** 依專案儲存對話紀錄至 DB（debounce 500ms） */
  useEffect(() => {
    if (!selectedProject) return
    const timer = setTimeout(() => {
      const payload: MessageStored[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.meta && { meta: m.meta }),
        ...(m.chartData != null && { chartData: m.chartData }),
      }))
      updateBiProject(agent.id, selectedProject.project_id, { conversation_data: payload })
        .then((updated) => {
          setProjects((prev) =>
            prev.map((p) =>
              p.project_id === selectedProject.project_id
                ? {
                    ...p,
                    conversation_data: updated.conversation_data,
                    schema_id: updated.schema_id ?? p.schema_id,
                  }
                : p
            )
          )
          setSelectedProject((prev) =>
            prev && prev.project_id === selectedProject.project_id
              ? {
                  ...prev,
                  conversation_data: updated.conversation_data,
                  schema_id: updated.schema_id ?? prev.schema_id,
                }
              : prev
          )
        })
        .catch(() => {})
    }, 500)
    return () => clearTimeout(timer)
  }, [agent.id, selectedProject?.project_id, messages])

  function buildUserPrompt(s: {
    role: string
    language: string
    detailLevel: string
    exampleQuestionsCount: string
    userPrompt: string
  }): string {
    const parts: string[] = []
    const roleOpt = ROLE_OPTIONS.find((o) => o.value === s.role)
    const langOpt = LANGUAGE_OPTIONS.find((o) => o.value === s.language)
    const detailOpt = DETAIL_OPTIONS.find((o) => o.value === s.detailLevel)
    if (roleOpt) parts.push(roleOpt.prompt)
    if (langOpt) parts.push(langOpt.prompt)
    if (detailOpt) parts.push(detailOpt.prompt)
    const n = parseInt(s.exampleQuestionsCount, 10)
    if (n > 0) {
      parts.push(`回覆結尾請提供 ${n} 個建議追問的問題，對營運管理有幫助的。`)
    }
    if (s.userPrompt.trim()) parts.push(s.userPrompt.trim())
    return parts.join(' ')
  }

  async function handleDeleteProject(projectId: string) {
    setDeleteProjectLoading(true)
    try {
      await deleteBiProject(agent.id, projectId)
      const wasSelected = selectedProject?.project_id === projectId
      try {
        localStorage.removeItem(getSettingsStorageKey(agent.id, projectId))
      } catch {
        // 忽略
      }
      if (wasSelected) {
        try {
          localStorage.removeItem(getProjectStorageKey(agent.id))
        } catch {
          // 忽略
        }
        setSelectedProject(null)
        setMessages([])
      }
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId))
    } catch {
      // 忽略錯誤
    } finally {
      setDeleteProjectLoading(false)
      setDeleteProjectConfirm(null)
      setProjectMenuOpen(null)
    }
  }

  async function handleImportCsv() {
    if (!selectedProject || importCsvLoading) return
    const blocksWithFiles = blocks.filter(
      (b) => b.selectedSchemaId.trim() && b.selectedFiles.length > 0
    )
    if (blocksWithFiles.length === 0) {
      setCsvAdapterToast('請先選擇資料 Schema（bi_schemas）並上傳至少一個 CSV 檔案')
      return
    }
    setImportCsvLoading(true)
    try {
      const payload = await Promise.all(
        blocksWithFiles.map(async (block) => {
          const files = await Promise.all(
            block.selectedFiles.map(async (file) => ({
              file_name: file.name,
              content: await file.text(),
            }))
          )
          return { schema_id: block.selectedSchemaId, files }
        })
      )
      const res = await importCsvToDuckdb(agent.id, selectedProject.project_id, payload)
      setToastMessage(res.message)
      if (res.ok && res.row_count != null) {
        setDuckdbRowCount(res.row_count)
      }
      if (res.ok && res.schema_id) {
        setProjects((prev) =>
          prev.map((p) =>
            p.project_id === selectedProject.project_id ? { ...p, schema_id: res.schema_id } : p
          )
        )
        setSelectedProject((prev) =>
          prev && prev.project_id === selectedProject.project_id
            ? { ...prev, schema_id: res.schema_id }
            : prev
        )
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '匯入失敗，請稍後再試'
      setCsvAdapterToast(msg)
    } finally {
      setImportCsvLoading(false)
    }
  }

  const handleOpenNewProject = () => {
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectError(null)
    setNewProjectOpen(true)
  }

  const handleCloseNewProject = () => {
    setNewProjectOpen(false)
    setNewProjectError(null)
  }

  const handleSubmitNewProject = async () => {
    const name = newProjectName.trim()
    if (!name) {
      setNewProjectError('請輸入專案名稱')
      return
    }
    setNewProjectSubmitting(true)
    setNewProjectError(null)
    try {
      const created = await createBiProject({
        agent_id: agent.id,
        project_name: name,
        project_desc: newProjectDesc.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedProject(created)
      try {
        localStorage.setItem(getProjectStorageKey(agent.id), created.project_id)
      } catch {
        // 忽略
      }
      handleCloseNewProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '建立失敗，請稍後再試'
      setNewProjectError(msg)
    } finally {
      setNewProjectSubmitting(false)
    }
  }

  const handleOpenEditProject = (p: BiProjectItem) => {
    setEditProject(p)
    setEditProjectName(p.project_name)
    setEditProjectDesc(p.project_desc ?? '')
    setEditProjectError(null)
    setProjectMenuOpen(null)
  }

  const handleCloseEditProject = () => {
    setEditProject(null)
    setEditProjectError(null)
  }

  const handleSubmitEditProject = async () => {
    const name = editProjectName.trim()
    if (!name) {
      setEditProjectError('請輸入專案名稱')
      return
    }
    if (!editProject) return
    setEditProjectSubmitting(true)
    setEditProjectError(null)
    try {
      const updated = await updateBiProject(agent.id, editProject.project_id, {
        project_name: name,
        project_desc: editProjectDesc.trim() || null,
      })
      setProjects((prev) =>
        prev.map((p) =>
          p.project_id === editProject.project_id
            ? {
                ...p,
                project_name: updated.project_name,
                project_desc: updated.project_desc,
                schema_id: updated.schema_id ?? p.schema_id,
              }
            : p
        )
      )
      if (selectedProject?.project_id === editProject.project_id) {
        setSelectedProject((prev) =>
          prev?.project_id === editProject.project_id
            ? {
                ...prev,
                project_name: updated.project_name,
                project_desc: updated.project_desc,
                schema_id: updated.schema_id ?? prev.schema_id,
              }
            : prev
        )
      }
      handleCloseEditProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '更新失敗，請稍後再試'
      setEditProjectError(msg)
    } finally {
      setEditProjectSubmitting(false)
    }
  }

  async function handleSendMessage(text: string) {
    if (!text || isLoading) return

    if (!selectedProject) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '請先選擇專案後再進行對話。左側專案區可選擇或建立專案。' },
      ])
      return
    }

    const sid = selectedProject.schema_id?.trim()
    if (!sid) {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        {
          role: 'assistant',
          content:
            '此專案尚未設定資料 schema。請在「匯入資料」區從 bi_schemas 選擇 Schema 並上傳 CSV 完成匯入後，再進行分析對話。',
        },
      ])
      return
    }

    const latest = latestRef.current
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)
    setLoadingStage('intent')

    try {
      const userPrompt = buildUserPrompt(latest)
      const res = await chatCompletionsComputeToolStream(
        {
          agent_id: agent.id,
          project_id: selectedProject.project_id,
          schema_id: sid,
          system_prompt: '',
          user_prompt: userPrompt || '',
          data: '',
          model: latest.model,
          messages: [],
          content: text,
        },
        (stage) => setLoadingStage(stage)
      )
      const meta: ResponseMeta | undefined =
        res.usage != null
          ? {
              model: res.model,
              usage: res.usage,
              finish_reason: null,
            }
          : undefined
      const chartData =
        res.chart_data && res.chart_data.labels && (res.chart_data.data || res.chart_data.datasets)
          ? toChartData(res.chart_data)
          : undefined
      const dbg = res.debug && typeof res.debug === 'object' ? (res.debug as Record<string, unknown>) : undefined
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: res.content,
          meta,
          chartData,
          ...(dbg && Object.keys(dbg).length > 0 ? { computeDebug: dbg } : {}),
        },
      ])
    } catch (err) {
      let msg = '未知錯誤'
      if (err instanceof ApiError) msg = err.detail ?? err.message
      else if (err instanceof Error) {
        msg = err.name === 'AbortError' ? '請求逾時，請檢查網路或稍後再試' : err.message
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: `錯誤：${msg}` }])
    } finally {
      setIsLoading(false)
      setLoadingStage(null)
    }
  }

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {toastMessage && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-[18px] text-white shadow-lg"
          role="status"
        >
          {toastMessage}
        </div>
      )}
      {csvAdapterToast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg bg-red-600 px-4 py-2 text-lg text-white shadow-lg"
          role="alert"
        >
          {csvAdapterToast}
        </div>
      )}

      <ConfirmModal
        open={showClearConfirm}
        title="確認清除"
        message="確定要清除所有對話嗎？"
        confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
        }}
        onCancel={() => setShowClearConfirm(false)}
      />
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-ai-settings.md"
      />
      <ConfirmModal
        open={deleteProjectConfirm !== null}
        title="刪除專案"
        message="確定要刪除此專案嗎？專案與相關資料將無法復原。"
        confirmText={deleteProjectLoading ? '處理中…' : '刪除'}
        variant="danger"
        onConfirm={() => {
          if (!deleteProjectLoading && deleteProjectConfirm) handleDeleteProject(deleteProjectConfirm)
        }}
        onCancel={() => !deleteProjectLoading && setDeleteProjectConfirm(null)}
      />
      <InputModal
        open={editProject !== null}
        title="修改專案"
        submitLabel="儲存"
        loading={editProjectSubmitting}
        onSubmit={handleSubmitEditProject}
        onClose={handleCloseEditProject}
      >
        {editProject && (
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
              <input
                type="text"
                value={editProjectName}
                onChange={(e) => setEditProjectName(e.target.value)}
                placeholder="請輸入專案名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
              <textarea
                value={editProjectDesc}
                onChange={(e) => setEditProjectDesc(e.target.value)}
                placeholder="請輸入專案描述（選填）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            {editProjectError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{editProjectError}</div>
            )}
          </div>
        )}
      </InputModal>
      <InputModal
        open={newProjectOpen}
        title="新增專案"
        submitLabel="建立"
        loading={newProjectSubmitting}
        onSubmit={handleSubmitNewProject}
        onClose={handleCloseNewProject}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="請輸入專案名稱"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
            <textarea
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              placeholder="請輸入專案描述（選填）"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
          {newProjectError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{newProjectError}</div>
          )}
        </div>
      </InputModal>
      <AgentHeader
        agent={agent}
        headerBackgroundColor="#1C3939"
        showSchemaManager
        onSchemaManagerOpen={() => setSchemaManagerOpen(true)}
      />
      {schemaManagerOpen && (
        <SchemaManagerOverlay
          agentId={agent.agent_id}
          agentName={agent.agent_name}
          onClose={() => setSchemaManagerOpen(false)}
          onSchemaChanged={loadSchemas}
        />
      )}

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* 左側：專案 sidebar（可折疊，與 AgentQuotationUI 一致） */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            projectPanelCollapsed ? 'w-12' : 'w-64'
          }`}
          style={{ backgroundColor: '#1C3939' }}
        >
          <div
            className={`flex shrink-0 items-center justify-between border-b border-gray-300/50 py-2.5 ${
              projectPanelCollapsed ? 'px-2' : 'pl-6 pr-3'
            }`}
          >
            {projectPanelCollapsed ? (
              <button
                type="button"
                onClick={() => setProjectPanelCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開專案"
                aria-label="展開專案"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <h3 className="text-base font-medium text-white">專案</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setProjectPanelCollapsed(true)}
                    className="rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                    title="折疊專案"
                    aria-label="折疊專案"
                  >
                    {'<<'}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenNewProject}
                    className="flex items-center gap-1 rounded-2xl border border-white/30 bg-white/10 px-2.5 py-1 text-base font-medium text-white transition-colors hover:bg-white/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>
              </>
            )}
          </div>
          {!projectPanelCollapsed && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {projectsLoading ? (
                <p className="text-base text-[#AE924C]/70">載入中…</p>
              ) : projects.length === 0 ? (
                <p className="text-base text-[#AE924C]/70">尚無專案，點擊 +New 建立</p>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => (
                    <li
                      key={p.project_id}
                      className={`relative flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-base transition-colors text-white ${
                        selectedProject?.project_id === p.project_id
                          ? 'bg-[#AE924C] font-medium'
                          : 'hover:bg-[#AE924C]/10'
                      }`}
                      onClick={() => {
                        setSelectedProject(p)
                        try {
                          localStorage.setItem(getProjectStorageKey(agent.id), p.project_id)
                        } catch {
                          // 忽略
                        }
                      }}
                    >
                      <span className="min-w-0 flex-1 truncate text-white">{p.project_name}</span>
                      {selectedProject?.project_id === p.project_id && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setProjectMenuOpen((prev) => (prev === p.project_id ? null : p.project_id))
                            }}
                            className="shrink-0 rounded-2xl p-1 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            aria-label="專案選單"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {projectMenuOpen === p.project_id && (
                        <div
                          className="absolute right-0 top-full z-10 mt-1 min-w-[7rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => handleOpenEditProject(p)}
                          >
                            修改
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => {
                              setProjectMenuOpen(null)
                              setDeleteProjectConfirm(p.project_id)
                            }}
                          >
                            刪除
                          </button>
                        </div>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 對話 + AI 設定 */}
        <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1">
        <Panel
          defaultSize={50}
          minSize="600px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            loadingStage={loadingStage}
            onCopySuccess={() => setToastMessage('已複製到剪貼簿')}
            onCopyError={() => setToastMessage('複製失敗')}
            headerActions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImportDrawerOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  aria-label="資料管理"
                >
                  <Database className="h-4 w-4 shrink-0" />
                  <span>
                    {selectedProject
                      ? duckdbRowCount !== null
                        ? duckdbRowCount > 0
                          ? `${duckdbRowCount.toLocaleString()} 筆`
                          : '尚無資料'
                        : '…'
                      : '資料管理'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                  disabled={isLoading || messages.length === 0}
                  className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  aria-label="清除對話"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </div>
            }
          />
        </Panel>
        <ResizeHandle />
        <Panel
          panelRef={aiPanelRef}
          collapsible
          collapsedSize="250px"
          defaultSize={25}
          minSize="250px"
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <div className="flex items-center gap-1">
              <span>AI 設定區</span>
              <button
                type="button"
                onClick={() => setShowHelpModal(true)}
                className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-200"
                aria-label="使用說明"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => aiPanelRef.current?.collapse()}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="折疊"
            >
              <ChevronsRight className="h-5 w-5" />
            </button>
          </header>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden border-b border-gray-200 bg-gray-50 px-4 py-3">
            <AISettingsPanelBasic
              model={model}
              onModelChange={setModelAndRef}
              role={role}
              onRoleChange={setRoleAndRef}
              language={language}
              onLanguageChange={setLanguageAndRef}
              detailLevel={detailLevel}
              onDetailLevelChange={setDetailLevelAndRef}
              exampleQuestionsCount={exampleQuestionsCount}
              onExampleQuestionsCountChange={setExampleQuestionsCountAndRef}
            />
            <div className="shrink-0 border-t border-gray-200" />
            <AISettingsPanelAdvanced
              agentId={agent.id}
              userPrompt={userPrompt}
              onUserPromptChange={setUserPromptAndRef}
              selectedTemplateId={selectedTemplateId}
              onSelectedTemplateIdChange={setSelectedTemplateId}
              onToast={setToastMessage}
            />
          </div>
        </Panel>
        </Group>
      </div>

      {/* 資料匯入抽屜 */}
      {importDrawerOpen && (
        <div className="fixed inset-0 z-40 flex">
          {/* 遮罩 */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setImportDrawerOpen(false)}
          />
          {/* 抽屜本體（靠左全高，右側大圓角） */}
          <div className="relative z-50 flex h-full w-80 flex-col overflow-hidden rounded-r-3xl bg-white shadow-2xl ring-1 ring-gray-200/60">
            {/* 抽屜 Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-gray-600" />
                <span className="text-base font-semibold text-gray-800">資料管理</span>
                {selectedProject && duckdbRowCount != null && duckdbRowCount > 0 && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {duckdbRowCount.toLocaleString()} 筆
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setImportDrawerOpen(false)}
                className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100"
                aria-label="關閉"
              >
                ✕
              </button>
            </div>
            {/* 抽屜內容 */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 text-lg">
              {blocks.map((block) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  schemas={schemas}
                  canDelete={blocks.length > 1}
                  onSchemaChange={updateBlockSchema}
                  onFilesChange={updateBlockFiles}
                  onRemoveFile={removeFileFromBlock}
                  onClearFiles={clearBlockFiles}
                  onDelete={removeBlock}
                  onValidationError={(msg) => setCsvAdapterToast(msg)}
                  fileInputId={`file-input-drawer-${block.id}`}
                  getSchemaValidationContext={getSchemaValidationContext}
                />
              ))}
              <button
                type="button"
                onClick={async () => {
                  await handleImportCsv()
                  setImportDrawerOpen(false)
                }}
                disabled={
                  importCsvLoading ||
                  !selectedProject ||
                  blocks.every((b) => !b.selectedSchemaId.trim() || b.selectedFiles.length === 0)
                }
                className="flex shrink-0 items-center justify-center rounded-lg bg-blue-600 py-4 text-lg text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importCsvLoading ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    匯入中…
                  </>
                ) : (
                  '匯入資料'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
