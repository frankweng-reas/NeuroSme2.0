/** agent_id 含 business 時使用：商務型 agent 專用 UI */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronsLeft, ChevronsRight, HelpCircle, MoreVertical, Plus, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletions } from '@/api/chat'
import { ApiError } from '@/api/client'
import AISettingsPanelBasic from '@/components/AISettingsPanelBasic'
import AISettingsPanelAdvanced from '@/components/AISettingsPanelAdvanced'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import { type ChartData } from '@/components/ChartModal'
import HelpModal from '@/components/HelpModal'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import SourceListManager from '@/components/SourceListManager'
import { createBiSourceAdapter } from '@/adapters/biSourceAdapter'
import { createBiProject, deleteBiProject, listBiProjects, updateBiProject, type BiProjectItem, type MessageStored } from '@/api/biProjects'
import { DETAIL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from '@/constants/aiOptions'
import type { Agent } from '@/types'

interface AgentBusinessUIProps {
  agent: Agent
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

function pickStr(obj: Record<string, unknown> | null, ...keys: string[]): string | undefined {
  if (!obj) return undefined
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function normalizeChartData(v: unknown): ChartData | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const chartType = (['bar', 'pie', 'line'] as const).includes((o.type ?? o.chartType) as never)
    ? ((o.type ?? o.chartType) as 'bar' | 'pie' | 'line')
    : 'bar'

  const inner = o.data && typeof o.data === 'object' && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : null
  const title = pickStr(o, 'title') ?? pickStr(inner ?? {}, 'title')
  const yAxisLabel = pickStr(o, 'yAxisLabel') ?? pickStr(inner ?? {}, 'yAxisLabel')
  const valueSuffix = pickStr(o, 'valueSuffix') ?? pickStr(inner ?? {}, 'valueSuffix')

  const meta = { title, yAxisLabel, valueSuffix }

  // 新格式：{ type, data: { labels, values } } 或 { type, data: { labels, datasets } }
  if (inner && Array.isArray(inner.labels) && inner.labels.length > 0) {
    const labels = (inner.labels as unknown[]).map((x) => (typeof x === 'string' ? x : String(x)))
    if (chartType === 'pie' && Array.isArray(inner.values)) {
      if (inner.values.length === 0 || inner.values.length !== labels.length) return undefined
      const data = (inner.values as unknown[]).map((n) => (typeof n === 'number' ? n : Number(n) || 0))
      return { chartType: 'pie', labels, data, ...meta }
    }
    if ((chartType === 'bar' || chartType === 'line') && Array.isArray(inner.datasets) && inner.datasets.length > 0) {
      const datasets: { label: string; data: number[] }[] = []
      for (const d of inner.datasets as unknown[]) {
        if (!d || typeof d !== 'object') return undefined
        const item = d as Record<string, unknown>
        const label = typeof item.label === 'string' ? item.label : String(item.label ?? '')
        const arr = item.values ?? item.data
        if (!Array.isArray(arr)) return undefined
        const data = arr.map((n: unknown) => (typeof n === 'number' ? n : Number(n) || 0))
        datasets.push({ label, data })
      }
      return { chartType, labels, datasets, ...meta }
    }
  }

  // 舊格式：{ chartType, labels, data } 或 { chartType, labels, datasets }
  if (!Array.isArray(o.labels) || o.labels.length === 0) return undefined
  const labels = (o.labels as unknown[]).map((x) => (typeof x === 'string' ? x : String(x)))

  if (chartType === 'pie' || Array.isArray(o.data)) {
    const arr = (Array.isArray(o.data) ? o.data : inner?.values ?? o.values) as unknown[] | undefined
    if (!Array.isArray(arr) || arr.length === 0 || arr.length !== labels.length) return undefined
    const data = (arr as unknown[]).map((n) => (typeof n === 'number' ? n : Number(n) || 0))
    return { chartType: 'pie', labels, data, ...meta }
  }

  const dsArr = o.datasets ?? (inner?.datasets as unknown[])
  if (!Array.isArray(dsArr) || dsArr.length === 0) return undefined
  const datasets: { label: string; data: number[] }[] = []
  for (const d of dsArr as unknown[]) {
    if (!d || typeof d !== 'object') return undefined
    const item = d as Record<string, unknown>
    const label = typeof item.label === 'string' ? item.label : String(item.label ?? '')
    const arr = item.values ?? item.data
    if (!Array.isArray(arr)) return undefined
    const data = arr.map((n: unknown) => (typeof n === 'number' ? n : Number(n) || 0))
    datasets.push({ label, data })
  }
  return { chartType: chartType === 'line' ? 'line' : 'bar', labels, datasets, ...meta }
}

/**
 * 從 LLM 回覆中解析 JSON，回傳 { text, chartData }。
 * 支援：純 JSON、```json ... ``` 區塊、或前有說明文字後接 JSON 的混和格式。
 */
function parseJsonResponse(raw: string): { displayText: string; chartData?: ChartData } {
  try {
    let jsonStr = raw.trim()
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim()
    else {
      const braceStart = jsonStr.indexOf('{')
      if (braceStart >= 0) {
        let depth = 0
        let end = -1
        for (let i = braceStart; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') depth++
          else if (jsonStr[i] === '}') {
            depth--
            if (depth === 0) {
              end = i
              break
            }
          }
        }
        if (end >= 0) jsonStr = jsonStr.slice(braceStart, end + 1)
      }
    }
    const parsed = JSON.parse(jsonStr) as { text?: string; data?: unknown }
    const displayText = typeof parsed.text === 'string' ? parsed.text : raw
    const chartData = normalizeChartData(parsed.data)
    return { displayText, chartData }
  } catch {
    return { displayText: raw }
  }
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

export default function AgentBusinessUI({ agent }: AgentBusinessUIProps) {
  const sourcePanelRef = useRef<PanelImperativeHandle>(null)
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
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    () => loadStored(agent.id)?.selectedTemplateId ?? null
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
          if (prev && list.some((p) => p.project_id === prev.project_id)) return prev
          return list[0]
        })
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
  }, [agent.id])

  const biSourceAdapter = useMemo(
    () => (selectedProject ? createBiSourceAdapter(selectedProject.project_id) : null),
    [selectedProject?.project_id]
  )

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
            prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, conversation_data: updated.conversation_data } : p))
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
        prev.map((p) => (p.project_id === editProject.project_id ? { ...p, project_name: updated.project_name, project_desc: updated.project_desc } : p))
      )
      if (selectedProject?.project_id === editProject.project_id) {
        setSelectedProject((prev) => (prev?.project_id === editProject.project_id ? { ...prev, project_name: updated.project_name, project_desc: updated.project_desc } : prev))
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

    const latest = latestRef.current
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        project_id: selectedProject.project_id,
        system_prompt: '',
        user_prompt: buildUserPrompt(latest),
        data: '',
        model: latest.model,
        messages: [],
        content: text,
      })
      const meta: ResponseMeta | undefined =
        res.usage != null
          ? {
              model: res.model,
              usage: res.usage,
              finish_reason: res.finish_reason,
            }
          : undefined
      const { displayText, chartData } = parseJsonResponse(res.content)
      setMessages((prev) => [...prev, { role: 'assistant', content: displayText, meta, chartData }])
    } catch (err) {
      let msg = '未知錯誤'
      if (err instanceof ApiError) msg = err.detail ?? err.message
      else if (err instanceof Error) {
        msg = err.name === 'AbortError' ? '請求逾時，請檢查網路或稍後再試' : err.message
      }
      setMessages((prev) => [...prev, { role: 'assistant', content: `錯誤：${msg}` }])
    } finally {
      setIsLoading(false)
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
      <AgentHeader agent={agent} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* 左側：專案 sidebar（可折疊，與 AgentQuotationUI 一致） */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            projectPanelCollapsed ? 'w-12' : 'w-64'
          }`}
          style={{ backgroundColor: '#4b5563' }}
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
                <p className="text-base text-white/70">載入中…</p>
              ) : projects.length === 0 ? (
                <p className="text-base text-white/70">尚無專案，點擊 +New 建立</p>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => (
                    <li
                      key={p.project_id}
                      className={`group relative flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-base transition-colors ${
                        selectedProject?.project_id === p.project_id
                          ? 'bg-white/20 font-medium text-white'
                          : 'text-white/90 hover:bg-white/10'
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
                      <span className="min-w-0 flex-1 truncate">{p.project_name}</span>
                      {p.project_name && (
                        <span className="pointer-events-none absolute left-0 right-10 top-full z-[100] mt-1 hidden max-w-full whitespace-normal rounded-md bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg group-hover:block">
                          {p.project_name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setProjectMenuOpen((prev) => (prev === p.project_id ? null : p.project_id))
                        }}
                        className="shrink-0 rounded-2xl p-1 text-white/70 hover:bg-white/10 hover:text-white"
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
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* 右側：來源 + 對話 + AI 設定 */}
        <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1">
          <Panel
            panelRef={sourcePanelRef}
            collapsible
            collapsedSize="48px"
            defaultSize={25}
            minSize="48px"
            className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
          >
            {selectedProject && biSourceAdapter ? (
              <SourceListManager
                adapter={biSourceAdapter}
                title="來源"
                showHelp={true}
                helpUrl="/help-sourcefile.md"
                headerActions={
                  <button
                    type="button"
                    onClick={() => sourcePanelRef.current?.collapse()}
                    className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
                    aria-label="折疊"
                  >
                    <ChevronsLeft className="h-5 w-5" />
                  </button>
                }
              />
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-gray-500">
                <p className="text-base">請先選擇或建立專案</p>
                <p className="text-sm">左側專案區可建立新專案</p>
              </div>
            )}
          </Panel>
          <ResizeHandle />
        <Panel
          defaultSize={50}
          minSize="600px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            onCopySuccess={() => setToastMessage('已複製到剪貼簿')}
            onCopyError={() => setToastMessage('複製失敗')}
            headerActions={
              <button
                type="button"
                onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                disabled={isLoading || messages.length === 0}
                className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                aria-label="清除對話"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
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
    </div>
  )
}
