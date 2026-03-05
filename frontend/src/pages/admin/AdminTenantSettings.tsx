/** Admin：Tenant 設定區塊（僅 super_admin 可見） */
import { useCallback, useEffect, useState } from 'react'
import {
  createAgentCatalog,
  deleteAgentCatalog,
  listAgentCatalog,
  updateAgentCatalog,
} from '@/api/agentCatalog'
import {
  createTenant,
  deleteTenant,
  getTenantAgentIds,
  listTenants,
  updateTenant,
  updateTenantAgents,
} from '@/api/tenants'
import { ApiError } from '@/api/client'
import AgentIcon from '@/components/AgentIcon'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import { useToast } from '@/contexts/ToastContext'
import type { AgentCatalog, Tenant } from '@/types'

type TabId = 'tenants' | 'agents' | 'tenant-agents'

const TABS: { id: TabId; label: string }[] = [
  { id: 'tenants', label: 'Tenants' },
  { id: 'agents', label: 'Agents' },
  { id: 'tenant-agents', label: 'Tenant Agents' },
]

export default function AdminTenantSettings() {
  const { showToast } = useToast()
  const [activeTab, setActiveTab] = useState<TabId>('tenants')
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [tenantsLoading, setTenantsLoading] = useState(false)
  const [tenantsError, setTenantsError] = useState<string | null>(null)
  const [formId, setFormId] = useState('')
  const [formName, setFormName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ tenantId: string } | null>(null)
  const [tenantFormOpen, setTenantFormOpen] = useState(false)

  // Agents tab
  const [agents, setAgents] = useState<AgentCatalog[]>([])
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [agentsError, setAgentsError] = useState<string | null>(null)
  const [agentForm, setAgentForm] = useState({
    id: '',
    sort_id: '',
    group_id: '',
    group_name: '',
    agent_id: '',
    agent_name: '',
    icon_name: '',
  })
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null)
  const [agentsSaving, setAgentsSaving] = useState(false)
  const [deleteAgentConfirm, setDeleteAgentConfirm] = useState<{ agentId: string } | null>(null)
  const [agentFormOpen, setAgentFormOpen] = useState(false)

  // Tenant Agents tab
  const [selectedTenantIdForAgents, setSelectedTenantIdForAgents] = useState<string | null>(null)
  const [tenantAgentIds, setTenantAgentIds] = useState<Set<string>>(new Set())
  const [tenantAgentsLoading, setTenantAgentsLoading] = useState(false)
  const [tenantAgentsSaving, setTenantAgentsSaving] = useState(false)
  const [tenantAgentsTenants, setTenantAgentsTenants] = useState<Tenant[]>([])
  const [tenantAgentsTenantsLoading, setTenantAgentsTenantsLoading] = useState(false)

  const loadTenants = useCallback(() => {
    setTenantsError(null)
    setTenantsLoading(true)
    listTenants()
      .then(setTenants)
      .catch((err) => {
        setTenants([])
        setTenantsError(err instanceof ApiError && err.status === 403 ? '需 super_admin 權限' : '無法載入 tenants')
      })
      .finally(() => setTenantsLoading(false))
  }, [])

  const loadAgents = useCallback(() => {
    setAgentsError(null)
    setAgentsLoading(true)
    listAgentCatalog()
      .then(setAgents)
      .catch((err) => {
        setAgents([])
        setAgentsError(err instanceof ApiError && err.status === 403 ? '需 super_admin 權限' : '無法載入 agents')
      })
      .finally(() => setAgentsLoading(false))
  }, [])

  useEffect(() => {
    if (activeTab === 'tenants') loadTenants()
  }, [activeTab, loadTenants])

  useEffect(() => {
    if (activeTab === 'agents') loadAgents()
  }, [activeTab, loadAgents])

  useEffect(() => {
    if (activeTab === 'tenant-agents') {
      setTenantAgentsTenantsLoading(true)
      listTenants()
        .then(setTenantAgentsTenants)
        .catch(() => setTenantAgentsTenants([]))
        .finally(() => setTenantAgentsTenantsLoading(false))
      loadAgents()
    }
  }, [activeTab, loadAgents])

  useEffect(() => {
    if (activeTab === 'tenant-agents' && selectedTenantIdForAgents) {
      setTenantAgentsLoading(true)
      getTenantAgentIds(selectedTenantIdForAgents)
        .then((ids) => setTenantAgentIds(new Set(ids)))
        .catch(() => setTenantAgentIds(new Set()))
        .finally(() => setTenantAgentsLoading(false))
    } else {
      setTenantAgentIds(new Set())
    }
  }, [activeTab, selectedTenantIdForAgents])

  const handleTenantAddClick = useCallback(() => {
    setEditingId(null)
    setFormId('')
    setFormName('')
    setTenantFormOpen(true)
  }, [])

  const handleStartEdit = useCallback((t: Tenant) => {
    setEditingId(t.id)
    setFormId(t.id)
    setFormName(t.name)
    setTenantFormOpen(true)
  }, [])

  const handleCancelEdit = useCallback(() => {
    setEditingId(null)
    setFormId('')
    setFormName('')
    setTenantFormOpen(false)
  }, [])

  const handleSubmit = useCallback(async () => {
    const id = formId.trim()
    const name = formName.trim()
    if (!id || !name) {
      showToast('請填寫 ID 與名稱', 'error')
      return
    }
    setSaving(true)
    try {
      if (editingId) {
        await updateTenant(editingId, name)
        setTenants((prev) => prev.map((t) => (t.id === editingId ? { ...t, name } : t)))
        showToast('已更新')
      } else {
        await createTenant(id, name)
        setTenants((prev) => [...prev, { id, name }].sort((a, b) => a.id.localeCompare(b.id)))
        showToast('已新增')
      }
      handleCancelEdit()
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      showToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }, [editingId, formId, formName, handleCancelEdit, showToast])

  const handleDeleteClick = useCallback((id: string) => {
    setDeleteConfirm({ tenantId: id })
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return
    const { tenantId } = deleteConfirm
    setDeleteConfirm(null)
    try {
      await deleteTenant(tenantId)
      setTenants((prev) => prev.filter((t) => t.id !== tenantId))
      showToast('已刪除')
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '刪除失敗'
      showToast(msg, 'error')
    }
  }, [deleteConfirm, showToast])

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  // Agents handlers
  const handleAgentAddClick = useCallback(() => {
    setEditingAgentId(null)
    setAgentForm({ id: '', sort_id: '', group_id: '', group_name: '', agent_id: '', agent_name: '', icon_name: '' })
    setAgentFormOpen(true)
  }, [])

  const handleAgentStartEdit = useCallback((a: AgentCatalog) => {
    setEditingAgentId(a.id)
    setAgentForm({
      id: a.id,
      sort_id: a.sort_id ?? '',
      group_id: a.group_id,
      group_name: a.group_name,
      agent_id: a.agent_id,
      agent_name: a.agent_name,
      icon_name: a.icon_name ?? '',
    })
    setAgentFormOpen(true)
  }, [])

  const handleAgentCancelEdit = useCallback(() => {
    setEditingAgentId(null)
    setAgentForm({ id: '', sort_id: '', group_id: '', group_name: '', agent_id: '', agent_name: '', icon_name: '' })
    setAgentFormOpen(false)
  }, [])

  const handleAgentSubmit = useCallback(async () => {
    const { id, sort_id, group_id, group_name, agent_id, agent_name, icon_name } = agentForm
    const gid = group_id.trim()
    const gname = group_name.trim()
    const aid = agent_id.trim()
    const aname = agent_name.trim()
    if (!gid || !gname || !aid || !aname) {
      showToast('請填寫必填欄位（group_id, group_name, agent_id, agent_name）', 'error')
      return
    }
    if (!editingAgentId && !id.trim()) {
      showToast('新增時請填寫 ID', 'error')
      return
    }
    setAgentsSaving(true)
    try {
      if (editingAgentId) {
        const updated = await updateAgentCatalog(editingAgentId, {
          sort_id: sort_id.trim() || null,
          group_id: gid,
          group_name: gname,
          agent_id: aid,
          agent_name: aname,
          icon_name: icon_name.trim() || null,
        })
        setAgents((prev) => {
          const filtered = prev.filter((a) => a.id !== editingAgentId)
          return [...filtered, updated].sort((a, b) => (a.sort_id ?? a.id).localeCompare(b.sort_id ?? b.id))
        })
        showToast('已更新')
      } else {
        const newId = id.trim()
        await createAgentCatalog({
          id: newId,
          sort_id: sort_id.trim() || null,
          group_id: gid,
          group_name: gname,
          agent_id: aid,
          agent_name: aname,
          icon_name: icon_name.trim() || null,
        })
        setAgents((prev) =>
          [...prev, { id: newId, sort_id: sort_id.trim() || null, group_id: gid, group_name: gname, agent_id: aid, agent_name: aname, icon_name: icon_name.trim() || null }].sort(
            (a, b) => (a.sort_id ?? a.id).localeCompare(b.sort_id ?? b.id)
          )
        )
        showToast('已新增')
      }
      handleAgentCancelEdit()
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      showToast(msg, 'error')
    } finally {
      setAgentsSaving(false)
    }
  }, [editingAgentId, agentForm, handleAgentCancelEdit, showToast])

  const handleAgentDeleteClick = useCallback((id: string) => {
    setDeleteAgentConfirm({ agentId: id })
  }, [])

  const handleAgentDeleteConfirm = useCallback(async () => {
    if (!deleteAgentConfirm) return
    const { agentId } = deleteAgentConfirm
    setDeleteAgentConfirm(null)
    try {
      await deleteAgentCatalog(agentId)
      setAgents((prev) => prev.filter((a) => a.id !== agentId))
      showToast('已刪除')
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '刪除失敗'
      showToast(msg, 'error')
    }
  }, [deleteAgentConfirm, showToast])

  const handleAgentDeleteCancel = useCallback(() => {
    setDeleteAgentConfirm(null)
  }, [])

  // Tenant Agents handlers
  const toggleTenantAgent = useCallback((agentId: string) => {
    setTenantAgentIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }, [])

  const selectAllTenantAgents = useCallback(() => {
    setTenantAgentIds(new Set(agents.map((a) => a.id)))
  }, [agents])

  const deselectAllTenantAgents = useCallback(() => {
    setTenantAgentIds(new Set())
  }, [])

  const handleTenantAgentsSave = useCallback(async () => {
    if (!selectedTenantIdForAgents) return
    setTenantAgentsSaving(true)
    try {
      await updateTenantAgents(selectedTenantIdForAgents, Array.from(tenantAgentIds))
      showToast('已儲存')
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      showToast(msg, 'error')
    } finally {
      setTenantAgentsSaving(false)
    }
  }, [selectedTenantIdForAgents, tenantAgentIds, showToast])

  const GROUP_COLORS = [
    { iconBg: 'bg-slate-50', iconColor: 'text-slate-600' },
    { iconBg: 'bg-blue-50', iconColor: 'text-blue-600' },
    { iconBg: 'bg-teal-50', iconColor: 'text-teal-600' },
    { iconBg: 'bg-violet-50', iconColor: 'text-violet-600' },
    { iconBg: 'bg-amber-50', iconColor: 'text-amber-700' },
  ]
  const selectedTenantForAgents = tenantAgentsTenants.find((t) => t.id === selectedTenantIdForAgents)

  return (
    <div className="text-[18px]">
      {/* Tab 導航 - 現代感、區分明顯 */}
      <div className="mb-8">
        <div
          className="inline-flex gap-1 rounded-xl border-2 border-gray-200 bg-gray-100 p-1.5 shadow-sm"
          role="tablist"
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              aria-controls={`panel-${id}`}
              id={`tab-${id}`}
              onClick={() => setActiveTab(id)}
              className={`
                min-w-[140px] rounded-lg px-6 py-3 text-[18px] font-medium transition-all duration-200
                ${activeTab === id
                  ? 'bg-white text-gray-900 shadow-md ring-1 ring-gray-200'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab 內容區 - 僅渲染當前 tab */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'tenants' && (
      <div
        id="panel-tenants"
        role="tabpanel"
        aria-labelledby="tab-tenants"
        className="rounded-xl border border-gray-200 bg-gray-50/50 p-6"
      >
        <div className="mb-4">
          <button
            type="button"
            onClick={handleTenantAddClick}
            className="rounded-lg px-4 py-2 text-[18px] font-medium text-white shadow-sm"
            style={{ backgroundColor: '#4b5563' }}
          >
            新增
          </button>
        </div>

        {/* 表格 */}
        {tenantsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          </div>
        ) : tenantsError ? (
          <p className="text-[18px] text-red-600">{tenantsError}</p>
        ) : tenants.length === 0 ? (
          <p className="text-[18px] text-gray-500">尚無 tenant 資料</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full border-collapse text-[18px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">名稱</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-800">操作</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-gray-900">{t.id}</td>
                    <td className="px-4 py-3 text-gray-900">{t.name}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(t)}
                        className="mr-2 text-[18px] text-blue-600 hover:underline"
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(t.id)}
                        className="text-[18px] text-red-600 hover:underline"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        )}

        {activeTab === 'agents' && (
      <div
        id="panel-agents"
        role="tabpanel"
        aria-labelledby="tab-agents"
        className="rounded-xl border border-gray-200 bg-gray-50/50 p-6"
      >
        <div className="mb-4 flex items-center gap-4">
          <button
            type="button"
            onClick={handleAgentAddClick}
            className="rounded-lg px-4 py-2 text-[18px] font-medium text-white shadow-sm"
            style={{ backgroundColor: '#4b5563' }}
          >
            新增
          </button>
          <span className="text-[18px] text-gray-600">注意，sort_id 影響畫面上的排序</span>
        </div>

        {/* 表格 */}
        {agentsLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          </div>
        ) : agentsError ? (
          <p className="text-[18px] text-red-600">{agentsError}</p>
        ) : agents.length === 0 ? (
          <p className="text-[18px] text-gray-500">尚無 agent 資料</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full border-collapse text-[18px]">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-100">
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">ID</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">sort_id</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">group_id</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">group_name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">agent_id</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">agent_name</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-800">icon_name</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-800">操作</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 font-mono text-gray-900">{a.id}</td>
                    <td className="px-4 py-3 text-gray-500">{a.sort_id ?? '-'}</td>
                    <td className="px-4 py-3 text-gray-900">{a.group_id}</td>
                    <td className="px-4 py-3 text-gray-900">{a.group_name}</td>
                    <td className="px-4 py-3 font-mono text-gray-900">{a.agent_id}</td>
                    <td className="px-4 py-3 text-gray-900">{a.agent_name}</td>
                    <td className="px-4 py-3 text-gray-500">{a.icon_name ?? '-'}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleAgentStartEdit(a)}
                        className="mr-2 text-[18px] text-blue-600 hover:underline"
                      >
                        編輯
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAgentDeleteClick(a.id)}
                        className="text-[18px] text-red-600 hover:underline"
                      >
                        刪除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
        )}

        {activeTab === 'tenant-agents' && (
      <div
        id="panel-tenant-agents"
        role="tabpanel"
        aria-labelledby="tab-tenant-agents"
        className="flex min-h-0 flex-1 gap-6 rounded-xl border border-gray-200 bg-gray-50/50 p-6"
      >
        {/* 左側：Tenant 列表 */}
        <div className="flex w-64 flex-shrink-0 flex-col rounded-lg border-2 border-gray-200 bg-gray-50 p-4 shadow-sm">
          <h2 className="mb-3 text-[18px] font-semibold text-gray-800">Tenant</h2>
          {tenantAgentsTenantsLoading ? (
            <div className="flex flex-1 items-center justify-center py-8">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
            </div>
          ) : tenantAgentsTenants.length === 0 ? (
            <p className="py-4 text-[18px] text-gray-500">尚無 tenant</p>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto">
              {tenantAgentsTenants.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedTenantIdForAgents(t.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left text-[18px] transition-colors ${
                      selectedTenantIdForAgents === t.id
                        ? 'bg-gray-600 text-white'
                        : 'bg-white text-gray-800 hover:bg-gray-200'
                    }`}
                  >
                    <div className="truncate font-medium">{t.id}</div>
                    <div className="truncate text-[16px] opacity-80">{t.name}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 右側：該 Tenant 的 Agents */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedTenantIdForAgents == null ? (
            <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
              <p className="text-[18px] text-gray-500">請選擇一個 Tenant</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-[18px] font-semibold text-gray-800">
                  {selectedTenantForAgents?.name ?? selectedTenantIdForAgents} 可使用的 Agent
                </h2>
                <button
                  type="button"
                  onClick={handleTenantAgentsSave}
                  disabled={tenantAgentsSaving}
                  className="rounded-lg px-4 py-2 text-[18px] font-medium text-white shadow-sm disabled:opacity-50"
                  style={{ backgroundColor: '#4b5563' }}
                >
                  {tenantAgentsSaving ? '儲存中...' : '儲存'}
                </button>
              </div>
              {tenantAgentsLoading ? (
                <div className="flex flex-1 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                </div>
              ) : agents.length === 0 ? (
                <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                  <p className="text-[18px] text-gray-500">尚無 Agent 資料，請先在 Agents tab 新增</p>
                </div>
              ) : (
                <>
                  <div className="mb-3 flex gap-2">
                    <button
                      type="button"
                      onClick={selectAllTenantAgents}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[18px] text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
                    >
                      全選
                    </button>
                    <button
                      type="button"
                      onClick={deselectAllTenantAgents}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-[18px] text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
                    >
                      全取消
                    </button>
                  </div>
                  <div className="flex-1 space-y-2 overflow-y-auto">
                    {agents.map((a, index) => {
                      const colors = GROUP_COLORS[index % GROUP_COLORS.length]
                      return (
                        <label
                          key={a.id}
                          className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-[18px] transition-colors hover:bg-gray-50"
                        >
                          <input
                            type="checkbox"
                            checked={tenantAgentIds.has(a.id)}
                            onChange={() => toggleTenantAgent(a.id)}
                            className="h-4 w-4 rounded border-gray-300 text-gray-600 focus:ring-gray-500"
                          />
                          <div
                            className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${colors.iconBg}`}
                          >
                            <AgentIcon
                              iconName={a.icon_name}
                              className={`h-4 w-4 ${colors.iconColor}`}
                            />
                          </div>
                          <span className="text-gray-900">
                            {a.group_name} - {a.agent_name}
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
        )}
      </div>

      <InputModal
        open={tenantFormOpen}
        title={editingId ? '編輯 Tenant' : '新增 Tenant'}
        submitLabel={editingId ? '更新' : '新增'}
        loading={saving}
        onSubmit={handleSubmit}
        onClose={handleCancelEdit}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">ID</label>
            <input
              type="text"
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              disabled={!!editingId}
              placeholder="例：my_company"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">名稱</label>
            <input
              type="text"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="例：我的公司"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>
      </InputModal>

      <ConfirmModal
        open={!!deleteConfirm}
        title="刪除 Tenant"
        message={
          deleteConfirm
            ? `確定要刪除 tenant「${deleteConfirm.tenantId}」？若有關聯使用者將無法刪除。`
            : ''
        }
        confirmText="刪除"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
      <ConfirmModal
        open={!!deleteAgentConfirm}
        title="刪除 Agent"
        message={
          deleteAgentConfirm
            ? `確定要刪除 agent「${deleteAgentConfirm.agentId}」？若有關聯資料將無法刪除。`
            : ''
        }
        confirmText="刪除"
        variant="danger"
        onConfirm={handleAgentDeleteConfirm}
        onCancel={handleAgentDeleteCancel}
      />

      <InputModal
        open={agentFormOpen}
        title={editingAgentId ? '編輯 Agent' : '新增 Agent'}
        submitLabel={editingAgentId ? '更新' : '新增'}
        loading={agentsSaving}
        onSubmit={handleAgentSubmit}
        onClose={handleAgentCancelEdit}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">ID</label>
            <input
              type="text"
              value={agentForm.id}
              onChange={(e) => setAgentForm((f) => ({ ...f, id: e.target.value }))}
              disabled={!!editingAgentId}
              placeholder="例：agent_01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">sort_id</label>
            <input
              type="text"
              value={agentForm.sort_id}
              onChange={(e) => setAgentForm((f) => ({ ...f, sort_id: e.target.value }))}
              placeholder="例：001（影響排序，選填）"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">group_id</label>
            <input
              type="text"
              value={agentForm.group_id}
              onChange={(e) => setAgentForm((f) => ({ ...f, group_id: e.target.value }))}
              placeholder="例：group_1"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">group_name</label>
            <input
              type="text"
              value={agentForm.group_name}
              onChange={(e) => setAgentForm((f) => ({ ...f, group_name: e.target.value }))}
              placeholder="例：業務助理"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">agent_id</label>
            <input
              type="text"
              value={agentForm.agent_id}
              onChange={(e) => setAgentForm((f) => ({ ...f, agent_id: e.target.value }))}
              placeholder="例：agent_01"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">agent_name</label>
            <input
              type="text"
              value={agentForm.agent_name}
              onChange={(e) => setAgentForm((f) => ({ ...f, agent_name: e.target.value }))}
              placeholder="例：銷售助理"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
          <div>
            <label className="mb-1 block text-[18px] text-gray-700">icon_name</label>
            <input
              type="text"
              value={agentForm.icon_name}
              onChange={(e) => setAgentForm((f) => ({ ...f, icon_name: e.target.value }))}
              placeholder="選填"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>
      </InputModal>
    </div>
  )
}
