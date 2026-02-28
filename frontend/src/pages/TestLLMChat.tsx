/** 隱藏測試頁：LLM 聊天測試，僅可透過 /dev-test-chat 存取 */
import { useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, GripHorizontal, GripVertical, Trash2, Upload, X } from 'lucide-react'
import { chatCompletions } from '@/api/chat'
import { ApiError } from '@/api/client'

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

const MIN_PANEL_WIDTH = 200
const DEFAULT_LEFTMOST_WIDTH = 20
const DEFAULT_LEFT_WIDTH = 35
const DEFAULT_TOP_HEIGHT = 50
const DEFAULT_LEFTMOST_TOP_HEIGHT = 50
const STORAGE_KEY = 'dev-test-chat'

const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-4o', label: 'gpt-4o' },
] as const

interface StoredState {
  messages: Message[]
  systemPrompt: string
  userPrompt: string
  dataContent: string
  model: string
  includeHistory: boolean
  leftmostWidth: number
  leftmostTopHeight: number
  leftWidth: number
  topHeight: number
}

function loadStored(): Partial<StoredState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<StoredState>
  } catch {
    return null
  }
}

function saveStored(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
}

export default function TestLLMChat() {
  const [messages, setMessages] = useState<Message[]>(() => loadStored()?.messages ?? [])
  const [input, setInput] = useState('')
  const [systemPrompt, setSystemPrompt] = useState(() => loadStored()?.systemPrompt ?? '')
  const [userPrompt, setUserPrompt] = useState(() => loadStored()?.userPrompt ?? '')
  const [dataContent, setDataContent] = useState(() => loadStored()?.dataContent ?? '')
  const [model, setModel] = useState(() => loadStored()?.model ?? 'gpt-4o-mini')
  const [includeHistory, setIncludeHistory] = useState(
    () => loadStored()?.includeHistory ?? true
  )
  const [isLoading, setIsLoading] = useState(false)
  const [leftmostWidth, setLeftmostWidth] = useState(
    () => loadStored()?.leftmostWidth ?? DEFAULT_LEFTMOST_WIDTH
  )
  const [leftmostTopHeight, setLeftmostTopHeight] = useState(
    () => loadStored()?.leftmostTopHeight ?? DEFAULT_LEFTMOST_TOP_HEIGHT
  )
  const [leftWidth, setLeftWidth] = useState(() => loadStored()?.leftWidth ?? DEFAULT_LEFT_WIDTH)
  const [topHeight, setTopHeight] = useState(() => loadStored()?.topHeight ?? DEFAULT_TOP_HEIGHT)
  const [isResizing, setIsResizing] = useState(false)
  const [isResizingLeftmost, setIsResizingLeftmost] = useState(false)
  const [isResizingLeftmostVertical, setIsResizingLeftmostVertical] = useState(false)
  const [isResizingVertical, setIsResizingVertical] = useState(false)
  const [uploadedFileNames, setUploadedFileNames] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const leftmostPanelRef = useRef<HTMLDivElement>(null)
  const leftPanelRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleCsvUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    const filesArray = Array.from(files)
    const names = filesArray.map((f) => f.name)
    const readFile = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error)
        reader.readAsText(file, 'UTF-8')
      })
    Promise.all(filesArray.map(readFile)).then((texts) => {
      const newContent = texts.join('\n\n')
      setDataContent((prev) => (prev ? `${prev}\n\n${newContent}` : newContent))
      setUploadedFileNames((prev) => [...prev, ...names])
      e.target.value = ''
    })
  }

  function handleClearFiles() {
    setDataContent('')
    setUploadedFileNames([])
  }

  useEffect(() => {
    if (!isResizingLeftmost) return
    function onMove(e: MouseEvent) {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = Math.max(10, Math.min(50, (x / rect.width) * 100))
      setLeftmostWidth(pct)
    }
    function onUp() {
      setIsResizingLeftmost(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingLeftmost])

  useEffect(() => {
    if (!isResizingLeftmostVertical) return
    function onMove(e: MouseEvent) {
      const el = leftmostPanelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100))
      setLeftmostTopHeight(pct)
    }
    function onUp() {
      setIsResizingLeftmostVertical(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingLeftmostVertical])

  useEffect(() => {
    if (!isResizing) return
    function onMove(e: MouseEvent) {
      const el = containerRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const pct = (x / rect.width) * 100
      const middleEnd = Math.max(leftmostWidth + 20, Math.min(80, pct))
      setLeftWidth(middleEnd - leftmostWidth)
    }
    function onUp() {
      setIsResizing(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, leftmostWidth])

  useEffect(() => {
    if (!isResizingVertical) return
    function onMove(e: MouseEvent) {
      const el = leftPanelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const y = e.clientY - rect.top
      const pct = Math.max(20, Math.min(80, (y / rect.height) * 100))
      setTopHeight(pct)
    }
    function onUp() {
      setIsResizingVertical(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizingVertical])

  useEffect(() => {
    saveStored({
      messages,
      systemPrompt,
      userPrompt,
      dataContent,
      model,
      includeHistory,
      leftmostWidth,
      leftmostTopHeight,
      leftWidth,
      topHeight,
    })
  }, [messages, systemPrompt, userPrompt, dataContent, model, includeHistory, leftmostWidth, leftmostTopHeight, leftWidth, topHeight])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || isLoading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    try {
      const res = await chatCompletions({
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        data: dataContent,
        model,
        messages: includeHistory ? messages : [],
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
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `錯誤：${err instanceof ApiError ? (err.detail ?? err.message) : err instanceof Error ? err.message : '未知錯誤'}`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-gray-100">
      <header
        className="flex flex-shrink-0 items-center gap-4 border-b border-gray-200 bg-gray-800 px-4 py-3"
      >
        <Link
          to="/"
          className="flex items-center text-white/90 transition-colors hover:text-white"
          aria-label="返回"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold text-white">LLM Chat 測試</h1>
      </header>

      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* 最左側容器 */}
        <div
          ref={leftmostPanelRef}
          className="flex flex-col overflow-hidden border-r border-gray-200 bg-white"
          style={{ width: `${leftmostWidth}%`, minWidth: 120 }}
        >
          {/* Data */}
          <div
            className="flex min-h-0 flex-col overflow-hidden border-b border-gray-200"
            style={{ height: `${leftmostTopHeight}%` }}
          >
            <div className="flex-shrink-0 border-b border-sky-200 bg-sky-50 px-4 py-2">
              <h2 className="text-lg font-medium text-sky-800">Data</h2>
            </div>
            <textarea
              value={dataContent}
              onChange={(e) => setDataContent(e.target.value)}
              placeholder="貼上或輸入 data..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
          {/* 可拖曳調整高度的分隔條 */}
          <button
            type="button"
            onMouseDown={() => setIsResizingLeftmostVertical(true)}
            className="flex h-8 flex-shrink-0 cursor-row-resize items-center justify-center border-y border-gray-200 bg-gray-100 transition-colors hover:bg-gray-200"
            aria-label="調整最左高度"
          >
            <GripHorizontal className="h-4 w-4 text-gray-500" />
          </button>
          {/* Files */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2">
              <h2 className="text-lg font-medium text-amber-800">Files</h2>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                multiple
                onChange={handleCsvUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-lg text-gray-700 transition-colors hover:bg-gray-50"
              >
                <Upload className="h-5 w-5" />
                上傳 CSV
              </button>
              {uploadedFileNames.length > 0 && (
                <div className="flex flex-col gap-2">
                  {uploadedFileNames.map((name, i) => (
                    <div
                      key={`${name}-${i}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
                    >
                      <span className="truncate text-lg text-gray-700">{name}</span>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleClearFiles}
                    className="flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-lg text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <X className="h-4 w-4" />
                    移除全部
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 可拖曳調整寬度的分隔條（最左） */}
        <button
          type="button"
          onMouseDown={() => setIsResizingLeftmost(true)}
          className="flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-gray-200 transition-colors hover:bg-gray-300"
          aria-label="調整最左寬度"
        >
          <GripVertical className="h-5 w-5 text-gray-500" />
        </button>

        {/* 中間：System / User prompt */}
        <div
          ref={leftPanelRef}
          className="flex flex-col overflow-hidden border-r border-gray-200 bg-white"
          style={{ width: `${leftWidth}%`, minWidth: MIN_PANEL_WIDTH }}
        >
          {/* 上：System prompt */}
          <div
            className="flex min-h-0 flex-col overflow-hidden"
            style={{ height: `${topHeight}%` }}
          >
            <div className="flex-shrink-0 border-b border-violet-200 bg-violet-50 px-4 py-2">
              <h2 className="text-lg font-medium text-violet-800">System prompt</h2>
            </div>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="輸入 system prompt..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
          {/* 可拖曳調整高度的分隔條 */}
          <button
            type="button"
            onMouseDown={() => setIsResizingVertical(true)}
            className="flex h-8 flex-shrink-0 cursor-row-resize items-center justify-center border-y border-gray-200 bg-gray-100 transition-colors hover:bg-gray-200"
            aria-label="調整高度"
          >
            <GripHorizontal className="h-4 w-4 text-gray-500" />
          </button>
          {/* 下：User prompt */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex-shrink-0 border-b border-teal-200 bg-teal-50 px-4 py-2">
              <h2 className="text-lg font-medium text-teal-800">User prompt</h2>
            </div>
            <textarea
              value={userPrompt}
              onChange={(e) => setUserPrompt(e.target.value)}
              placeholder="輸入 user prompt..."
              className="min-h-0 flex-1 resize-none border-0 p-4 text-lg text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-0"
            />
          </div>
        </div>

        {/* 可拖曳調整寬度的分隔條 */}
        <button
          type="button"
          onMouseDown={() => setIsResizing(true)}
          className="flex w-3 flex-shrink-0 cursor-col-resize items-center justify-center bg-gray-200 transition-colors hover:bg-gray-300"
          aria-label="調整寬度"
        >
          <GripVertical className="h-5 w-5 text-gray-500" />
        </button>

        {/* 右側 Chatbot */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-gray-50">
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2">
              <h2 className="text-lg font-medium text-emerald-800">Model</h2>
              <select
                id="model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="rounded-lg border border-emerald-200 bg-white px-4 py-2 text-lg text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <label className="flex cursor-pointer items-center gap-2 text-lg text-emerald-800">
                <input
                  type="checkbox"
                  checked={includeHistory}
                  onChange={(e) => setIncludeHistory(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                />
                歷史對話
              </label>
              <button
                type="button"
                onClick={() => setMessages([])}
                disabled={isLoading || messages.length === 0}
                className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 py-2 text-lg text-emerald-800 transition-colors hover:bg-emerald-50 disabled:opacity-50 disabled:hover:bg-white"
              >
                <Trash2 className="h-5 w-5" />
                清除對話
              </button>
            </div>
            <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="mb-4 flex-1 overflow-y-auto rounded-lg border border-gray-200 bg-white p-4">
              {messages.length === 0 ? (
                <p className="text-lg text-gray-500">輸入訊息開始測試...</p>
              ) : (
                <ul className="space-y-3">
                  {messages.map((m, i) => (
                    <li
                      key={i}
                      className={`rounded-lg px-3 py-2 ${
                        m.role === 'user'
                          ? 'ml-8 bg-blue-100 text-blue-900'
                          : 'mr-8 bg-gray-100 text-gray-900'
                      }`}
                    >
                      <span className="text-lg font-medium opacity-70">
                        {m.role === 'user' ? '使用者' : '助理'}
                      </span>
                      <p className="mt-1 whitespace-pre-wrap text-lg">{m.content}</p>
                      {m.role === 'assistant' && m.meta && (
                        <div className="mt-2 border-t border-gray-200 pt-2 text-lg text-gray-600">
                          model: {m.meta.model} · prompt: {m.meta.usage.prompt_tokens} · completion:{' '}
                          {m.meta.usage.completion_tokens} · total: {m.meta.usage.total_tokens}
                          {m.meta.finish_reason && ` · finish: ${m.meta.finish_reason}`}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isLoading && (
                <p className="mt-2 text-lg text-gray-500">助理思考中...</p>
              )}
            </div>

            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="輸入訊息..."
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-lg focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-lg font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600"
              >
                送出
              </button>
            </form>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
