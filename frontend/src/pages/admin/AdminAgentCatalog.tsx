/** Admin：Agent Catalog 管理（新增 / 修改 / 刪除） */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Edit2, Plus, Trash2, X, ChevronRight, LayoutGrid } from 'lucide-react'
import AgentIcon from '@/components/AgentIcon'
import ConfirmModal from '@/components/ConfirmModal'
import { useToast } from '@/contexts/ToastContext'
import {
  listAgentCatalog,
  createAgentCatalog,
  updateAgentCatalog,
  deleteAgentCatalog,
} from '@/api/agentCatalog'
import type { AgentCatalog } from '@/types'
import { ApiError } from '@/api/client'

const ICON_OPTIONS = [
  'ChartNoAxesCombined', 'MessageCircle', 'Bot', 'FileText', 'Users',
  'Calendar', 'Briefcase', 'ShoppingCart', 'BarChart2', 'Settings',
  'Zap', 'Star', 'Globe', 'Database', 'Cpu',
]

const GROUP_ACCENT_COLORS: Record<string, string> = {
  sales: 'bg-blue-500',
  hr: 'bg-violet-500',
  production: 'bg-amber-500',
  rd: 'bg-teal-500',
  Financial: 'bg-emerald-500',
}

function groupAccent(groupId: string): string {
  return GROUP_ACCENT_COLORS[groupId] ?? 'bg-gray-400'
}

interface FormState {
  id: string
  sort_id: string
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name: string
}

const EMPTY_FORM: FormState = {
  id: '', sort_id: '', group_id: '', group_name: '',
  agent_id: '', agent_name: '', icon_name: 'Bot',
}

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  return err instanceof Error ? err.message : '操作失敗'
}

export default function AdminAgentCatalog() {
  const { showToast } = useToast()
  const [agents, setAgents] = useState<AgentCatalog[]>([])
  const [loading, setLoading] = useState(true)
  const [panelOpen, setPanelOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<AgentCatalog | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AgentCatalog | null>(null)
  const [deleting, setDeleting] = useState(false)
  const firstInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    listAgentCatalog()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (panelOpen) setTimeout(() => firstInputRef.current?.focus(), 80)
  }, [panelOpen])

  const openCreate = useCallback(() => {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setPanelOpen(true)
  }, [])

  const openEdit = useCallback((agent: AgentCatalog) => {
    setEditTarget(agent)
    setForm({
      id: agent.id,
      sort_id: agent.sort_id ?? '',
      group_id: agent.group_id,
      group_name: agent.group_name,
      agent_id: agent.agent_id,
      agent_name: agent.agent_name,
      icon_name: agent.icon_name ?? 'Bot',
    })
    setPanelOpen(true)
  }, [])

  const closePanel = useCallback(() => {
    setPanelOpen(false)
    setEditTarget(null)
    setForm(EMPTY_FORM)
  }, [])

  const setField = (key: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const handleSave = useCallback(async () => {
    if (!form.id.trim() || !form.agent_id.trim() || !form.agent_name.trim() || !form.group_id.trim() || !form.group_name.trim()) {
      showToast('請填寫所有必填欄位', 'error')
      return
    }
    setSaving(true)
    try {
      if (editTarget) {
        await updateAgentCatalog(editTarget.id, {
          sort_id: form.sort_id.trim() || null,
          group_id: form.group_id.trim(),
          group_name: form.group_name.trim(),
          agent_id: form.agent_id.trim(),
          agent_name: form.agent_name.trim(),
          icon_name: form.icon_name.trim() || null,
        })
        showToast('修改成功')
      } else {
        await createAgentCatalog({
          id: form.id.trim(),
          sort_id: form.sort_id.trim() || null,
          group_id: form.group_id.trim(),
          group_name: form.group_name.trim(),
          agent_id: form.agent_id.trim(),
          agent_name: form.agent_name.trim(),
          icon_name: form.icon_name.trim() || null,
        })
        showToast('新增成功')
      }
      load()
      closePanel()
    } catch (err) {
      showToast(getErrorMessage(err), 'error')
    } finally {
      setSaving(false)
    }
  }, [form, editTarget, load, closePanel, showToast])

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteAgentCatalog(deleteTarget.id)
      showToast('已刪除')
      load()
      setDeleteTarget(null)
    } catch (err) {
      showToast(getErrorMessage(err), 'error')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, load, showToast])

  // 依 group_id 分組
  const groups = agents.reduce<Record<string, AgentCatalog[]>>((acc, a) => {
    const key = `${a.group_id}||${a.group_name}`
    if (!acc[key]) acc[key] = []
    acc[key].push(a)
    return acc
  }, {})

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* Page header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Agent 管理</h1>
            <p className="text-sm text-gray-500">管理系統中所有助理的定義與分組</p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-2 rounded-xl bg-gray-800 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700"
        >
          <Plus className="h-4 w-4" />
          新增 Agent
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : agents.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50">
          <LayoutGrid className="h-10 w-10 text-gray-300" />
          <p className="text-gray-400">尚無 Agent，點擊右上角新增</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-6 pr-1">
          {Object.entries(groups).map(([groupKey, groupAgents]) => {
            const [groupId, groupName] = groupKey.split('||')
            return (
              <div key={groupKey}>
                {/* Group header */}
                <div className="mb-2 flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${groupAccent(groupId)}`} />
                  <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                    {groupName} <span className="text-gray-300">/ {groupId}</span>
                  </span>
                </div>
                {/* Agent cards */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {groupAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${groupAccent(groupId)} bg-opacity-15`}>
                        <AgentIcon
                          iconName={agent.icon_name}
                          className={`h-5 w-5 ${groupAccent(groupId).replace('bg-', 'text-')}`}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-gray-900">{agent.agent_name}</p>
                        <p className="truncate text-xs text-gray-400">
                          <span className="font-mono">{agent.agent_id}</span>
                          {agent.sort_id && <span className="ml-2 text-gray-300">#{agent.sort_id}</span>}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => openEdit(agent)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                          aria-label="編輯"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(agent)}
                          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                          aria-label="刪除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <ChevronRight className="h-4 w-4 text-gray-300" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Side Panel Overlay */}
      {panelOpen && (
        <div className="absolute inset-0 z-30 flex" role="dialog" aria-modal="true">
          <div className="flex-1 bg-black/20" onClick={closePanel} />
          <div className="flex w-[26rem] flex-col rounded-l-2xl border-l border-gray-200 bg-white shadow-2xl">
            {/* Panel header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-5">
              <h2 className="text-base font-semibold text-gray-900">
                {editTarget ? '編輯 Agent' : '新增 Agent'}
              </h2>
              <button
                type="button"
                onClick={closePanel}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Form */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              {/* ID（新建才能填） */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  ID <span className="text-red-500">*</span>
                  <span className="ml-1 text-xs font-normal text-gray-400">（建立後不可修改）</span>
                </label>
                <input
                  ref={firstInputRef}
                  type="text"
                  value={form.id}
                  onChange={(e) => setField('id', e.target.value)}
                  disabled={!!editTarget}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:cursor-not-allowed disabled:opacity-60"
                  placeholder="如：22"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Group ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.group_id}
                    onChange={(e) => setField('group_id', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="如：sales"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">
                    Group 名稱 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.group_name}
                    onChange={(e) => setField('group_name', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="如：銷售管理"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Agent ID <span className="text-red-500">*</span>
                  <span className="ml-1 text-xs font-normal text-gray-400">（用於路由識別）</span>
                </label>
                <input
                  type="text"
                  value={form.agent_id}
                  onChange={(e) => setField('agent_id', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 font-mono text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  placeholder="如：business"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700">
                  Agent 名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.agent_name}
                  onChange={(e) => setField('agent_name', e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  placeholder="如：Business Insight Agent"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Sort ID</label>
                  <input
                    type="text"
                    value={form.sort_id}
                    onChange={(e) => setField('sort_id', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                    placeholder="排序用（選填）"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-gray-700">Icon</label>
                  <select
                    value={form.icon_name}
                    onChange={(e) => setField('icon_name', e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 focus:border-gray-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-gray-400"
                  >
                    {ICON_OPTIONS.map((icon) => (
                      <option key={icon} value={icon}>{icon}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Icon preview */}
              <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-800">
                  <AgentIcon iconName={form.icon_name} className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700">{form.agent_name || '（未填名稱）'}</p>
                  <p className="text-xs text-gray-400 font-mono">{form.agent_id || '（未填 Agent ID）'}</p>
                </div>
              </div>
            </div>

            {/* Panel footer */}
            <div className="flex shrink-0 items-center justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={closePanel}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-gray-800 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-gray-700 disabled:opacity-50"
              >
                {saving ? '儲存中…' : editTarget ? '儲存修改' : '新增'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="刪除 Agent"
        message={`確定要刪除「${deleteTarget?.agent_name}」嗎？關聯的權限資料也會一併移除，此操作無法復原。`}
        confirmText={deleting ? '刪除中…' : '刪除'}
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
