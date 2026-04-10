/** Admin：Chat 用量洞察 — Tab「用量」(A) / 「使用者」(B-1～B-3)；各 Tab 獨立日期區間，便於日後新增無區間之 Tab（如資源治理） */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  getChatInsightsOverview,
  getChatInsightsStorage,
  getChatInsightsUserThreads,
  getChatInsightsUsersLeaderboard,
  getChatInsightsUsersSummary,
  type ChatInsightsLeaderboard,
  type ChatInsightsOverview,
  type ChatInsightsStorage,
  type ChatInsightsUserThreads,
  type ChatInsightsUsersSummary,
} from '@/api/chatInsights'
import { ApiError } from '@/api/client'
import { ChatInsightsUsageCharts } from '@/components/admin/ChatInsightsUsageCharts'
import { useToast } from '@/contexts/ToastContext'
import {
  formatIsoInTaipeiDateTime,
  taipeiTodayYmd,
  taipeiYmdMinusCalendarDays,
} from '@/utils/taipeiDate'

const ANON_STORAGE_KEY = 'ns-chat-insights-anonymize'

type MainTab = 'usage' | 'users' | 'storage'

function formatInt(n: number) {
  return n.toLocaleString('zh-TW')
}

function formatBytes(n: number) {
  if (n < 1024) return `${formatInt(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function readAnonymizeInitial(): boolean {
  try {
    return sessionStorage.getItem(ANON_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function saveAnonymize(v: boolean) {
  try {
    sessionStorage.setItem(ANON_STORAGE_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

const defaultRangeEnd = () => taipeiTodayYmd()
const defaultRangeStart = () => taipeiYmdMinusCalendarDays(taipeiTodayYmd(), 29)

function InsightsTabDateRange({
  label,
  start,
  end,
  onStartChange,
  onEndChange,
  onApply,
  onPresetDays,
}: {
  label?: ReactNode
  start: string
  end: string
  onStartChange: (v: string) => void
  onEndChange: (v: string) => void
  onApply: () => void
  onPresetDays: (days: number) => void
}) {
  return (
    <div className="space-y-2">
      {label ? <div className="text-xs text-gray-600">{label}</div> : null}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div>
          <label className="block text-xs font-medium text-gray-600">起始日（台北）</label>
          <input
            type="date"
            value={start}
            onChange={(ev) => onStartChange(ev.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">結束日（台北）</label>
          <input
            type="date"
            value={end}
            onChange={(ev) => onEndChange(ev.target.value)}
            className="mt-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
          />
        </div>
        <button
          type="button"
          onClick={onApply}
          className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          套用
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onPresetDays(7)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            近 7 天
          </button>
          <button
            type="button"
            onClick={() => onPresetDays(30)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            近 30 天
          </button>
          <button
            type="button"
            onClick={() => onPresetDays(90)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
          >
            近 90 天
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminChatInsights() {
  const { showToast } = useToast()
  const [mainTab, setMainTab] = useState<MainTab>('usage')
  const [usageStart, setUsageStart] = useState(defaultRangeStart)
  const [usageEnd, setUsageEnd] = useState(defaultRangeEnd)
  const [usageAppliedStart, setUsageAppliedStart] = useState(defaultRangeStart)
  const [usageAppliedEnd, setUsageAppliedEnd] = useState(defaultRangeEnd)
  const [usersStart, setUsersStart] = useState(defaultRangeStart)
  const [usersEnd, setUsersEnd] = useState(defaultRangeEnd)
  const [usersAppliedStart, setUsersAppliedStart] = useState(defaultRangeStart)
  const [usersAppliedEnd, setUsersAppliedEnd] = useState(defaultRangeEnd)

  const [anonymize, setAnonymize] = useState(readAnonymizeInitial)
  const [leaderboardSort, setLeaderboardSort] = useState<'tokens' | 'requests'>('tokens')

  const [overview, setOverview] = useState<ChatInsightsOverview | null>(null)
  const [overviewLoading, setOverviewLoading] = useState(true)
  const [overviewError, setOverviewError] = useState<string | null>(null)

  const [usersSummary, setUsersSummary] = useState<ChatInsightsUsersSummary | null>(null)
  const [leaderboard, setLeaderboard] = useState<ChatInsightsLeaderboard | null>(null)
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userThreads, setUserThreads] = useState<ChatInsightsUserThreads | null>(null)
  const [threadsLoading, setThreadsLoading] = useState(false)
  const [threadsError, setThreadsError] = useState<string | null>(null)

  const [storage, setStorage] = useState<ChatInsightsStorage | null>(null)
  const [storageLoading, setStorageLoading] = useState(false)
  const [storageError, setStorageError] = useState<string | null>(null)

  const loadOverview = useCallback((s: string, e: string) => {
    setOverviewLoading(true)
    setOverviewError(null)
    getChatInsightsOverview({ start: s, end: e })
      .then(setOverview)
      .catch((err) => {
        setOverview(null)
        setOverviewError(
          err instanceof ApiError && err.status === 403
            ? err.detail ?? '需 admin 或 super_admin 權限'
            : err instanceof ApiError && err.detail
              ? err.detail
              : '無法載入用量資料'
        )
      })
      .finally(() => setOverviewLoading(false))
  }, [])

  const loadUsers = useCallback(
    (s: string, e: string, sort: 'tokens' | 'requests', anon: boolean) => {
      setUsersLoading(true)
      setUsersError(null)
      Promise.all([
        getChatInsightsUsersSummary({ start: s, end: e }),
        getChatInsightsUsersLeaderboard({ start: s, end: e, limit: 50, sort, anonymize: anon }),
      ])
        .then(([sum, board]) => {
          setUsersSummary(sum)
          setLeaderboard(board)
        })
        .catch((err) => {
          setUsersSummary(null)
          setLeaderboard(null)
          setUsersError(
            err instanceof ApiError && err.status === 403
              ? err.detail ?? '需 admin 或 super_admin 權限'
              : err instanceof ApiError && err.detail
                ? err.detail
                : '無法載入使用者洞察'
          )
        })
        .finally(() => setUsersLoading(false))
    },
    []
  )

  const loadThreads = useCallback(
    (userId: number, s: string, e: string, anon: boolean) => {
      setThreadsLoading(true)
      setThreadsError(null)
      getChatInsightsUserThreads(userId, { start: s, end: e, anonymize: anon })
        .then(setUserThreads)
        .catch((err) => {
          setUserThreads(null)
          setThreadsError(
            err instanceof ApiError && err.detail ? err.detail : '無法載入對話串列表'
          )
        })
        .finally(() => setThreadsLoading(false))
    },
    []
  )

  const loadStorage = useCallback((anon: boolean) => {
    setStorageLoading(true)
    setStorageError(null)
    getChatInsightsStorage({ limit: 10, anonymize: anon })
      .then(setStorage)
      .catch((err) => {
        setStorage(null)
        setStorageError(
          err instanceof ApiError && err.status === 403
            ? err.detail ?? '需 admin 或 super_admin 權限'
            : err instanceof ApiError && err.detail
              ? err.detail
              : '無法載入儲存空間資料'
        )
      })
      .finally(() => setStorageLoading(false))
  }, [])

  useEffect(() => {
    if (mainTab !== 'usage') return
    loadOverview(usageAppliedStart, usageAppliedEnd)
  }, [mainTab, loadOverview, usageAppliedStart, usageAppliedEnd])

  useEffect(() => {
    if (mainTab !== 'users') return
    loadUsers(usersAppliedStart, usersAppliedEnd, leaderboardSort, anonymize)
  }, [mainTab, loadUsers, usersAppliedStart, usersAppliedEnd, leaderboardSort, anonymize])

  useEffect(() => {
    if (selectedUserId == null) {
      setUserThreads(null)
      return
    }
    if (mainTab !== 'users') return
    loadThreads(selectedUserId, usersAppliedStart, usersAppliedEnd, anonymize)
  }, [mainTab, selectedUserId, usersAppliedStart, usersAppliedEnd, anonymize, loadThreads])

  useEffect(() => {
    if (mainTab !== 'storage') return
    loadStorage(anonymize)
  }, [mainTab, anonymize, loadStorage])

  const applyUsageRange = () => {
    if (!usageStart || !usageEnd) return
    if (usageStart > usageEnd) {
      showToast('起始日不可晚於結束日', 'error')
      return
    }
    setUsageAppliedStart(usageStart)
    setUsageAppliedEnd(usageEnd)
  }

  const presetUsageRange = (days: number) => {
    const e = taipeiTodayYmd()
    const s = taipeiYmdMinusCalendarDays(e, days - 1)
    setUsageStart(s)
    setUsageEnd(e)
    setUsageAppliedStart(s)
    setUsageAppliedEnd(e)
  }

  const applyUsersRange = () => {
    if (!usersStart || !usersEnd) return
    if (usersStart > usersEnd) {
      showToast('起始日不可晚於結束日', 'error')
      return
    }
    setUsersAppliedStart(usersStart)
    setUsersAppliedEnd(usersEnd)
  }

  const presetUsersRange = (days: number) => {
    const e = taipeiTodayYmd()
    const s = taipeiYmdMinusCalendarDays(e, days - 1)
    setUsersStart(s)
    setUsersEnd(e)
    setUsersAppliedStart(s)
    setUsersAppliedEnd(e)
  }

  const onAnonymizeChange = (v: boolean) => {
    setAnonymize(v)
    saveAnonymize(v)
  }

  const maxDayTokens = useMemo(() => {
    if (!overview?.by_day.length) return 1
    return Math.max(1, ...overview.by_day.map((d) => d.total_tokens))
  }, [overview])

  const s = overview?.summary

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Chat 用量洞察</h2>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        <button
          type="button"
          onClick={() => setMainTab('usage')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'usage'
              ? 'border-b-2 border-gray-800 text-gray-900'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          用量（A-1～A-3）
        </button>
        <button
          type="button"
          onClick={() => setMainTab('users')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'users'
              ? 'border-b-2 border-gray-800 text-gray-900'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          使用者（B-1～B-3）
        </button>
        <button
          type="button"
          onClick={() => setMainTab('storage')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            mainTab === 'storage'
              ? 'border-b-2 border-gray-800 text-gray-900'
              : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          儲存空間
        </button>
      </div>

      {mainTab === 'usage' && (
        <div className="space-y-4">
          <InsightsTabDateRange
            start={usageStart}
            end={usageEnd}
            onStartChange={setUsageStart}
            onEndChange={setUsageEnd}
            onApply={applyUsageRange}
            onPresetDays={presetUsageRange}
          />
          {overviewLoading && <p className="text-gray-500">載入中…</p>}
          {!overviewLoading && overviewError && <p className="text-red-600">{overviewError}</p>}
          {!overviewLoading && overview && s && (
            <UsageTabBody overview={overview} s={s} maxDayTokens={maxDayTokens} />
          )}
        </div>
      )}

      {mainTab === 'users' && (
        <UsersTabBody
          dateRangeToolbar={
            <InsightsTabDateRange
              start={usersStart}
              end={usersEnd}
              onStartChange={setUsersStart}
              onEndChange={setUsersEnd}
              onApply={applyUsersRange}
              onPresetDays={presetUsersRange}
            />
          }
          appliedStart={usersAppliedStart}
          appliedEnd={usersAppliedEnd}
          usersLoading={usersLoading}
          usersError={usersError}
          usersSummary={usersSummary}
          leaderboard={leaderboard}
          leaderboardSort={leaderboardSort}
          setLeaderboardSort={setLeaderboardSort}
          anonymize={anonymize}
          onAnonymizeChange={onAnonymizeChange}
          selectedUserId={selectedUserId}
          setSelectedUserId={setSelectedUserId}
          userThreads={userThreads}
          threadsLoading={threadsLoading}
          threadsError={threadsError}
        />
      )}

      {mainTab === 'storage' && (
        <StorageTabBody
          storage={storage}
          loading={storageLoading}
          error={storageError}
          anonymize={anonymize}
          onAnonymizeChange={onAnonymizeChange}
        />
      )}
    </div>
  )
}

function StorageTabBody({
  storage,
  loading,
  error,
  anonymize,
  onAnonymizeChange,
}: {
  storage: ChatInsightsStorage | null
  loading: boolean
  error: string | null
  anonymize: boolean
  onAnonymizeChange: (v: boolean) => void
}) {
  const t = storage?.totals
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(e) => onAnonymizeChange(e.target.checked)}
            className="rounded border-gray-300"
          />
          匿名顯示（不顯示帳號）
        </label>
      </div>

      {loading && <p className="text-gray-500">載入中…</p>}
      {!loading && error && <p className="text-red-600">{error}</p>}
      {!loading && t && storage && (
        <>
          <section>
            <h3 className="mb-3 text-lg font-medium text-gray-900">租戶總覽</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['對話串（threads）', formatInt(t.thread_count)],
                ['附加檔連結列數', formatInt(t.chat_attachment_link_count)],
                ['不重複附加檔數', formatInt(t.chat_attachment_distinct_files)],
                ['附加檔合計大小', formatBytes(t.chat_attachment_total_bytes)],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="text-xs text-gray-500">{label}</div>
                  <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-medium text-gray-900">對話串數 Top 10（使用者）</h3>
            <p className="mb-2 text-xs text-gray-500">依每人擁有之 chat_threads 數排序。</p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">顯示名稱</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">user_id</th>
                    {!anonymize && <th className="px-3 py-2 text-left font-medium text-gray-700">username</th>}
                    <th className="px-3 py-2 text-right font-medium text-gray-700">對話串數</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.top_users_by_thread_count.length === 0 ? (
                    <tr>
                      <td colSpan={anonymize ? 3 : 4} className="px-3 py-6 text-center text-gray-500">
                        尚無對話串
                      </td>
                    </tr>
                  ) : (
                    storage.top_users_by_thread_count.map((r) => (
                      <tr key={r.user_id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.display_label}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600">{r.user_id}</td>
                        {!anonymize && <td className="px-3 py-2 text-gray-800">{r.username ?? '—'}</td>}
                        <td className="px-3 py-2 text-right">{formatInt(r.thread_count)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-medium text-gray-900">Chat 附加檔體積 Top 10（使用者）</h3>
            <p className="mb-2 text-xs text-gray-500">依每人所屬對話中，不重複附加檔之 size 加總排序。</p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">顯示名稱</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">user_id</th>
                    {!anonymize && <th className="px-3 py-2 text-left font-medium text-gray-700">username</th>}
                    <th className="px-3 py-2 text-right font-medium text-gray-700">檔案數</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">合計大小</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.top_users_by_chat_attachment_bytes.length === 0 ? (
                    <tr>
                      <td colSpan={anonymize ? 4 : 5} className="px-3 py-6 text-center text-gray-500">
                        尚無附加檔
                      </td>
                    </tr>
                  ) : (
                    storage.top_users_by_chat_attachment_bytes.map((r) => (
                      <tr key={`b-${r.user_id}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.display_label}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600">{r.user_id}</td>
                        {!anonymize && <td className="px-3 py-2 text-gray-800">{r.username ?? '—'}</td>}
                        <td className="px-3 py-2 text-right">{formatInt(r.distinct_file_count)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatBytes(r.total_bytes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-lg font-medium text-gray-900">Chat 附加檔「檔案數」Top 10（使用者）</h3>
            <p className="mb-2 text-xs text-gray-500">
              同上一表之不重複檔數，但依<strong className="font-medium text-gray-800">檔案個數</strong>排序（多小檔案者也會上榜）。
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">顯示名稱</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">user_id</th>
                    {!anonymize && <th className="px-3 py-2 text-left font-medium text-gray-700">username</th>}
                    <th className="px-3 py-2 text-right font-medium text-gray-700">檔案數</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">合計大小</th>
                  </tr>
                </thead>
                <tbody>
                  {storage.top_users_by_chat_attachment_file_count.length === 0 ? (
                    <tr>
                      <td colSpan={anonymize ? 4 : 5} className="px-3 py-6 text-center text-gray-500">
                        尚無附加檔
                      </td>
                    </tr>
                  ) : (
                    storage.top_users_by_chat_attachment_file_count.map((r) => (
                      <tr key={`c-${r.user_id}`} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.display_label}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-600">{r.user_id}</td>
                        {!anonymize && <td className="px-3 py-2 text-gray-800">{r.username ?? '—'}</td>}
                        <td className="px-3 py-2 text-right">{formatInt(r.distinct_file_count)}</td>
                        <td className="px-3 py-2 text-right">{formatBytes(r.total_bytes)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function UsageTabBody({
  overview,
  s,
  maxDayTokens,
}: {
  overview: ChatInsightsOverview
  s: ChatInsightsOverview['summary']
  maxDayTokens: number
}) {
  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-600">
        租戶 <span className="font-mono text-gray-800">{overview.tenant_id}</span>；區間（台北日曆）{' '}
        <span className="font-mono">{overview.start}</span> — <span className="font-mono">{overview.end}</span>
      </p>

      <section>
        <h3 className="mb-3 text-lg font-medium text-gray-900">A-1 用量總覽</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['請求數', formatInt(s.request_count)],
            ['成功', formatInt(s.success_count)],
            ['失敗', formatInt(s.error_count)],
            ['進行中／未結案', formatInt(s.pending_count)],
            ['Prompt tokens', formatInt(s.total_prompt_tokens)],
            ['Completion tokens', formatInt(s.total_completion_tokens)],
            ['Total tokens', formatInt(s.total_tokens)],
            [
              '平均每請求 tokens',
              s.avg_total_tokens_per_request != null ? formatInt(Math.round(s.avg_total_tokens_per_request)) : '—',
            ],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
              <div className="text-xs text-gray-500">{label}</div>
              <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-gray-900">圖表總覽</h3>
        <ChatInsightsUsageCharts overview={overview} />
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-gray-900">每日明細（對照上方趨勢圖）</h3>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700">日（台北）</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">請求</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">成功</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">失敗</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Tokens</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">占比（條）</th>
              </tr>
            </thead>
            <tbody>
              {overview.by_day.map((d) => (
                <tr key={d.day} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono text-gray-800">{d.day}</td>
                  <td className="px-3 py-2 text-right text-gray-800">{formatInt(d.request_count)}</td>
                  <td className="px-3 py-2 text-right text-green-700">{formatInt(d.success_count)}</td>
                  <td className="px-3 py-2 text-right text-red-700">{formatInt(d.error_count)}</td>
                  <td className="px-3 py-2 text-right text-gray-800">{formatInt(d.total_tokens)}</td>
                  <td className="px-3 py-2">
                    <div className="h-2 w-full max-w-[120px] rounded bg-gray-100">
                      <div
                        className="h-2 rounded bg-blue-500"
                        style={{ width: `${Math.round((d.total_tokens / maxDayTokens) * 100)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-gray-900">A-2 依模型／provider</h3>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-700">模型</th>
                <th className="px-3 py-2 text-left font-medium text-gray-700">Provider</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">請求</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">成功</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">失敗</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Prompt tok.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Compl. tok.</th>
                <th className="px-3 py-2 text-right font-medium text-gray-700">Total tok.</th>
              </tr>
            </thead>
            <tbody>
              {overview.by_model.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                    此區間無資料
                  </td>
                </tr>
              ) : (
                overview.by_model.map((row, i) => (
                  <tr key={`${row.llm_model ?? ''}-${row.provider ?? ''}-${i}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 font-mono text-gray-900">{row.llm_model ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-800">{row.provider ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{formatInt(row.request_count)}</td>
                    <td className="px-3 py-2 text-right text-green-700">{formatInt(row.success_count)}</td>
                    <td className="px-3 py-2 text-right text-red-700">{formatInt(row.error_count)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(row.total_prompt_tokens)}</td>
                    <td className="px-3 py-2 text-right">{formatInt(row.total_completion_tokens)}</td>
                    <td className="px-3 py-2 text-right font-medium">{formatInt(row.total_tokens)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-3 text-lg font-medium text-gray-900">A-3 狀態與錯誤碼</h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">
              依狀態
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">status</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">筆數</th>
                </tr>
              </thead>
              <tbody>
                {overview.by_status.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-gray-500">
                      無
                    </td>
                  </tr>
                ) : (
                  overview.by_status.map((row) => (
                    <tr key={row.status} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono">{row.status}</td>
                      <td className="px-3 py-2 text-right">{formatInt(row.count)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-800">
              失敗請求 error_code Top
            </div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">error_code</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">次數</th>
                </tr>
              </thead>
              <tbody>
                {overview.top_error_codes.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-3 py-4 text-center text-gray-500">
                      無失敗紀錄或未填 error_code
                    </td>
                  </tr>
                ) : (
                  overview.top_error_codes.map((row) => (
                    <tr key={row.error_code} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono text-gray-900">{row.error_code}</td>
                      <td className="px-3 py-2 text-right">{formatInt(row.count)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )
}

function UsersTabBody({
  dateRangeToolbar,
  appliedStart,
  appliedEnd,
  usersLoading,
  usersError,
  usersSummary,
  leaderboard,
  leaderboardSort,
  setLeaderboardSort,
  anonymize,
  onAnonymizeChange,
  selectedUserId,
  setSelectedUserId,
  userThreads,
  threadsLoading,
  threadsError,
}: {
  dateRangeToolbar: ReactNode
  appliedStart: string
  appliedEnd: string
  usersLoading: boolean
  usersError: string | null
  usersSummary: ChatInsightsUsersSummary | null
  leaderboard: ChatInsightsLeaderboard | null
  leaderboardSort: 'tokens' | 'requests'
  setLeaderboardSort: (s: 'tokens' | 'requests') => void
  anonymize: boolean
  onAnonymizeChange: (v: boolean) => void
  selectedUserId: number | null
  setSelectedUserId: (id: number | null) => void
  userThreads: ChatInsightsUserThreads | null
  threadsLoading: boolean
  threadsError: string | null
}) {
  return (
    <div className="space-y-6">
      {dateRangeToolbar}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          目前套用區間（台北日曆）{' '}
          <span className="font-mono">{appliedStart}</span> — <span className="font-mono">{appliedEnd}</span>
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(e) => onAnonymizeChange(e.target.checked)}
            className="rounded border-gray-300"
          />
          匿名顯示（B-3）：不顯示使用者帳號／email
        </label>
      </div>

      {usersLoading && <p className="text-gray-500">載入中…</p>}
      {!usersLoading && usersError && <p className="text-red-600">{usersError}</p>}

      {!usersLoading && usersSummary && (
        <section>
          <h3 className="mb-3 text-lg font-medium text-gray-900">B-1 使用者活躍與人均</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['活躍使用者數', formatInt(usersSummary.active_users)],
              ['歸屬請求數（有 user）', formatInt(usersSummary.total_requests_attributed)],
              ['無 user 之請求', formatInt(usersSummary.requests_without_user)],
              ['歸屬 total tokens', formatInt(usersSummary.total_tokens_attributed)],
              [
                '人均請求（活躍）',
                usersSummary.avg_requests_per_active_user != null
                  ? usersSummary.avg_requests_per_active_user.toLocaleString('zh-TW', {
                      maximumFractionDigits: 2,
                    })
                  : '—',
              ],
              [
                '人均 tokens（活躍）',
                usersSummary.avg_tokens_per_active_user != null
                  ? formatInt(Math.round(usersSummary.avg_tokens_per_active_user))
                  : '—',
              ],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-xs text-gray-500">{label}</div>
                <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!usersLoading && leaderboard && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-medium text-gray-900">B-2 使用者排行（點列下鑽對話串）</h3>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">排序</label>
              <select
                value={leaderboardSort}
                onChange={(e) => setLeaderboardSort(e.target.value as 'tokens' | 'requests')}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="tokens">Total tokens</option>
                <option value="requests">請求數</option>
              </select>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">顯示名稱</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">user_id</th>
                  {!anonymize && (
                    <th className="px-3 py-2 text-left font-medium text-gray-700">username</th>
                  )}
                  <th className="px-3 py-2 text-right font-medium text-gray-700">請求</th>
                  <th className="px-3 py-2 text-right font-medium text-gray-700">Total tok.</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-700">最後活動（台北）</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={anonymize ? 5 : 6}
                      className="px-3 py-6 text-center text-gray-500"
                    >
                      此區間無歸屬使用者的請求
                    </td>
                  </tr>
                ) : (
                  leaderboard.rows.map((row) => (
                    <tr
                      key={row.user_id}
                      className={`cursor-pointer border-t border-gray-100 hover:bg-blue-50/50 ${
                        selectedUserId === row.user_id ? 'bg-blue-50' : ''
                      }`}
                      onClick={() =>
                        setSelectedUserId(selectedUserId === row.user_id ? null : row.user_id)
                      }
                    >
                      <td className="px-3 py-2 font-medium text-gray-900">{row.display_label}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-600">{row.user_id}</td>
                      {!anonymize && (
                        <td className="px-3 py-2 text-gray-800">{row.username ?? '—'}</td>
                      )}
                      <td className="px-3 py-2 text-right">{formatInt(row.request_count)}</td>
                      <td className="px-3 py-2 text-right">{formatInt(row.total_tokens)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-600">
                        {formatIsoInTaipeiDateTime(row.last_activity_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {selectedUserId != null && (
            <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-medium text-gray-900">
                  對話串（user_id {selectedUserId}
                  {userThreads ? ` · ${userThreads.display_label}` : ''}）
                </h4>
                <button
                  type="button"
                  onClick={() => setSelectedUserId(null)}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  關閉
                </button>
              </div>
              {threadsLoading && <p className="text-sm text-gray-500">載入對話串…</p>}
              {threadsError && <p className="text-sm text-red-600">{threadsError}</p>}
              {!threadsLoading && userThreads && (
                <div className="max-h-64 overflow-y-auto rounded border border-gray-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-100">
                      <tr>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-700">標題</th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-700">agent</th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-700">區間內請求</th>
                        <th className="px-2 py-2 text-right text-xs font-medium text-gray-700">區間內 tok.</th>
                        <th className="px-2 py-2 text-left text-xs font-medium text-gray-700">last_message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {userThreads.threads.map((t) => (
                        <tr key={t.thread_id} className="border-t border-gray-100">
                          <td className="max-w-[200px] truncate px-2 py-2 text-gray-900" title={t.title ?? ''}>
                            {t.title ?? '（無標題）'}
                          </td>
                          <td className="px-2 py-2 font-mono text-xs text-gray-700">{t.agent_id}</td>
                          <td className="px-2 py-2 text-right">{formatInt(t.request_count_in_range)}</td>
                          <td className="px-2 py-2 text-right">{formatInt(t.total_tokens_in_range)}</td>
                          <td className="px-2 py-2 font-mono text-xs text-gray-600">
                            {formatIsoInTaipeiDateTime(t.last_message_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
