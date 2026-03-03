/** agent_id 含 business 時使用：商務型 agent 專用 UI */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronsLeft, ChevronsRight, Copy, RefreshCw } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletions } from '@/api/chat'
import { ApiError } from '@/api/client'
import AgentIcon from '@/components/AgentIcon'
import ConfirmModal from '@/components/ConfirmModal'
import SourceFileManager from '@/components/SourceFileManager'
import type { Agent } from '@/types'

interface ResponseMeta {
  model: string
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  finish_reason: string | null
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  meta?: ResponseMeta
}

interface AgentBusinessUIProps {
  agent: Agent
}

const STORAGE_KEY_PREFIX = 'agent-business-ui'

interface StoredState {
  messages: Message[]
  userPrompt: string
  model: string
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

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gemini/gemini-2.0-flash', label: 'gemini-2.0-flash' },
  { value: 'gemini/gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { value: 'gemini/gemini-1.5-pro', label: 'gemini-1.5-pro' },
  { value: 'gemini/gemini-pro', label: 'gemini-pro' },
  { value: 'twcc/Llama3.1-FFM-8B-32K', label: '台智雲 Llama3.1-FFM-8B' },
] as const

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
  const [messages, setMessages] = useState<Message[]>(() => loadStored(agent.id)?.messages ?? [])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  useEffect(() => {
    if (!toastMessage) return
    const id = setTimeout(() => setToastMessage(null), 2000)
    return () => clearTimeout(id)
  }, [toastMessage])

  useEffect(() => {
    saveStored(agent.id, {
      messages,
      userPrompt,
      model,
    })
  }, [agent.id, messages, userPrompt, model])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        system_prompt: '',
        user_prompt: userPrompt,
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
      {/* Header 容器 - 與 Homepage header 同色 */}
      <header
        className="flex-shrink-0 rounded-2xl border-b border-gray-300/50 px-6 py-4 shadow-md"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />
            <h1 className="text-2xl font-bold text-white">{agent.agent_name}</h1>
          </div>
          <Link
            to="/"
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
          panelRef={sourcePanelRef}
          collapsible
          collapsedSize="200px"
          defaultSize={25}
          minSize="200px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <span>來源</span>
            <button
              type="button"
              onClick={() => sourcePanelRef.current?.collapse()}
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="折疊"
            >
              <ChevronsLeft className="h-5 w-5" />
            </button>
          </header>
          <SourceFileManager agentId={agent.id} />
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={50}
          minSize="600px"
          className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <span>對話</span>
            <button
              type="button"
              onClick={() => messages.length > 0 && setShowClearConfirm(true)}
              disabled={isLoading || messages.length === 0}
              className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              aria-label="清除對話"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
          </header>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <div className="mb-4 flex-1 overflow-y-auto rounded-xl border border-gray-200/80 bg-gray-50/60 ring-1 ring-gray-200/40 p-4">
              {messages.length === 0 ? (
                <p className="text-[18px] text-gray-400">輸入訊息開始對話...</p>
              ) : (
                <ul className="flex flex-col space-y-3">
                  {messages.map((m, i) => (
                    <li
                      key={i}
                      className={`flex flex-col rounded-lg px-3 py-2 shadow-sm ${
                        m.role === 'user'
                          ? 'ml-auto w-fit max-w-[85%] bg-blue-100 text-blue-900 ring-1 ring-blue-200/40'
                          : 'mr-8 bg-white text-gray-900 ring-1 ring-gray-200/50'
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-[18px]">{m.content}</p>
                      {m.role === 'assistant' && m.meta && (
                        <div className="mt-2 border-t border-gray-200 pt-2 text-[18px] text-gray-600">
                          model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                          {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                          {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                        </div>
                      )}
                      {m.role === 'assistant' && (
                        <div className="mt-2 flex items-center gap-2 border-t border-gray-200 pt-2">
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(m.content).then(
                                () => setToastMessage('已複製到剪貼簿'),
                                () => setToastMessage('複製失敗')
                              )
                            }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-[18px] text-gray-600 transition-colors hover:bg-gray-200"
                          >
                            <Copy className="h-4 w-4" />
                            複製
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isLoading && (
                <p className="mt-2 text-[18px] text-gray-500">助理思考中...</p>
              )}
            </div>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault()
                }}
                placeholder="輸入訊息..."
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded-lg px-4 py-2 text-[18px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: '#4b5563' }}
              >
                送出
              </button>
            </form>
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          panelRef={aiPanelRef}
          collapsible
          collapsedSize="200px"
          defaultSize={25}
          minSize="200px"
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <span>AI 設定區</span>
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
            <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-3 overflow-x-auto">
              <label className="shrink-0 text-[18px] font-medium text-gray-700">Model</label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="min-w-[140px] shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-[18px] text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <label className="shrink-0 text-[18px] font-medium text-gray-700">User Prompt</label>
              <div className="min-h-0 flex-1">
                <textarea
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  placeholder="輸入你對AI的要求，如輸出語言，格式，資料辭典...等等"
                  className="h-full min-h-[120px] w-full resize-y rounded-lg border border-gray-300 bg-white p-3 text-[18px] text-gray-800 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
