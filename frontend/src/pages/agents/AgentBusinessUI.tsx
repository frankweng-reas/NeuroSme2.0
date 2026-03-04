/** agent_id 含 business 時使用：商務型 agent 專用 UI */
import { useEffect, useRef, useState } from 'react'
import { ChevronsLeft, ChevronsRight, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletions } from '@/api/chat'
import { ApiError } from '@/api/client'
import AISettingsPanel from '@/components/AISettingsPanel'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
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
  const [messages, setMessages] = useState<Message[]>(() => loadStored(agent.id)?.messages ?? [])
  const [isLoading, setIsLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    () => loadStored(agent.id)?.selectedTemplateId ?? null
  )

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
      selectedTemplateId,
    })
  }, [agent.id, messages, userPrompt, model, role, language, detailLevel, selectedTemplateId])

  function buildUserPrompt(): string {
    const parts: string[] = []
    const roleOpt = ROLE_OPTIONS.find((o) => o.value === role)
    const langOpt = LANGUAGE_OPTIONS.find((o) => o.value === language)
    const detailOpt = DETAIL_OPTIONS.find((o) => o.value === detailLevel)
    if (roleOpt) parts.push(roleOpt.prompt)
    if (langOpt) parts.push(langOpt.prompt)
    if (detailOpt) parts.push(detailOpt.prompt)
    if (userPrompt.trim()) parts.push(userPrompt.trim())
    return parts.join(' ')
  }

  async function handleSendMessage(text: string) {
    if (!text || isLoading) return

    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        system_prompt: '',
        user_prompt: buildUserPrompt(),
        data: '',
        model,
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
      setMessages((prev) => [...prev, { role: 'assistant', content: res.content, meta }])
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
          <AISettingsPanel
            agentId={agent.id}
            model={model}
            onModelChange={setModel}
            role={role}
            onRoleChange={setRole}
            language={language}
            onLanguageChange={setLanguage}
            detailLevel={detailLevel}
            onDetailLevelChange={setDetailLevel}
            userPrompt={userPrompt}
            onUserPromptChange={setUserPrompt}
            selectedTemplateId={selectedTemplateId}
            onSelectedTemplateIdChange={setSelectedTemplateId}
            onToast={setToastMessage}
            headerActions={
              <button
                type="button"
                onClick={() => aiPanelRef.current?.collapse()}
                className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
                aria-label="折疊"
              >
                <ChevronsRight className="h-5 w-5" />
              </button>
            }
          />
        </Panel>
      </Group>
    </div>
  )
}
