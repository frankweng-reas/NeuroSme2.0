/**
 * Admin：Agent 用量洞察
 * Tab A 健康狀態 | Tab B 用量趨勢 | Tab C Token 用量 | Tab D 使用者
 */
import { useCallback, useEffect, useState } from 'react'
import {
  getAgentInsightsHealth,
  getAgentInsightsDailyTrend,
  getAgentInsightsRanking,
  getAgentInsightsTokens,
  getAgentInsightsUsersOverview,
  getAgentInsightsUsersLeaderboard,
  getAgentInsightsUsersSearch,
  getAgentInsightsUserBreakdown,
  getAgentInsightsUserChatThreads,
  getAgentInsightsUserOcrHistory,
  type AgentHealthCard,
  type AgentHealthResponse,
  type AgentDailyTrendResponse,
  type AgentRankingResponse,
  type AgentTokenResponse,
  type UsersOverviewResponse,
  type UserLeaderboardRow,
  type UsersLeaderboardResponse,
  type UserBreakdownResponse,
  type UserChatThreadsResponse,
  type UserOcrHistoryResponse,
} from '@/api/agentInsights'
import { useToast } from '@/contexts/ToastContext'
import { formatIsoInTaipeiDateTime, taipeiTodayYmd, taipeiYmdMinusCalendarDays } from '@/utils/taipeiDate'
import { BarChart3 } from 'lucide-react'

// ── constants ────────────────────────────────────────────────────────────────

const AGENT_LABELS: Record<string, string> = {
  knowledge: 'Knowledge',
  cs: 'CS',
  business: 'BI',
  widget: 'Widget',
  writing: 'Writing',
  chat: 'Chat',
  ocr: 'OCR',
  speech: 'Speech',
  marketing: 'Marketing',
}

const AGENT_COLORS: Record<string, string> = {
  knowledge: '#6366f1',
  cs:        '#0ea5e9',
  business:  '#f59e0b',
  widget:    '#10b981',
  writing:   '#8b5cf6',
  chat:      '#3b82f6',
  ocr:       '#ef4444',
  speech:    '#ec4899',
  marketing: '#f97316',
}

function agentLabel(t: string) { return AGENT_LABELS[t] ?? t }
function agentColor(t: string) { return AGENT_COLORS[t] ?? '#6b7280' }

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtInt(n: number) { return n.toLocaleString('zh-TW') }
function fmtMs(ms: number | null) { return ms == null ? '—' : `${fmtInt(ms)} ms` }
function fmtPct(r: number) { return `${Math.round(r * 100)}%` }

function deltaLabel(d: number) {
  if (d === 0) return <span className="text-gray-400 text-xs">持平</span>
  const sign = d > 0 ? '+' : ''
  const cls = d > 0 ? 'text-green-600' : 'text-red-500'
  return <span className={`${cls} text-xs font-medium`}>{sign}{fmtInt(d)}</span>
}

// ── DateRange picker ─────────────────────────────────────────────────────────

function DateRangePicker({
  start, end,
  onStartChange, onEndChange,
  onApply, onPreset,
}: {
  start: string; end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onApply: () => void
  onPreset: (days: number) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div>
        <label className="block text-xs font-medium text-gray-600">起始日（台北）</label>
        <input type="date" value={start} onChange={e => onStartChange(e.target.value)}
          className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600">結束日（台北）</label>
        <input type="date" value={end} onChange={e => onEndChange(e.target.value)}
          className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm" />
      </div>
      <button onClick={onApply}
        className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800">
        套用
      </button>
      <div className="ml-auto flex flex-wrap gap-2">
        {[7, 30, 90].map(d => (
          <button key={d} onClick={() => onPreset(d)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100">
            近 {d} 天
          </button>
        ))}
      </div>
    </div>
  )
}

// ── inline bar (純 CSS) ───────────────────────────────────────────────────────

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab A — 健康狀態
// ─────────────────────────────────────────────────────────────────────────────

function TabHealth({ start, end }: { start: string; end: string }) {
  const { showToast } = useToast()
  const [data, setData] = useState<AgentHealthResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAgentInsightsHealth({ start, end })
      .then(setData)
      .catch(() => showToast('載入健康狀態失敗', 'error'))
      .finally(() => setLoading(false))
  }, [start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />
  if (!data) return null

  // sort: error first, then by total desc
  const sorted = [...data.cards].sort((a, b) => {
    if (a.success_rate !== b.success_rate) return a.success_rate - b.success_rate
    return b.total - a.total
  })

  return (
    <div className="space-y-6">
      {/* status cards */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Agent 狀態燈
          <span className="ml-2 font-normal text-gray-400 text-xs">
            ≥99% 綠 ・ ≥95% 黃 ・ &lt;95% 紅
          </span>
        </h3>
        <p className="mb-3 text-xs text-gray-400">典型回應時間（p50）= 把所有請求從快排到慢，正中間那筆的等待秒數，代表大多數使用者的實際感受</p>
        {sorted.length === 0
          ? <EmptyState text="本期無資料" />
          : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {sorted.map(c => <HealthCard key={c.agent_type} card={c} />)}
            </div>
          )}
      </section>

      {/* error log */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">近期錯誤紀錄
          <span className="ml-2 font-normal text-gray-400 text-xs">最近 50 筆失敗</span>
        </h3>
        {data.recent_errors.length === 0
          ? <EmptyState text="本期無錯誤，系統運行正常" positive />
          : (
            <div className="overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Agent</th>
                    <th className="px-4 py-2 text-left">Model</th>
                    <th className="px-4 py-2 text-right">延遲</th>
                    <th className="px-4 py-2 text-left">時間（台北）</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.recent_errors.map(e => (
                    <tr key={e.id} className="hover:bg-red-50">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full bg-red-400" />
                          <span className="font-medium">{agentLabel(e.agent_type)}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{e.model ?? '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">{fmtMs(e.latency_ms)}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{formatIsoInTaipeiDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}

function HealthCard({ card }: { card: AgentHealthCard }) {
  const isGreen = card.success_rate >= 0.99
  const isYellow = card.success_rate >= 0.95 && card.success_rate < 0.99

  const accentColor = isGreen ? '#22c55e' : isYellow ? '#f59e0b' : '#ef4444'
  const bgClass = isGreen
    ? 'bg-gradient-to-br from-green-50 to-white border-green-200'
    : isYellow
    ? 'bg-gradient-to-br from-yellow-50 to-white border-yellow-200'
    : 'bg-gradient-to-br from-red-50 to-white border-red-200'

  return (
    <div className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${bgClass}`}>
      {/* accent bar */}
      <div className="absolute left-0 top-0 h-full w-1 rounded-l-2xl" style={{ backgroundColor: accentColor }} />

      {/* header */}
      <div className="mb-4 flex items-center justify-between pl-2">
        <span className="flex items-center gap-2 text-sm font-semibold text-gray-600 uppercase tracking-wide">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accentColor }} />
          {agentLabel(card.agent_type)}
        </span>
        <span className="text-2xl font-bold tabular-nums tracking-tight" style={{ color: accentColor }}>
          {fmtPct(card.success_rate)}
        </span>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 pl-2">
        <div className="rounded-xl bg-white/70 px-3 py-2.5 text-center shadow-sm">
          <div className="text-2xl font-bold tabular-nums text-gray-800">{fmtInt(card.total)}</div>
          <div className="mt-0.5 text-xs font-medium text-gray-400 uppercase tracking-wider">請求</div>
        </div>
        <div className="rounded-xl bg-white/70 px-3 py-2.5 text-center shadow-sm">
          <div className={`text-2xl font-bold tabular-nums ${card.error > 0 ? 'text-red-500' : 'text-gray-800'}`}>
            {fmtInt(card.error)}
          </div>
          <div className="mt-0.5 text-xs font-medium text-gray-400 uppercase tracking-wider">錯誤</div>
        </div>
      </div>

      {/* latency footer */}
      <div className="mt-3 flex items-center justify-between rounded-xl bg-white/70 px-3 py-2 pl-4 shadow-sm">
        <span className="text-xs font-medium text-gray-400">典型回應時間</span>
        <span className="text-sm font-bold tabular-nums text-gray-700">{fmtMs(card.p50_latency_ms)}</span>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab B — 用量趨勢
// ─────────────────────────────────────────────────────────────────────────────

function TabUsage({ start, end }: { start: string; end: string }) {
  const { showToast } = useToast()
  const [trend, setTrend] = useState<AgentDailyTrendResponse | null>(null)
  const [ranking, setRanking] = useState<AgentRankingResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getAgentInsightsDailyTrend({ start, end }),
      getAgentInsightsRanking({ start, end }),
    ])
      .then(([t, r]) => { setTrend(t); setRanking(r) })
      .catch(() => showToast('載入用量趨勢失敗', 'error'))
      .finally(() => setLoading(false))
  }, [start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />
  if (!trend || !ranking) return null

  // pivot trend data: { day → { agent_type → count } }
  const allAgents = [...new Set(trend.rows.map(r => r.agent_type))].sort()
  const allDays = [...new Set(trend.rows.map(r => r.day))].sort()
  const pivot: Record<string, Record<string, number>> = {}
  for (const r of trend.rows) {
    if (!pivot[r.day]) pivot[r.day] = {}
    pivot[r.day][r.agent_type] = r.request_count
  }

  // latency pivot
  const latencyPivot: Record<string, Record<string, number | null>> = {}
  for (const r of trend.rows) {
    if (!latencyPivot[r.day]) latencyPivot[r.day] = {}
    latencyPivot[r.day][r.agent_type] = r.p50_latency_ms
  }

  const maxCount = Math.max(
    ...allDays.map(d => allAgents.reduce((s, a) => s + (pivot[d]?.[a] ?? 0), 0)),
    1,
  )

  return (
    <div className="space-y-8">
      {/* daily stacked bar */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">每日請求量</h3>
        <p className="mb-3 text-xs text-gray-400">各 agent 堆疊，可觀察增長或突降</p>
        {allDays.length === 0
          ? <EmptyState text="本期無資料" />
          : (
            <>
              <div className="space-y-1.5">
                {allDays.map(day => {
                  const total = allAgents.reduce((s, a) => s + (pivot[day]?.[a] ?? 0), 0)
                  return (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 text-right text-xs text-gray-500">{day.slice(5)}</span>
                      <div className="relative h-5 flex-1 overflow-hidden rounded bg-gray-100">
                        {(() => {
                          let offset = 0
                          return allAgents.map(a => {
                            const v = pivot[day]?.[a] ?? 0
                            const pct = maxCount > 0 ? (v / maxCount) * 100 : 0
                            const el = (
                              <div
                                key={a}
                                className="absolute h-full transition-all"
                                title={`${agentLabel(a)}: ${v}`}
                                style={{ left: `${offset}%`, width: `${pct}%`, backgroundColor: agentColor(a) }}
                              />
                            )
                            offset += pct
                            return el
                          })
                        })()}
                      </div>
                      <span className="w-10 text-right text-xs tabular-nums text-gray-600">{fmtInt(total)}</span>
                    </div>
                  )
                })}
              </div>
              {/* legend */}
              <div className="mt-3 flex flex-wrap gap-3">
                {allAgents.map(a => (
                  <span key={a} className="flex items-center gap-1 text-xs text-gray-600">
                    <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: agentColor(a) }} />
                    {agentLabel(a)}
                  </span>
                ))}
              </div>
            </>
          )}
      </section>

      {/* ranking */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">Agent 請求排行
          <span className="ml-2 font-normal text-gray-400 text-xs">
            本期 vs 上一等長期間（{ranking.previous_start} ~ {ranking.previous_end}）
          </span>
        </h3>
        {ranking.rows.length === 0
          ? <EmptyState text="本期無資料" />
          : (
            <div className="space-y-2">
              {ranking.rows.map(r => {
                const maxVal = Math.max(...ranking.rows.map(x => x.current), 1)
                return (
                  <div key={r.agent_type} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-sm font-medium text-gray-700">{agentLabel(r.agent_type)}</span>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Bar value={r.current} max={maxVal} color={agentColor(r.agent_type)} />
                        <span className="w-14 text-right text-sm tabular-nums text-gray-700">{fmtInt(r.current)}</span>
                        {deltaLabel(r.delta)}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
      </section>

      {/* latency trend */}
      <section>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">每日 p50 延遲趨勢
          <span className="ml-2 font-normal text-gray-400 text-xs">數值越高代表當天回應越慢</span>
        </h3>
        {allDays.length === 0
          ? <EmptyState text="本期無資料" />
          : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr>
                    <th className="py-1 pr-3 text-left text-gray-500">日期</th>
                    {allAgents.map(a => (
                      <th key={a} className="px-2 py-1 text-center text-gray-500"
                        style={{ color: agentColor(a) }}>
                        {agentLabel(a)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allDays.map(day => (
                    <tr key={day} className="hover:bg-gray-50">
                      <td className="py-1 pr-3 text-gray-500">{day.slice(5)}</td>
                      {allAgents.map(a => {
                        const ms = latencyPivot[day]?.[a] ?? null
                        return (
                          <td key={a} className="px-2 py-1 text-center tabular-nums text-gray-700">
                            {ms == null ? <span className="text-gray-300">—</span> : fmtMs(ms)}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab C — Token 用量
// ─────────────────────────────────────────────────────────────────────────────

function TabTokens({ start, end }: { start: string; end: string }) {
  const { showToast } = useToast()
  const [data, setData] = useState<AgentTokenResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [anonymize, setAnonymize] = useState(false)

  useEffect(() => {
    setLoading(true)
    getAgentInsightsTokens({ start, end })
      .then(setData)
      .catch(() => showToast('載入 Token 用量失敗', 'error'))
      .finally(() => setLoading(false))
  }, [start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <Spinner />
  if (!data) return null

  const llmRows = data.by_agent.filter(r => !r.is_embedding)
  const embedRows = data.by_agent.filter(r => r.is_embedding)
  const totalLlm = llmRows.reduce((s, r) => s + r.total_tokens, 0)
  const totalEmbed = embedRows.reduce((s, r) => s + r.total_tokens, 0)
  const totalAll = totalLlm + totalEmbed

  const maxAgentTokens = Math.max(...data.by_agent.map(r => r.total_tokens), 1)
  const maxUserTokens = Math.max(...data.top_users.map(r => r.total_tokens), 1)

  return (
    <div className="space-y-8">
      {/* LLM vs Embedding summary */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">LLM vs Embedding 分拆
          <span className="ml-2 font-normal text-gray-400 text-xs">Embedding 便宜，LLM 才是費用主體</span>
        </h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="LLM Tokens" value={fmtInt(totalLlm)}
            sub={totalAll > 0 ? `佔 ${fmtPct(totalLlm / totalAll)}` : '—'} accent="blue" />
          <StatCard label="Embedding Tokens" value={fmtInt(totalEmbed)}
            sub={totalAll > 0 ? `佔 ${fmtPct(totalEmbed / totalAll)}` : '—'} accent="gray" />
          <StatCard label="合計 Tokens" value={fmtInt(totalAll)} sub="本期成功請求" accent="indigo" />
        </div>
        {totalAll > 0 && (
          <div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full rounded-l-full bg-blue-500 transition-all"
              style={{ width: `${(totalLlm / totalAll) * 100}%` }} />
          </div>
        )}
      </section>

      {/* per-agent token bar */}
      <section>
        <h3 className="mb-3 text-sm font-semibold text-gray-700">各 Agent Token 用量</h3>
        {data.by_agent.length === 0
          ? <EmptyState text="本期無 token 紀錄" />
          : (
            <div className="space-y-3">
              {[...data.by_agent]
                .sort((a, b) => b.total_tokens - a.total_tokens)
                .map(r => (
                  <div key={`${r.agent_type}-${r.is_embedding}`}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="w-28 text-sm font-medium text-gray-700">
                        {agentLabel(r.agent_type)}
                        <span className="ml-1 text-xs text-gray-400">{r.is_embedding ? '[embed]' : '[llm]'}</span>
                      </span>
                      <span className="text-xs tabular-nums text-gray-500">{fmtInt(r.total_tokens)} tokens</span>
                    </div>
                    <div className="flex h-4 overflow-hidden rounded-full bg-gray-100">
                      {r.total_tokens > 0 && (
                        <>
                          <div
                            className="h-full transition-all"
                            title={`prompt: ${fmtInt(r.prompt_tokens)}`}
                            style={{
                              width: `${(r.prompt_tokens / maxAgentTokens) * 100}%`,
                              backgroundColor: r.is_embedding ? '#94a3b8' : agentColor(r.agent_type),
                              opacity: 0.85,
                            }}
                          />
                          <div
                            className="h-full transition-all"
                            title={`completion: ${fmtInt(r.completion_tokens)}`}
                            style={{
                              width: `${(r.completion_tokens / maxAgentTokens) * 100}%`,
                              backgroundColor: r.is_embedding ? '#94a3b8' : agentColor(r.agent_type),
                              opacity: 0.4,
                            }}
                          />
                        </>
                      )}
                    </div>
                    <div className="mt-0.5 flex gap-4 text-xs text-gray-400">
                      <span>prompt {fmtInt(r.prompt_tokens)}</span>
                      {!r.is_embedding && <span>completion {fmtInt(r.completion_tokens)}</span>}
                    </div>
                  </div>
                ))}
              <div className="flex gap-4 pt-1 text-xs text-gray-400">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-blue-400 opacity-85" />深色 = prompt
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-3 w-3 rounded-sm bg-blue-400 opacity-40" />淺色 = completion
                </span>
              </div>
            </div>
          )}
      </section>

      {/* top users */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">用量最多的使用者（Top 10）
            <span className="ml-2 font-normal text-gray-400 text-xs">找出重度使用者，評估是否需限流</span>
          </h3>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
            <input type="checkbox" checked={anonymize} onChange={e => setAnonymize(e.target.checked)}
              className="accent-gray-600" />
            匿名顯示
          </label>
        </div>
        {data.top_users.length === 0
          ? <EmptyState text="本期無使用者 token 紀錄" />
          : (
            <div className="space-y-2">
              {data.top_users.map((u, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 text-right text-xs text-gray-400">{i + 1}</span>
                  <span className="w-24 truncate text-sm text-gray-700">
                    {anonymize ? `用戶 ${String(u.user_id ?? '?').slice(-4)}` : (u.user_id == null ? '匿名' : `#${u.user_id}`)}
                  </span>
                  <div className="flex-1">
                    <Bar value={u.total_tokens} max={maxUserTokens} color="#6366f1" />
                  </div>
                  <span className="w-24 text-right text-sm tabular-nums text-gray-600">{fmtInt(u.total_tokens)}</span>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  )
}

// ── shared small components ──────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent: 'blue' | 'gray' | 'indigo'
}) {
  const colors = {
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    gray: 'border-gray-200 bg-gray-50 text-gray-600',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  }
  return (
    <div className={`rounded-lg border p-4 ${colors[accent]}`}>
      <div className="text-xs font-medium opacity-70">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs opacity-60">{sub}</div>}
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-600" />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab D — 使用者
// ─────────────────────────────────────────────────────────────────────────────

const DRILL_DOWN_AGENTS: Record<string, string> = {
  chat: 'chat-threads',
  ocr: 'ocr-history',
}

function UserAgentBadges({ agents }: { agents: UsersLeaderboardResponse['rows'][0]['agents'] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {agents.map(a => (
        <span
          key={a.agent_type}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
          style={{ backgroundColor: agentColor(a.agent_type) }}
          title={`${agentLabel(a.agent_type)}: ${fmtInt(a.total_tokens)} tokens`}
        >
          {agentLabel(a.agent_type)}
        </span>
      ))}
    </div>
  )
}

function UserOverviewCards({ data }: { data: UsersOverviewResponse }) {
  const cards = [
    {
      label: '活躍使用者',
      value: fmtInt(data.active_users),
      sub: '區間內有請求',
      color: 'text-blue-700',
    },
    {
      label: '人均 tokens',
      value: data.avg_tokens_per_user != null ? fmtInt(data.avg_tokens_per_user) : '—',
      sub: '活躍者平均',
      color: 'text-gray-800',
    },
    {
      label: '多 Agent 用戶',
      value: fmtInt(data.multi_agent_users),
      sub: `≥2 種 Agent（佔 ${data.active_users > 0 ? Math.round((data.multi_agent_users / data.active_users) * 100) : 0}%）`,
      color: 'text-indigo-700',
    },
    {
      label: '需關注',
      value: fmtInt(data.high_error_users),
      sub: '錯誤率 >20%',
      color: data.high_error_users > 0 ? 'text-red-600' : 'text-green-600',
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(c => (
        <div key={c.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-gray-500">{c.label}</div>
          <div className={`mt-1 text-2xl font-bold tabular-nums ${c.color}`}>{c.value}</div>
          <div className="mt-0.5 text-xs text-gray-400">{c.sub}</div>
        </div>
      ))}
    </div>
  )
}

function UserDrillDown({
  row,
  start,
  end,
  anonymize,
}: {
  row: UserLeaderboardRow
  start: string
  end: string
  anonymize: boolean
}) {
  const { showToast } = useToast()
  const [breakdown, setBreakdown] = useState<UserBreakdownResponse | null>(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [activeDetail, setActiveDetail] = useState<'chat' | 'ocr' | null>(null)
  const [chatThreads, setChatThreads] = useState<UserChatThreadsResponse | null>(null)
  const [ocrHistory, setOcrHistory] = useState<UserOcrHistoryResponse | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setBreakdownLoading(true)
    getAgentInsightsUserBreakdown(row.user_id, { start, end, anonymize })
      .then(setBreakdown)
      .catch(() => showToast('載入 Agent 明細失敗', 'error'))
      .finally(() => setBreakdownLoading(false))
  }, [row.user_id, start, end, anonymize]) // eslint-disable-line react-hooks/exhaustive-deps

  const loadDetail = (type: 'chat' | 'ocr') => {
    if (activeDetail === type) { setActiveDetail(null); return }
    setActiveDetail(type)
    setDetailLoading(true)
    const p = { start, end, anonymize }
    const req =
      type === 'chat'
        ? getAgentInsightsUserChatThreads(row.user_id, p).then(d => { setChatThreads(d) })
        : getAgentInsightsUserOcrHistory(row.user_id, p).then(d => { setOcrHistory(d) })
    req
      .catch(() => showToast('載入詳情失敗', 'error'))
      .finally(() => setDetailLoading(false))
  }

  return (
    <div className="space-y-4 p-4 bg-gray-50 rounded-b-lg border-t border-gray-100">
      {/* Level 1: per-agent breakdown */}
      {breakdownLoading && <p className="text-sm text-gray-400">載入明細…</p>}
      {breakdown && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">各 Agent 用量</h4>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-right">請求</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">錯誤率</th>
                  <th className="px-3 py-2 text-left">最後使用</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {breakdown.agents.map(a => (
                  <tr key={a.agent_type} className="hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: agentColor(a.agent_type) }}
                      >
                        {agentLabel(a.agent_type)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.request_count)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.total_tokens)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums text-xs ${a.error_rate > 0.2 ? 'font-semibold text-red-500' : 'text-gray-500'}`}>
                      {fmtPct(a.error_rate)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {formatIsoInTaipeiDateTime(a.last_activity_at)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {DRILL_DOWN_AGENTS[a.agent_type] && (
                        <button
                          type="button"
                          onClick={() => loadDetail(a.agent_type as 'chat' | 'ocr')}
                          className={`rounded px-2 py-1 text-xs transition-colors ${
                            activeDetail === a.agent_type
                              ? 'bg-gray-700 text-white'
                              : 'border border-gray-300 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {activeDetail === a.agent_type ? '收起' : a.agent_type === 'chat' ? '對話串' : '辨識紀錄'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Level 2: chat threads */}
      {activeDetail === 'chat' && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">Chat 對話串</h4>
          {detailLoading && <p className="text-sm text-gray-400">載入對話串…</p>}
          {!detailLoading && chatThreads && (
            chatThreads.threads.length === 0
              ? <EmptyState text="此區間無對話串" />
              : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">標題</th>
                        <th className="px-3 py-2 text-left">Agent</th>
                        <th className="px-3 py-2 text-right">請求</th>
                        <th className="px-3 py-2 text-right">Tokens</th>
                        <th className="px-3 py-2 text-left">最後訊息</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {chatThreads.threads.map(t => (
                        <tr key={t.thread_id} className="hover:bg-gray-50">
                          <td className="max-w-[200px] truncate px-3 py-2 text-gray-800" title={t.title ?? ''}>
                            {t.title ?? '（無標題）'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">{t.agent_id}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInt(t.request_count_in_range)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtInt(t.total_tokens_in_range)}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {t.last_message_at ? formatIsoInTaipeiDateTime(t.last_message_at) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}
        </div>
      )}

      {/* Level 2: OCR history */}
      {activeDetail === 'ocr' && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-500">OCR 辨識紀錄</h4>
          {detailLoading && <p className="text-sm text-gray-400">載入辨識紀錄…</p>}
          {!detailLoading && ocrHistory && (
            ocrHistory.rows.length === 0
              ? <EmptyState text="此區間無辨識紀錄" />
              : (
                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100 text-xs text-gray-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Config 名稱</th>
                        <th className="px-3 py-2 text-left">檔案</th>
                        <th className="px-3 py-2 text-center">狀態</th>
                        <th className="px-3 py-2 text-right">Tokens</th>
                        <th className="px-3 py-2 text-left">時間</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {ocrHistory.rows.map(r => (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium text-gray-700">{r.config_name}</td>
                          <td className="max-w-[180px] truncate px-3 py-2 text-gray-600" title={r.filename}>
                            {r.filename}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.status === 'success'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-600'
                            }`}>
                              {r.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                            {r.total_tokens != null ? fmtInt(r.total_tokens) : '—'}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {formatIsoInTaipeiDateTime(r.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
          )}
        </div>
      )}
    </div>
  )
}

function TabUsers({ start, end }: { start: string; end: string }) {
  const { showToast } = useToast()
  const [anonymize, setAnonymize] = useState(false)
  const [sort, setSort] = useState<'tokens' | 'requests' | 'active_days' | 'error_rate'>('tokens')
  const [overview, setOverview] = useState<UsersOverviewResponse | null>(null)
  const [leaderboard, setLeaderboard] = useState<UsersLeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<UsersLeaderboardResponse | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    setExpandedUserId(null)
    Promise.all([
      getAgentInsightsUsersOverview({ start, end }),
      getAgentInsightsUsersLeaderboard({ start, end, sort, anonymize }),
    ])
      .then(([ov, lb]) => { setOverview(ov); setLeaderboard(lb) })
      .catch(() => showToast('載入使用者洞察失敗', 'error'))
      .finally(() => setLoading(false))
  }, [start, end, sort, anonymize]) // eslint-disable-line react-hooks/exhaustive-deps

  // 搜尋（debounce 400ms）
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    const timer = setTimeout(() => {
      setSearchLoading(true)
      getAgentInsightsUsersSearch({ q: searchQuery.trim(), start, end, anonymize })
        .then(setSearchResults)
        .catch(() => showToast('搜尋失敗', 'error'))
        .finally(() => setSearchLoading(false))
    }, 400)
    return () => clearTimeout(timer)
  }, [searchQuery, start, end, anonymize]) // eslint-disable-line react-hooks/exhaustive-deps

  const isSearchMode = searchQuery.trim().length > 0
  const displayRows = isSearchMode ? (searchResults?.rows ?? []) : (leaderboard?.rows ?? [])

  if (loading) return <Spinner />

  return (
    <div className="space-y-6">
      {/* controls row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* search */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="搜尋使用者（username / 顯示名稱 / email）"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setExpandedUserId(null) }}
            className="w-full rounded border border-gray-300 py-1.5 pl-8 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-gray-500 focus:outline-none"
          />
          <svg className="absolute left-2.5 top-2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          {searchQuery && (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setSearchResults(null) }}
              className="absolute right-2 top-1.5 text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          )}
        </div>

        {/* sort（搜尋模式下隱藏，搜尋結果依相關性排） */}
        {!isSearchMode && (
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">排序</label>
            <select
              value={sort}
              onChange={e => setSort(e.target.value as typeof sort)}
              className="rounded border border-gray-300 px-2 py-1 text-sm text-gray-700"
            >
              <option value="tokens">Total tokens</option>
              <option value="requests">請求數</option>
              <option value="active_days">活躍天數</option>
              <option value="error_rate">錯誤率</option>
            </select>
          </div>
        )}

        <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={e => setAnonymize(e.target.checked)}
            className="rounded border-gray-300"
          />
          匿名顯示
        </label>
      </div>

      {/* overview cards（搜尋模式下隱藏） */}
      {!isSearchMode && overview && <UserOverviewCards data={overview} />}

      {/* 搜尋狀態提示 */}
      {isSearchMode && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          {searchLoading
            ? <span>搜尋中…</span>
            : searchResults
              ? <span>找到 <strong className="text-gray-800">{searchResults.rows.length}</strong> 位符合的使用者</span>
              : null}
        </div>
      )}

      {/* leaderboard / search results */}
      {(isSearchMode ? !searchLoading : true) && (
        displayRows.length === 0
          ? <EmptyState text={isSearchMode ? '找不到符合的使用者' : '此區間無歸屬使用者的請求'} />
          : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className="px-4 py-3 text-left">使用者</th>
                    <th className="px-4 py-3 text-left">使用的 Agents</th>
                    <th className="px-4 py-3 text-right">活躍天</th>
                    <th className="px-4 py-3 text-right">請求</th>
                    <th className="px-4 py-3 text-right">Tokens</th>
                    <th className="px-4 py-3 text-right">錯誤率</th>
                    <th className="px-4 py-3 text-left">最後活動</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map(row => (
                    <>
                      <tr
                        key={row.user_id}
                        className={`cursor-pointer border-t border-gray-100 hover:bg-blue-50/40 ${
                          expandedUserId === row.user_id ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => setExpandedUserId(expandedUserId === row.user_id ? null : row.user_id)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">{row.display_label}</div>
                          {!anonymize && row.username && (
                            <div className="text-xs text-gray-400">@{row.username}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <UserAgentBadges agents={row.agents} />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                          {fmtInt(row.active_days)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                          {fmtInt(row.total_requests)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-800">
                          {fmtInt(row.total_tokens)}
                        </td>
                        <td className={`px-4 py-3 text-right tabular-nums text-xs ${
                          row.error_rate > 0.2 ? 'font-semibold text-red-500' : 'text-gray-500'
                        }`}>
                          {fmtPct(row.error_rate)}
                          {row.error_rate > 0.2 && <span className="ml-1">⚠️</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {formatIsoInTaipeiDateTime(row.last_activity_at)}
                        </td>
                      </tr>
                      {expandedUserId === row.user_id && (
                        <tr key={`${row.user_id}-detail`} className="bg-gray-50">
                          <td colSpan={7} className="p-0">
                            <UserDrillDown
                              row={row}
                              start={start}
                              end={end}
                              anonymize={anonymize}
                            />
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>
          )
      )}
    </div>
  )
}

function EmptyState({ text, positive }: { text: string; positive?: boolean }) {
  return (
    <div className={`rounded-lg border border-dashed py-8 text-center text-sm ${
      positive ? 'border-green-300 text-green-600 bg-green-50' : 'border-gray-200 text-gray-400'
    }`}>
      {positive && <span className="mr-1.5">✓</span>}
      {text}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

type TabKey = 'health' | 'usage' | 'tokens' | 'users'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'health', label: '健康狀態' },
  { key: 'usage',  label: '用量趨勢' },
  { key: 'tokens', label: 'Token 用量' },
  { key: 'users',  label: '使用者' },
]

export default function AdminAgentInsights() {
  const today = taipeiTodayYmd()
  const [rangeStart, setRangeStart] = useState(() => taipeiYmdMinusCalendarDays(today, 29))
  const [rangeEnd, setRangeEnd] = useState(today)
  const [appliedStart, setAppliedStart] = useState(() => taipeiYmdMinusCalendarDays(today, 29))
  const [appliedEnd, setAppliedEnd] = useState(today)
  const [tab, setTab] = useState<TabKey>('health')

  const handleApply = useCallback(() => {
    setAppliedStart(rangeStart)
    setAppliedEnd(rangeEnd)
  }, [rangeStart, rangeEnd])

  const handlePreset = useCallback((days: number) => {
    const newEnd = taipeiTodayYmd()
    const newStart = taipeiYmdMinusCalendarDays(newEnd, days - 1)
    setRangeStart(newStart)
    setRangeEnd(newEnd)
    setAppliedStart(newStart)
    setAppliedEnd(newEnd)
  }, [])

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-gray-600" />
        <div>
          <h2 className="text-lg font-bold text-gray-800">Agents 用量洞察</h2>
          <p className="text-xs text-gray-500">資料來源：agent_usage_logs（所有 Agent 的 LLM 與 Embedding 呼叫）</p>
        </div>
      </div>

      <DateRangePicker
        start={rangeStart} end={rangeEnd}
        onStartChange={setRangeStart} onEndChange={setRangeEnd}
        onApply={handleApply} onPreset={handlePreset}
      />

      {/* tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-gray-700 text-gray-800'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        {tab === 'health'  && <TabHealth  start={appliedStart} end={appliedEnd} />}
        {tab === 'usage'   && <TabUsage   start={appliedStart} end={appliedEnd} />}
        {tab === 'tokens'  && <TabTokens  start={appliedStart} end={appliedEnd} />}
        {tab === 'users'   && <TabUsers   start={appliedStart} end={appliedEnd} />}
      </div>
    </div>
  )
}
