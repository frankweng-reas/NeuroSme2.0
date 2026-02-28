/** Admin：Agent 權限設定區塊 - 選 user → 勾選 agent → 儲存 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgents } from '@/api/agents'
import { getUserAgentIds, listUsers, updateUserAgents, updateUserRole } from '@/api/users'
import { ApiError } from '@/api/client'
import type { Agent, User, UserRole } from '@/types'
import AgentIcon from '@/components/AgentIcon'

const GROUP_COLORS = [
  { accent: 'border-l-slate-300', iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { accent: 'border-l-blue-300', iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
  { accent: 'border-l-teal-300', iconBg: 'bg-teal-50', iconColor: 'text-teal-600' },
  { accent: 'border-l-violet-300', iconBg: 'bg-violet-50', iconColor: 'text-violet-600' },
  { accent: 'border-l-amber-300', iconBg: 'bg-amber-50', iconColor: 'text-amber-700' },
]

export default function AdminAgentPermissions() {
  const [users, setUsers] = useState<User[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userAgentIds, setUserAgentIds] = useState<Set<string>>(new Set())
  const [userRole, setUserRole] = useState<UserRole>('member')
  const [search, setSearch] = useState('')
  const [isLoadingUsers, setIsLoadingUsers] = useState(true)
  const [isLoadingAgents, setIsLoadingAgents] = useState(true)
  const [isLoadingUserAgents, setIsLoadingUserAgents] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setIsLoadingUsers(false))
  }, [])

  useEffect(() => {
    getAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoadingAgents(false))
  }, [])

  useEffect(() => {
    if (selectedUserId == null) {
      setUserAgentIds(new Set())
      setUserRole('member')
      return
    }
    const u = users.find((x) => x.id === selectedUserId)
    setUserRole(u?.role ?? 'member')
    setIsLoadingUserAgents(true)
    getUserAgentIds(selectedUserId)
      .then((ids) => setUserAgentIds(new Set(ids)))
      .catch(() => setUserAgentIds(new Set()))
      .finally(() => setIsLoadingUserAgents(false))
  }, [selectedUserId, users])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    )
  }, [users, search])

  const toggleAgent = useCallback((agentId: string) => {
    setUserAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setUserAgentIds(new Set(agents.map((a) => a.id)))
  }, [agents])

  const deselectAll = useCallback(() => {
    setUserAgentIds(new Set())
  }, [])

  const handleSave = useCallback(async () => {
    if (selectedUserId == null) return
    setIsSaving(true)
    setSaveMessage(null)
    try {
      await updateUserRole(selectedUserId, userRole)
      await updateUserAgents(selectedUserId, Array.from(userAgentIds))
      setSaveMessage({ type: 'ok', text: '已儲存' })
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUserId ? { ...u, role: userRole } : u))
      )
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      setSaveMessage({ type: 'err', text: msg })
    } finally {
      setIsSaving(false)
    }
  }, [selectedUserId, userAgentIds, userRole])

  const selectedUser = users.find((u) => u.id === selectedUserId)
  const isOnlyAdmin = selectedUser?.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1

  return (
    <div className="flex h-full min-h-0 gap-6">
      {/* 左側：使用者列表 */}
      <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border-2 border-gray-200 bg-gray-50 p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-gray-800">使用者</h2>
        <input
          type="text"
          placeholder="搜尋 email / 帳號"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
        {isLoadingUsers ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          </div>
        ) : (
          <ul className="flex-1 overflow-y-auto space-y-1">
            {filteredUsers.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => setSelectedUserId(u.id)}
                  className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                    selectedUserId === u.id
                      ? 'bg-gray-600 text-white'
                      : 'bg-white text-gray-800 hover:bg-gray-200'
                  }`}
                >
                  <div className="truncate font-medium">{u.username}</div>
                  <div className="truncate text-xs opacity-80">{u.email}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 右側：Agent 勾選區 */}
      <div className="flex flex-1 min-w-0 flex-col">
        {selectedUserId == null ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
            <p className="text-gray-500">請選擇一位使用者</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold text-gray-800">
                {selectedUser?.username ?? selectedUser?.email} 可存取的 Agent
              </h2>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <span>角色</span>
                  <select
                    value={userRole}
                    onChange={(e) => setUserRole(e.target.value as UserRole)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    <option value="member" disabled={isOnlyAdmin}>member</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-lg px-4 py-2 font-medium text-white shadow-sm disabled:opacity-50"
                style={{ backgroundColor: '#4b5563' }}
              >
                {isSaving ? '儲存中...' : '儲存'}
              </button>
              </div>
            </div>
            {saveMessage && (
              <p
                className={`mb-3 text-sm ${
                  saveMessage.type === 'ok' ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {saveMessage.text}
              </p>
            )}
            {isLoadingAgents || isLoadingUserAgents ? (
              <div className="flex flex-1 items-center justify-center">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              </div>
            ) : agents.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                <p className="text-gray-500">尚無 Agent 資料</p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex gap-2">
                  <button
                    type="button"
                    onClick={selectAll}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                  >
                    全選
                  </button>
                  <button
                    type="button"
                    onClick={deselectAll}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                  >
                    全取消
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2">
                {agents.map((agent, index) => {
                  const colors = GROUP_COLORS[index % GROUP_COLORS.length]
                  return (
                    <label
                      key={agent.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 transition-colors hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={userAgentIds.has(agent.id)}
                        onChange={() => toggleAgent(agent.id)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                      />
                      <div
                        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${colors.iconBg}`}
                      >
                        <AgentIcon
                          iconName={agent.icon_name}
                          className={`h-4 w-4 ${colors.iconColor}`}
                        />
                      </div>
                      <span className="text-gray-900">
                        {agent.group_name} - {agent.agent_name}
                      </span>
                    </label>
                  )
                })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
