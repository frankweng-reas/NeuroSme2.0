/** 測試頁：Intent → compute_aggregate。路徑 /dev-test-intent-to-data。資料來自 DuckDB。 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { intentToComputeByProject } from '@/api/chat'
import { ApiError } from '@/api/client'
import { listBiProjects } from '@/api/biProjects'
import type { BiProjectItem } from '@/api/biProjects'

const STORAGE_KEY_PROJECT = 'bi_intent_to_data_project_id'
const DEFAULT_AGENT_ID = '22'

const DEFAULT_INTENT = `{
  "group_by_column": "channel_id",
  "value_column": "net_amount",
  "value_columns": null,
  "series_by_column": null,
  "filter_column": null,
  "filter_value": null,
  "aggregation": "sum",
  "time_grain": null,
  "top_n": null,
  "sort_order": "desc"
}`

export default function TestIntentToData() {
  const [projects, setProjects] = useState<BiProjectItem[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [projectsError, setProjectsError] = useState<string | null>(null)
  const [intentJson, setIntentJson] = useState(DEFAULT_INTENT)
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setProjectsLoading(true)
    setProjectsError(null)
    listBiProjects(DEFAULT_AGENT_ID)
      .then((list) => {
        setProjects(list)
        const savedId = localStorage.getItem(STORAGE_KEY_PROJECT)
        if (savedId && list.some((p) => p.project_id === savedId)) {
          setSelectedProjectId(savedId)
        } else {
          setSelectedProjectId(list[0]?.project_id ?? '')
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

  async function handleSubmit() {
    if (!selectedProjectId || isLoading) return

    let intent: Record<string, unknown>
    try {
      intent = JSON.parse(intentJson || '{}')
    } catch {
      setError('Intent 不是有效的 JSON')
      return
    }

    setError(null)
    setResult('')
    setIsLoading(true)

    try {
      const proj = projects.find((p) => p.project_id === selectedProjectId)
      const res = await intentToComputeByProject({
        project_id: selectedProjectId,
        intent,
        ...(proj?.schema_id ? { schema_id: proj.schema_id } : {}),
      })
      setResult(
        res.chart_result
          ? JSON.stringify(res.chart_result, null, 2)
          : res.error_detail
            ? `（無結果：chart_result 為 null）\n\n原因：${res.error_detail}`
            : '（無結果：chart_result 為 null）'
      )
      localStorage.setItem(STORAGE_KEY_PROJECT, selectedProjectId)
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '未知錯誤'
      setError(msg)
    } finally {
      setIsLoading(false)
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
        <h1 className="text-xl font-semibold text-white">Intent → compute_aggregate 測試</h1>
        <span className="text-sm text-white/70">專案 DuckDB 資料 · 貼上 intent JSON</span>
        <Link
          to="/dev-test-compute-tool"
          className="ml-auto rounded-lg border border-white/30 px-3 py-1.5 text-sm text-white/90 hover:bg-white/10"
        >
          Tool 路徑
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 gap-6 overflow-hidden p-6">
        {/* 左側：輸入 */}
        <div className="flex w-96 shrink-0 flex-col gap-4 overflow-y-auto rounded-xl border border-gray-300 bg-white p-4 shadow">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">專案</label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                const val = e.target.value
                setSelectedProjectId(val)
                if (val) localStorage.setItem(STORAGE_KEY_PROJECT, val)
              }}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base disabled:bg-gray-100 disabled:opacity-70"
              aria-label="選擇專案"
            >
              <option value="">請選擇</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_name}
                </option>
              ))}
            </select>
            {projectsLoading && <p className="mt-1 text-xs text-gray-500">載入中…</p>}
            {projectsError && <p className="mt-1 text-xs text-red-600">{projectsError}</p>}
            {!projectsLoading && !projectsError && projects.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">
                尚無專案，請先建立 BI 專案並同步 DuckDB。
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Intent JSON</label>
            <textarea
              value={intentJson}
              onChange={(e) => setIntentJson(e.target.value)}
              placeholder='{"group_by_column": "...", "value_column": "...", ...}'
              rows={14}
              className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedProjectId || isLoading}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#1C3939] px-4 py-3 font-medium text-white transition-opacity hover:bg-[#2a4d4d] disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                計算中…
              </>
            ) : (
              '發送'
            )}
          </button>
        </div>

        {/* 右側：結果 */}
        <div className="min-w-0 flex-1 overflow-y-auto rounded-xl border border-gray-300 bg-white p-6 shadow">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-red-700">{error}</div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">compute_aggregate 結果</label>
            <textarea
              value={result}
              readOnly
              placeholder="發送後將顯示 compute_aggregate 回傳的 chart_result"
              rows={24}
              className="w-full resize-none rounded-lg border border-gray-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
