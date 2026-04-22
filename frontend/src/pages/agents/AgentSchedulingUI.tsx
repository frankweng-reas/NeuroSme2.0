/** agent_id 含 scheduling 時使用：排班型 agent 專用 UI */
import { useEffect, useRef, useState } from 'react'
import { Calendar, ChevronsLeft, ChevronsRight, HelpCircle, Loader2 } from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { solveSchedule, type ScheduleAssignment } from '@/api/scheduling'
import { ApiError } from '@/api/client'
import AgentHeader from '@/components/AgentHeader'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import SourceFileManager from '@/components/SourceFileManager'
import type { Agent } from '@/types'

interface AgentSchedulingUIProps {
  agent: Agent
}

const STORAGE_KEY_PREFIX = 'agent-scheduling-ui'
const EXAMPLE =
  '請幫我排下週 7 天的班表。有 5 個護理師（王小明、李小華、張美玲、陳大偉、林小芳），班別有早班、晚班、夜班。每天早班需要 2 人、晚班 1 人、夜班 1 人。每人每天最多 1 班。'

function loadStored(agentId: string): { model: string } | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}-${agentId}`)
    if (!raw) return null
    return JSON.parse(raw) as { model: string }
  } catch {
    return null
  }
}

function saveStored(agentId: string, state: { model: string }) {
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

function ScheduleTable({ assignments }: { assignments: ScheduleAssignment[] }) {
  if (assignments.length === 0) return null

  const days = [...new Set(assignments.map((a) => a.day))].sort((a, b) => a - b)
  const staffIds = [...new Set(assignments.map((a) => a.staff_id))]
  const staffNames = Object.fromEntries(
    staffIds.map((sid) => {
      const a = assignments.find((x) => x.staff_id === sid)
      return [sid, a?.staff_name ?? sid]
    })
  )

  const byStaffDay: Record<string, Record<number, string>> = {}
  for (const a of assignments) {
    if (!byStaffDay[a.staff_id]) byStaffDay[a.staff_id] = {}
    byStaffDay[a.staff_id][a.day] = a.shift_name
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full border-collapse text-[16px]">
        <thead>
          <tr className="bg-gray-100">
            <th className="border border-gray-200 px-3 py-2 text-left font-semibold">人員</th>
            {days.map((d) => (
              <th key={d} className="border border-gray-200 px-3 py-2 text-center font-semibold">
                第 {d + 1} 天
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {staffIds.map((sid) => (
            <tr key={sid} className="hover:bg-gray-50">
              <td className="border border-gray-200 px-3 py-2 font-medium">
                {staffNames[sid]}
              </td>
              {days.map((d) => (
                <td key={d} className="border border-gray-200 px-3 py-2 text-center">
                  {byStaffDay[sid]?.[d] ?? '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AgentSchedulingUI({ agent }: AgentSchedulingUIProps) {
  const sourcePanelRef = useRef<PanelImperativeHandle>(null)
  const [model, setModel] = useState(() => loadStored(agent.id)?.model ?? '')
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<{
    status: string
    assignments: ScheduleAssignment[]
    summary?: string
    error?: string
  } | null>(null)
  const [showHelpModal, setShowHelpModal] = useState(false)

  useEffect(() => {
    const stored = loadStored(agent.id)
    if (stored?.model) setModel(stored.model)
  }, [agent.id])

  useEffect(() => {
    saveStored(agent.id, { model })
  }, [agent.id, model])

  async function handleSolve() {
    const text = input.trim()
    if (!text || isLoading) return

    setIsLoading(true)
    setResult(null)

    try {
      const res = await solveSchedule({
        agent_id: agent.id,
        content: text,
        model,
      })
      setResult({
        status: res.status,
        assignments: res.assignments,
        summary: res.summary,
        error: res.error,
      })
    } catch (err) {
      let msg = '未知錯誤'
      if (err instanceof ApiError) msg = err.detail ?? err.message
      else if (err instanceof Error) {
        msg = err.name === 'AbortError' ? '請求逾時，請稍後再試' : err.message
      }
      setResult({
        status: 'ERROR',
        assignments: [],
        error: msg,
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-scheduling.md"
      />
      <AgentHeader agent={agent} />

      <Group orientation="horizontal" className="mt-4 flex min-h-0 flex-1 gap-1">
        <Panel
          panelRef={sourcePanelRef}
          collapsible
          collapsedSize="250px"
          defaultSize={20}
          minSize="200px"
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
          defaultSize={55}
          minSize="400px"
          className="flex flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
        >
          <div className="flex flex-1 flex-col overflow-hidden p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-800">
                <Calendar className="h-5 w-5" />
                排班需求
              </h2>
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLE}
              className="mb-3 min-h-[120px] w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-[16px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              disabled={isLoading}
              rows={4}
            />
            <div className="mb-4 flex flex-wrap items-start gap-3">
              <LLMModelSelect
                label="模型"
                value={model}
                onChange={setModel}
                disabled={isLoading}
                labelClassName="shrink-0 text-sm font-medium text-gray-700"
                selectClassName="rounded-lg border border-gray-300 px-3 py-1.5 text-[16px] focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={handleSolve}
                disabled={isLoading || !input.trim()}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    求解中...
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4" />
                    開始排班
                  </>
                )}
              </button>
            </div>

            {result && (
              <div className="min-h-0 flex-1 overflow-auto">
                <h3 className="mb-2 text-base font-semibold text-gray-800">排班結果</h3>
                {result.status === 'OPTIMAL' || result.status === 'FEASIBLE' ? (
                  <>
                    <p className="mb-2 text-sm text-gray-600">
                      狀態：{result.status === 'OPTIMAL' ? '最佳解' : '可行解'}
                    </p>
                    {result.summary && (
                      <pre className="mb-3 whitespace-pre-wrap rounded bg-gray-50 p-3 text-[14px] text-gray-700">
                        {result.summary}
                      </pre>
                    )}
                    <ScheduleTable assignments={result.assignments} />
                  </>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
                    <p className="font-medium">
                      {result.status === 'INFEASIBLE' ? '無可行解' : result.status}
                    </p>
                    <p className="mt-1 text-sm">{result.error}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          collapsible
          collapsedSize="200px"
          defaultSize={25}
          minSize="200px"
          className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-gray-50 ring-1 ring-gray-200/50"
        >
          <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
            <div className="flex items-center gap-1">
              <span>說明</span>
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
              className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="折疊"
            >
              <ChevronsRight className="h-5 w-5" />
            </button>
          </header>
          <div className="flex-1 overflow-auto p-4 text-[15px] text-gray-700">
            <p className="mb-2 font-medium">使用方式</p>
            <ul className="list-inside list-disc space-y-1 text-sm">
              <li>在左側輸入自然語言描述排班需求</li>
              <li>可上傳 CSV 作為參考（人員名單、班別等）</li>
              <li>LLM 會萃取參數，OR-Tools 求解班表</li>
              <li>範例：「5 個護理師，7 天，早班 2 人晚班 1 人夜班 1 人」</li>
            </ul>
          </div>
        </Panel>
      </Group>
    </div>
  )
}
