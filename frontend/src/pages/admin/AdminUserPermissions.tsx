/** Admin：使用者權限設定 — 選 user → 設定角色、Agent 權限、模型權限 → 一鍵儲存 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getAgents } from '@/api/agents'
import { getAllLLMModelOptions, type LLMModelOption } from '@/api/llmConfigs'
import {
  getUserAgentIds,
  getUserModelPermissions,
  listUsers,
  updateUserAgents,
  updateUserModelPermissions,
  updateUserRole,
} from '@/api/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { Agent, User, UserRole } from '@/types'
import AgentIcon from '@/components/AgentIcon'
import { Lock } from 'lucide-react'

type ActiveTab = 'agents' | 'models'

const GROUP_COLORS = [
  { iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
  { iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
  { iconBg: 'bg-teal-50', iconColor: 'text-teal-600' },
  { iconBg: 'bg-violet-50', iconColor: 'text-violet-600' },
  { iconBg: 'bg-amber-50', iconColor: 'text-amber-700' },
]

export default function AdminUserPermissions() {
  // ── 使用者清單 ──
  const [users, setUsers] = useState<User[]>([])
  const [isLoadingUsers, setIsLoadingUsers] = useState(true)
  const [usersError, setUsersError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)

  // ── Tab ──
  const [activeTab, setActiveTab] = useState<ActiveTab>('agents')

  // ── Agent 權限 ──
  const [agents, setAgents] = useState<Agent[]>([])
  const [userAgentIds, setUserAgentIds] = useState<Set<string>>(new Set())
  const [userRole, setUserRole] = useState<UserRole>('member')
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  const [isLoadingUserAgents, setIsLoadingUserAgents] = useState(false)

  // ── 模型權限 ──
  const [allModels, setAllModels] = useState<LLMModelOption[]>([])
  /** null = 繼承租戶全部；Set = 明確指定的允許清單 */
  const [allowedModels, setAllowedModels] = useState<Set<string> | null>(null)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  // ── 儲存 ──
  const [isSaving, setIsSaving] = useState(false)
  const { showToast } = useToast()

  // 初始載入：使用者清單 + 租戶全部模型清單（admin 不受 allowed_models 限制）
  useEffect(() => {
    setUsersError(null)
    listUsers()
      .then((data) => { setUsers(data); setUsersError(null) })
      .catch((err) => {
        setUsers([])
        setUsersError(err instanceof ApiError && err.status === 403 ? '需要 admin 權限' : '無法載入使用者列表')
      })
      .finally(() => setIsLoadingUsers(false))

    getAllLLMModelOptions()
      .then(setAllModels)
      .catch(() => setAllModels([]))
  }, [])

  // 選中使用者變更：載入角色、agent 清單、agent 權限、模型權限
  useEffect(() => {
    if (selectedUserId == null) {
      setUserAgentIds(new Set())
      setUserRole('member')
      setAgents([])
      setAllowedModels(null)
      return
    }
    const u = users.find((x) => x.id === selectedUserId)
    setUserRole(u?.role ?? 'member')

    setIsLoadingAgents(true)
    getAgents(true, u?.tenant_id)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoadingAgents(false))

    setIsLoadingUserAgents(true)
    getUserAgentIds(selectedUserId)
      .then((ids) => setUserAgentIds(new Set(ids)))
      .catch(() => setUserAgentIds(new Set()))
      .finally(() => setIsLoadingUserAgents(false))

    setIsLoadingModels(true)
    getUserModelPermissions(selectedUserId)
      .then((perms) => setAllowedModels(perms === null ? null : new Set(perms)))
      .catch(() => setAllowedModels(null))
      .finally(() => setIsLoadingModels(false))
  }, [selectedUserId, users])

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) => u.email.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    )
  }, [users, search])

  const purchasedAgents = useMemo(
    () => agents.filter((a) => a.is_purchased === true),
    [agents]
  )

  // ── Agent 操作 ──
  const toggleAgent = useCallback((agentId: string) => {
    setUserAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  const selectAllAgents = useCallback(() => {
    setUserAgentIds(new Set(purchasedAgents.map((a) => a.id)))
  }, [purchasedAgents])

  const deselectAllAgents = useCallback(() => {
    setUserAgentIds(new Set())
  }, [])

  // ── 模型操作 ──
  const toggleModel = useCallback((modelValue: string) => {
    setAllowedModels((prev) => {
      // 若目前是「繼承全部」(null)，點選就展開成明確清單再移除該項
      const base: Set<string> = prev === null ? new Set(allModels.map((m) => m.value)) : new Set(prev)
      if (base.has(modelValue)) base.delete(modelValue)
      else base.add(modelValue)
      return base
    })
  }, [allModels])

  const selectAllModels = useCallback(() => {
    setAllowedModels(null) // null = 繼承全部
  }, [])

  const deselectAllModels = useCallback(() => {
    setAllowedModels(new Set())
  }, [])

  // ── 儲存（一次儲存角色 + Agent 權限 + 模型權限） ──
  const handleSave = useCallback(async () => {
    if (selectedUserId == null) return
    setIsSaving(true)
    try {
      // super_admin 略過角色更新
      if (userRole === 'admin' || userRole === 'manager' || userRole === 'member') {
        await updateUserRole(selectedUserId, userRole)
      }
      await updateUserAgents(selectedUserId, Array.from(userAgentIds))
      await updateUserModelPermissions(selectedUserId, allowedModels === null ? null : Array.from(allowedModels))
      showToast('已儲存')
      setUsers((prev) =>
        prev.map((u) => (u.id === selectedUserId ? { ...u, role: userRole } : u))
      )
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      showToast(msg, 'error')
    } finally {
      setIsSaving(false)
    }
  }, [selectedUserId, userRole, userAgentIds, allowedModels, showToast])

  const selectedUser = users.find((u) => u.id === selectedUserId)
  const isOnlyAdmin = selectedUser?.role === 'admin' && users.filter((u) => u.role === 'admin').length <= 1
  const isCheckedModel = (modelValue: string) => allowedModels === null || allowedModels.has(modelValue)

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Lock className="h-6 w-6 text-gray-600" />
        <div>
          <h2 className="text-lg font-bold text-gray-800">使用者權限設定</h2>
          <p className="text-sm text-gray-500 mt-0.5">設定各使用者可存取的 Agent 及可使用的 LLM 模型</p>
        </div>
      </div>

      {/* 主體：左側使用者列表 + 右側設定區 */}
      <div className="flex flex-1 min-h-0 gap-6">
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
        ) : usersError ? (
          <p className="py-4 text-sm text-red-600">{usersError}</p>
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

      {/* 右側 */}
      <div className="flex flex-1 min-w-0 flex-col">
        {selectedUserId == null ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
            <p className="text-gray-500">請選擇一位使用者</p>
          </div>
        ) : (
          <>
            {/* Header：使用者資訊 + 角色選擇 + 儲存 */}
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs text-gray-500">
                  Tenant：<span className="font-medium text-gray-700">{selectedUser?.tenant_id}</span>
                </p>
                <p className="text-lg font-semibold text-gray-800">
                  User：{selectedUser?.username ?? selectedUser?.email}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <span>角色</span>
                  {selectedUser?.role === 'super_admin' ? (
                    <span className="rounded-lg border border-gray-200 bg-gray-100 px-3 py-2 text-sm text-gray-600">
                      super_admin（不可變更）
                    </span>
                  ) : (
                    <select
                      value={userRole}
                      onChange={(e) => setUserRole(e.target.value as UserRole)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                    >
                      <option value="member" disabled={isOnlyAdmin}>member</option>
                      <option value="manager" disabled={isOnlyAdmin}>manager</option>
                      <option value="admin">admin</option>
                    </select>
                  )}
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

            {/* Tab 切換列 */}
            <div className="mb-4 flex gap-1 border-b-2 border-gray-200">
              <button
                type="button"
                onClick={() => setActiveTab('agents')}
                className={`-mb-0.5 rounded-t-lg border-b-2 px-5 py-2.5 text-base font-semibold transition-colors ${
                  activeTab === 'agents'
                    ? 'border-gray-600 bg-gray-50 text-gray-800'
                    : 'border-transparent text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                }`}
              >
                Agent 權限
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('models')}
                className={`-mb-0.5 rounded-t-lg border-b-2 px-5 py-2.5 text-base font-semibold transition-colors ${
                  activeTab === 'models'
                    ? 'border-gray-600 bg-gray-50 text-gray-800'
                    : 'border-transparent text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                }`}
              >
                模型權限
              </button>
            </div>

            {/* Tab 內容 */}
            {activeTab === 'agents' ? (
              isLoadingAgents || isLoadingUserAgents ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                </div>
              ) : purchasedAgents.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                  <p className="text-gray-500">尚無 Agent 資料</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllAgents}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                    >
                      全選
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllAgents}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                    >
                      全取消
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {purchasedAgents.map((agent, index) => {
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
              )
            ) : (
              isLoadingModels ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                </div>
              ) : allModels.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                  <p className="text-gray-500">租戶尚未設定任何模型</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllModels}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                    >
                      全部允許
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllModels}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 hover:border-gray-400"
                    >
                      全部禁用
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-2">
                    {allModels.map((m) => (
                      <label
                        key={m.value}
                        className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 transition-colors hover:bg-gray-50"
                      >
                        <input
                          type="checkbox"
                          checked={isCheckedModel(m.value)}
                          onChange={() => toggleModel(m.value)}
                          className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                        />
                        <div className="flex min-w-0 flex-col">
                          <span className="font-medium text-gray-900">{m.label}</span>
                          {m.note && (
                            <span className="text-xs text-gray-500">{m.note}</span>
                          )}
                          <span className="text-xs text-gray-400">{m.value}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )
            )}
          </>
        )}
      </div>
      </div>
    </div>
  )
}
