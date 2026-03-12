/** agent_id 含 business 時使用：商務型 agent 專用 UI */
import { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, HelpCircle, RefreshCw } from 'lucide-react'
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
import SourceFileManager from '@/components/SourceFileManager'
import { DETAIL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from '@/constants/aiOptions'
import type { Agent } from '@/types'

interface AgentBusinessUIProps {
  agent: Agent
}

const STORAGE_KEY_PREFIX = 'agent-business-ui'

interface StoredState {
  messages: Message[]
  userPrompt: string
  model: string
  role: string
  language: string
  detailLevel: string
  exampleQuestionsCount: string
  selectedTemplateId: number | null
}

function loadStored(agentId: string): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${agentId}`)
    if (!raw) return null
    return JSON.parse(raw) as Partial<StoredState>
  } catch {
    return null
  }
}

function saveStored(agentId: string, state: StoredState) {
  try {
    localStorage.setItem(`${STORAGE_KEY_PREFIX}-${agentId}`, JSON.stringify(state))
  } catch {
    /* ignore */
  }
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
  const [model, setModel] = useState(() => loadStored(agent.id)?.model ?? 'gpt-4o-mini')
  const [userPrompt, setUserPrompt] = useState(() => loadStored(agent.id)?.userPrompt ?? '')
  const [role, setRole] = useState(() => loadStored(agent.id)?.role ?? 'manager')
  const [language, setLanguage] = useState(() => loadStored(agent.id)?.language ?? 'zh-TW')
  const [detailLevel, setDetailLevel] = useState(() => loadStored(agent.id)?.detailLevel ?? 'brief')
  const [exampleQuestionsCount, setExampleQuestionsCount] = useState(
    () => loadStored(agent.id)?.exampleQuestionsCount ?? '0'
  )
  const [messages, setMessages] = useState<Message[]>(() => loadStored(agent.id)?.messages ?? [])
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
    setMessages(stored?.messages ?? [])
    setSelectedTemplateId(stored?.selectedTemplateId ?? null)
  }, [agent.id])

  const prevAgentIdRef = useRef(agent.id)
  useEffect(() => {
    if (prevAgentIdRef.current !== agent.id) {
      prevAgentIdRef.current = agent.id
      return
    }
    saveStored(agent.id, {
      messages,
      userPrompt,
      model,
      role,
      language,
      detailLevel,
      exampleQuestionsCount,
      selectedTemplateId,
    })
  }, [agent.id, messages, userPrompt, model, role, language, detailLevel, exampleQuestionsCount, selectedTemplateId])

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

  async function handleSendMessage(text: string) {
    if (!text || isLoading) return

    const latest = latestRef.current
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        agent_id: agent.id,
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
      <AgentHeader agent={agent} />

      {/* 左、中、右三欄可拖曳調整大小的獨立容器 */}
      <Group orientation="horizontal" className="mt-4 flex min-h-0 flex-1 gap-1">
        <Panel
          panelRef={sourcePanelRef}
          collapsible
          collapsedSize="250px"
          defaultSize={25}
          minSize="250px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <SourceFileManager
            agentId={agent.id}
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
  )
}
