/** 測試頁：Compute Flow Tool（LLM 意圖萃取 → Backend 計算 → 文字生成）。路徑 /dev-test-compute-tool */

const SHOW_ANALYSIS = true
const SHOW_CHART = true
const SHOW_DEBUG = false

import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Copy, Loader2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { extractIntentOnly, computeFromIntent } from '@/api/chat'
import { ApiError } from '@/api/client'
import { listBiProjects } from '@/api/biProjects'
import { listBiSchemas, type BiSchemaItem } from '@/api/biSchemas'
import type { Agent } from '@/types'
import type { BiProjectItem } from '@/api/biProjects'

import ModelSelect from '@/components/ModelSelect'
import ChartModal from '@/components/ChartModal'
import type { ChartData } from '@/components/ChartModal'

const STORAGE_KEY_DUCKDB = 'bi_compute_duckdb_project_id'
/** 舊版「專案」下拉曾寫入，載入時若無 DuckDB 鍵則沿用 */
const STORAGE_KEY_PROJECT_LEGACY = 'bi_compute_project_id'
const STORAGE_KEY_SCHEMA = 'bi_compute_schema_id'
const STORAGE_KEY_PROMPT_WIDTH = 'bi_compute_prompt_width'

/** 固定使用 Business insight agent（不讀 DB）。agent_id 須與 agent_catalog.agent_id 一致 */
const BUSINESS_INSIGHT_AGENT: Agent = {
  id: 'business',
  agent_id: 'business',
  agent_name: 'Business Insight Agent',
  group_id: '',
  group_name: '',
}

interface ComputeResult {
  content: string
  chartData?: ChartData | null
  debug?: Record<string, unknown>
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
}

export default function TestComputeFlowTool() {
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [selectedDuckdbProjectId, setSelectedDuckdbProjectId] = useState<string>(() =>
    localStorage.getItem(STORAGE_KEY_DUCKDB) || ''
  )
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(() =>
    localStorage.getItem(STORAGE_KEY_SCHEMA) || ''
  )
  const [schemasLoading, setSchemasLoading] = useState(true)
  const [input, setInput] = useState('')
  const [model, setModel] = useState('gpt-4o-mini')
  const [isLoading, setIsLoading] = useState(false)
  const [intentResult, setIntentResult] = useState<{
    intent: Record<string, unknown>
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  } | null>(null)
  const [systemPrompt, setSystemPrompt] = useState<string>('')
  const [isComputing, setIsComputing] = useState(false)
  const [computeResult, setComputeResult] = useState<ComputeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chartModalOpen, setChartModalOpen] = useState(false)
  const [rightWidth, setRightWidth] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY_PROMPT_WIDTH)
    return saved ? Math.max(200, Math.min(800, parseInt(saved, 10) || 320)) : 320
  })
  const isDraggingRef = useRef(false)
  const startXRef = useRef(0)
  const startWidthRef = useRef(320)

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    startXRef.current = e.clientX
    startWidthRef.current = rightWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    let lastWidth = rightWidth
    const onMove = (ev: MouseEvent) => {
      const delta = startXRef.current - ev.clientX
      const newWidth = Math.max(200, Math.min(800, startWidthRef.current + delta))
      lastWidth = newWidth
      setRightWidth(newWidth)
    }
    const onUp = () => {
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      localStorage.setItem(STORAGE_KEY_PROMPT_WIDTH, String(lastWidth))
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    setProjectsLoading(true)
    setProjectsError(null)
    setProjects([])
    listBiProjects(BUSINESS_INSIGHT_AGENT.id)
      .then((list) => {
        setProjects(list)
        setProjectsError(null)
        const savedDuckdbId =
          localStorage.getItem(STORAGE_KEY_DUCKDB) || localStorage.getItem(STORAGE_KEY_PROJECT_LEGACY)
        if (savedDuckdbId && list.some((p) => p.project_id === savedDuckdbId)) {
          setSelectedDuckdbProjectId(savedDuckdbId)
        } else {
          setSelectedDuckdbProjectId('')
        }
      })
      .catch((err) => {
        const msg =
          err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '載入失敗'
        setProjectsError(msg)
        setProjects([])
      })
      .finally(() => setProjectsLoading(false))
  }, [])

  useEffect(() => {
    setSchemasLoading(true)
    listBiSchemas()
      .then((list) => setSchemas(list))
      .catch(() => setSchemas([]))
      .finally(() => setSchemasLoading(false))
  }, [])

  /** localStorage 可能留有已刪除列或誤存的 schema_json.id；若不在清單內則清除以免請求錯 id */
  useEffect(() => {
    if (schemasLoading) return
    if (!selectedSchemaId) return
    if (schemas.some((s) => s.id === selectedSchemaId)) return
    setSelectedSchemaId('')
    localStorage.removeItem(STORAGE_KEY_SCHEMA)
  }, [schemas, schemasLoading, selectedSchemaId])

  function toChartData(cd: NonNullable<ComputeResult['chartData']>): ChartData {
    if (!cd || typeof cd !== 'object' || !('labels' in cd)) return cd as ChartData
    const c = cd as Record<string, unknown>
    const meta = {
      valueSuffix: c.valueSuffix as string | undefined,
      title: c.title as string | undefined,
      /** 後端 compute_aggregate 回傳 valueLabel（如「銷售金額」「營收」），需對應到 yAxisLabel 才能在圖表顯示數值含義 */
      yAxisLabel: (c.yAxisLabel ?? c.y_axis_label ?? c.valueLabel) as string | undefined,
    }
    if (Array.isArray(c.datasets) && c.datasets.length > 0) {
      return {
        chartType: (c.chartType as 'pie' | 'bar' | 'line') ?? 'line',
        labels: c.labels as string[],
        datasets: c.datasets as { label: string; data: number[] }[],
        ...meta,
      }
    }
    if (Array.isArray(c.data)) {
      return {
        chartType: (c.chartType as 'pie' | 'bar' | 'line') ?? 'bar',
        labels: c.labels as string[],
        data: c.data as number[],
        ...meta,
      }
    }
    return cd as ChartData
  }

  async function handleSubmit() {
    if (!input.trim() || !selectedDuckdbProjectId || isLoading) return

    setError(null)
    setIntentResult(null)
    setComputeResult(null)
    setSystemPrompt('')
    setIsLoading(true)

    try {
      const res = await extractIntentOnly({
        agent_id: BUSINESS_INSIGHT_AGENT.id,
        project_id: selectedDuckdbProjectId,
        schema_id: selectedSchemaId || undefined,
        prompt_type: 'analysis',
        system_prompt: '',
        user_prompt: '',
        data: '',
        model,
        messages: [],
        content: input.trim(),
      })

      setSystemPrompt(res.system_prompt ?? '')
      if (res.error_message) {
        setError(res.error_message)
        return
      }
      if (!res.intent) {
        setError('意圖萃取失敗')
        return
      }
      setIntentResult({ intent: res.intent, usage: res.usage ?? null })
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '未知錯誤'
      setError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleCompute() {
    if (!input.trim() || !selectedDuckdbProjectId || !intentResult || isComputing) return

    setError(null)
    setComputeResult(null)
    setIsComputing(true)

    try {
      const res = await computeFromIntent({
        agent_id: BUSINESS_INSIGHT_AGENT.id,
        project_id: selectedDuckdbProjectId,
        schema_id: selectedSchemaId || undefined,
        content: input.trim(),
        intent: intentResult.intent,
        model,
      })

      const chartData: ChartData | null =
        res.chart_data && res.chart_data.labels && (res.chart_data.data || res.chart_data.datasets)
          ? toChartData(res.chart_data as Parameters<typeof toChartData>[0])
          : null

      setComputeResult({
        content: res.content,
        chartData,
        debug: res.debug,
        usage: res.usage,
      })
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '未知錯誤'
      setError(msg)
    } finally {
      setIsComputing(false)
    }
  }

  return (
    <div className="flex h-screen flex-col bg-stone-100">
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-300 bg-[#1C3939] px-6 py-4">
        <Link
          to="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-white/90 transition-colors hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
          返回
        </Link>
        <h1 className="text-xl font-semibold text-white">Compute Flow Tool 測試</h1>
        <span className="text-sm text-white/70">LLM 意圖萃取 → Backend 計算 → 文字生成</span>
        <div className="ml-auto flex gap-2">
          <Link
            to="/dev-test-intent-to-data"
            className="rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
          >
            Intent 測試
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6">
        {/* 左側：設定 */}
        <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-gray-300 bg-white p-4 shadow">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Agent</label>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-700">
              {BUSINESS_INSIGHT_AGENT.agent_name}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">DuckDB 選擇</label>
            <select
              value={selectedDuckdbProjectId}
              onChange={(e) => {
                const val = e.target.value
                setSelectedDuckdbProjectId(val)
                if (val) {
                  localStorage.setItem(STORAGE_KEY_DUCKDB, val)
                } else {
                  localStorage.removeItem(STORAGE_KEY_DUCKDB)
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-100 disabled:opacity-70"
              aria-label="選擇 DuckDB"
            >
              <option value="">請選擇</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_name}
                </option>
              ))}
            </select>
            {projectsLoading && <p className="mt-1 text-xs text-gray-500">載入中…</p>}
            {projectsError && (
              <p className="mt-1 text-xs text-red-600">
                {projectsError}
                {projectsError.includes('404') || projectsError.includes('Agent') ? (
                  <span className="block mt-1">請確認 agent_catalog 有對應 id 且 tenant/user 已授權。</span>
                ) : null}
              </p>
            )}
            {!projectsLoading && !projectsError && projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                此 Agent 尚無專案。
                <Link to={`/agent/${encodeURIComponent(BUSINESS_INSIGHT_AGENT.id)}`} className="ml-1 underline">
                  前往建立
                </Link>
              </p>
            )}
            <p className="mt-1 text-xs text-gray-500">
              意圖萃取與計算皆使用此專案對應的 DuckDB（project_id.duckdb）。
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Schema</label>
            <select
              value={selectedSchemaId}
              onChange={(e) => {
                const val = e.target.value
                setSelectedSchemaId(val)
                if (val) {
                  localStorage.setItem(STORAGE_KEY_SCHEMA, val)
                } else {
                  localStorage.removeItem(STORAGE_KEY_SCHEMA)
                }
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-100 disabled:opacity-70"
              aria-label="選擇 Schema"
            >
              <option value="">使用專案預設</option>
              {schemas.map((s) => (
                <option key={s.id} value={s.id}>
                  {(s.name || '').trim() || s.id}
                </option>
              ))}
            </select>
            {schemasLoading && <p className="mt-1 text-xs text-gray-500">載入中…</p>}
          </div>

          <ModelSelect value={model} onChange={setModel} />

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">問題</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="例如：各平台銷售額佔比"
              rows={3}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedDuckdbProjectId || !input.trim() || isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#1C3939] px-4 py-3 font-medium text-white transition-opacity hover:bg-[#2a4d4d] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                計算中…
              </>
            ) : (
              '送出'
            )}
          </button>
        </div>

        {/* 中間：結果 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</div>
          )}

          {intentResult && (
            <div className="space-y-6">
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-800">意圖 JSON</h2>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(intentResult.intent, null, 2))
                    }}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                    title="複製 JSON"
                  >
                    <Copy className="h-4 w-4" />
                    複製
                  </button>
                </div>
                <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-4 text-sm text-slate-800 font-mono whitespace-pre-wrap">
                  {JSON.stringify(intentResult.intent, null, 2)}
                </pre>
              </section>

              {intentResult.usage && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">Token 用量（意圖萃取）</h2>
                  <p className="text-sm text-gray-600">
                    input: {intentResult.usage.prompt_tokens} / output: {intentResult.usage.completion_tokens} / total:{' '}
                    {intentResult.usage.total_tokens}
                  </p>
                </section>
              )}

              <button
                type="button"
                onClick={handleCompute}
                disabled={isComputing}
                className="flex items-center justify-center gap-2 rounded-lg bg-[#1C3939] px-4 py-3 font-medium text-white transition-opacity hover:bg-[#2a4d4d] disabled:opacity-50"
              >
                {isComputing ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    計算中…
                  </>
                ) : (
                  '計算結果'
                )}
              </button>
            </div>
          )}

          {computeResult && (
            <div className="mt-6 space-y-6 border-t border-gray-200 pt-6">
              {computeResult.debug?.chart_result && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">compute_aggregate 結果</h2>
                  <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-slate-50 p-4 text-sm text-slate-800 font-mono whitespace-pre-wrap">
                    {JSON.stringify(computeResult.debug.chart_result, null, 2)}
                  </pre>
                </section>
              )}

              {SHOW_ANALYSIS && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">分析結果</h2>
                  <div className="prose max-w-none rounded-lg border border-gray-200 bg-gray-50/50 p-4">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{computeResult.content}</ReactMarkdown>
                  </div>
                </section>
              )}

              {SHOW_CHART && computeResult.chartData && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">圖表</h2>
                  <button
                    type="button"
                    onClick={() => setChartModalOpen(true)}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 hover:bg-gray-50"
                  >
                    開啟圖表
                  </button>
                  <ChartModal
                    open={chartModalOpen}
                    data={computeResult.chartData}
                    onClose={() => setChartModalOpen(false)}
                  />
                </section>
              )}

              {SHOW_DEBUG && computeResult.debug && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">Debug 資訊</h2>
                  <pre className="max-h-96 overflow-auto rounded-lg border border-gray-200 bg-gray-900 p-4 text-sm text-gray-100">
                    {JSON.stringify(computeResult.debug, null, 2)}
                  </pre>
                </section>
              )}

              {(computeResult.usage || computeResult.debug?.text_usage) && (
                <section>
                  <h2 className="mb-2 text-lg font-semibold text-gray-800">Token 用量（計算階段）</h2>
                  <div className="space-y-2 text-sm text-gray-600">
                    {computeResult.debug?.text_usage && (
                      <p>
                        <span className="font-medium text-gray-700">第 2 次 LLM（文字生成）</span> · input:{' '}
                        {computeResult.debug.text_usage.prompt_tokens} / output:{' '}
                        {computeResult.debug.text_usage.completion_tokens} / total:{' '}
                        {computeResult.debug.text_usage.total_tokens}
                      </p>
                    )}
                    {computeResult.usage && (
                      <p className="font-medium text-gray-800">
                        input: {computeResult.usage.prompt_tokens} / output: {computeResult.usage.completion_tokens}{' '}
                        / total: {computeResult.usage.total_tokens}
                      </p>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {!intentResult && !error && (
            <div className="flex flex-col items-center justify-center py-16 text-gray-500">
              <p className="mb-2">選擇 DuckDB 專案並輸入問題後送出</p>
              <p className="text-sm">送出後先產生意圖與 Token 用量，再按「計算結果」執行計算</p>
            </div>
          )}
        </div>

        {/* 把手 + 右側：可拖曳調整 System Prompt 寬度 */}
        <div className="flex shrink-0 items-stretch">
          <div
            role="separator"
            aria-orientation="vertical"
            aria-valuenow={rightWidth}
            tabIndex={0}
            onMouseDown={handleResizeStart}
            className="flex w-3 shrink-0 cursor-col-resize flex-col items-center justify-center bg-gray-200 hover:bg-gray-300 active:bg-gray-400"
            title="拖動調整寬度"
          >
            <div className="flex flex-col gap-1">
              <div className="h-1 w-0.5 rounded-full bg-gray-500" aria-hidden />
              <div className="h-1 w-0.5 rounded-full bg-gray-500" aria-hidden />
              <div className="h-1 w-0.5 rounded-full bg-gray-500" aria-hidden />
            </div>
          </div>

          {/* 右側：System Prompt */}
          <div
            className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300 bg-white shadow"
            style={{ width: rightWidth, minWidth: 200, maxWidth: 800 }}
          >
          <div className="flex h-full min-h-0 flex-col overflow-y-auto p-6">
            <h2 className="mb-2 shrink-0 text-lg font-semibold text-gray-800">System Prompt</h2>
            {systemPrompt ? (
              <pre className="min-h-0 flex-1 whitespace-pre-wrap rounded-lg border border-gray-200 bg-slate-50 p-3 text-xs font-mono text-slate-800">
                {systemPrompt}
              </pre>
            ) : (
              <p className="text-sm text-gray-500">送出後顯示意圖萃取的 system prompt</p>
            )}
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}
