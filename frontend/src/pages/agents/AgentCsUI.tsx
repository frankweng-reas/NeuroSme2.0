/**
 * Chat Service Agent UI（agent_id = cs）
 * 三欄式：左=知識庫列表 / 中=文件管理 / 右=測試 Chatbot
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  FileText,
  Headphones,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { chatCompletionsStream } from '@/api/chat'
import { ApiError } from '@/api/client'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKmDocument,
  listKbDocuments,
  listKnowledgeBases,
  updateKnowledgeBase,
  uploadKmDocument,
  type KmDocument,
  type KmKnowledgeBase,
} from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread } from '@/api/chatThreads'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, UserRole } from '@/types'

interface AgentCsUIProps {
  agent: Agent
}

const HEADER_COLOR = '#1A3A52'

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusDot({ status }: { status: KmDocument['status'] }) {
  if (status === 'ready') return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
  if (status === 'processing' || status === 'pending')
    return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-amber-400" />
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
}

function StatusBadge({ status }: { status: KmDocument['status'] }) {
  if (status === 'ready')
    return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-base text-emerald-700">就緒</span>
  if (status === 'processing' || status === 'pending')
    return (
      <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-base text-amber-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />處理中
      </span>
    )
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-base text-red-700">錯誤</span>
}

export default function AgentCsUI({ agent }: AgentCsUIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 使用者角色 ─────────────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'

  useEffect(() => {
    getMe().then((me) => setUserRole(me.role)).catch(() => {})
  }, [])

  // ── 左欄：知識庫列表 ───────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [kbsLoading, setKbsLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)
  const [kbMenuId, setKbMenuId] = useState<number | null>(null)
  const kbMenuRef = useRef<HTMLLIElement | null>(null)

  // 新增 KB
  const [creatingKb, setCreatingKb] = useState(false)
  const [newKbName, setNewKbName] = useState('')
  const [newKbModel, setNewKbModel] = useState('')
  const [newKbSaving, setNewKbSaving] = useState(false)
  const newKbInputRef = useRef<HTMLInputElement>(null)

  // 重命名 KB
  const [renamingKbId, setRenamingKbId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 刪除 KB
  const [deleteKbTarget, setDeleteKbTarget] = useState<KmKnowledgeBase | null>(null)

  // KB 設定 Modal（model + system_prompt）
  const [settingsKb, setSettingsKb] = useState<KmKnowledgeBase | null>(null)
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)

  const loadKbs = useCallback(() => {
    setKbsLoading(true)
    listKnowledgeBases()
      .then((data) => {
        setKbs(data)
        if (data.length > 0 && selectedKbId === null) {
          setSelectedKbId(data[0].id)
        }
      })
      .catch(() => setKbs([]))
      .finally(() => setKbsLoading(false))
  }, [selectedKbId])

  useEffect(() => { loadKbs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 點擊外部關閉 KB menu
  useEffect(() => {
    if (!kbMenuId) return
    const handler = (e: MouseEvent) => {
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node)) {
        setKbMenuId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [kbMenuId])

  useEffect(() => {
    if (creatingKb) newKbInputRef.current?.focus()
  }, [creatingKb])

  useEffect(() => {
    if (renamingKbId) renameInputRef.current?.focus()
  }, [renamingKbId])

  const handleCreateKb = async () => {
    const name = newKbName.trim()
    if (!name) return
    setNewKbSaving(true)
    try {
      const kb = await createKnowledgeBase({ name, model_name: newKbModel })
      setKbs((prev) => [...prev, kb])
      setSelectedKbId(kb.id)
      setCreatingKb(false)
      setNewKbName('')
      setNewKbModel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '建立失敗'
      setErrorModal({ title: '建立知識庫失敗', message: msg })
    } finally {
      setNewKbSaving(false)
    }
  }

  const handleRenameKb = async (id: number) => {
    const name = renameValue.trim()
    if (!name) { setRenamingKbId(null); return }
    try {
      const updated = await updateKnowledgeBase(id, { name })
      setKbs((prev) => prev.map((kb) => kb.id === id ? updated : kb))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新失敗'
      setErrorModal({ title: '更名失敗', message: msg })
    } finally {
      setRenamingKbId(null)
    }
  }

  const handleSaveKbSettings = async () => {
    if (!settingsKb) return
    setSettingsSaving(true)
    try {
      const updated = await updateKnowledgeBase(settingsKb.id, {
        model_name: settingsModel,
        system_prompt: settingsPrompt,
      })
      setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
      setSettingsKb(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '儲存失敗'
      setErrorModal({ title: '儲存設定失敗', message: msg })
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleDeleteKb = async () => {
    if (!deleteKbTarget) return
    try {
      await deleteKnowledgeBase(deleteKbTarget.id)
      setKbs((prev) => prev.filter((kb) => kb.id !== deleteKbTarget.id))
      if (selectedKbId === deleteKbTarget.id) {
        const remaining = kbs.filter((kb) => kb.id !== deleteKbTarget.id)
        setSelectedKbId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '刪除失敗'
      setErrorModal({ title: '刪除失敗', message: msg })
    } finally {
      setDeleteKbTarget(null)
    }
  }

  // ── 中欄：文件管理 ─────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<KmDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [deleteDocTarget, setDeleteDocTarget] = useState<KmDocument | null>(null)
  const [deleteDocLoading, setDeleteDocLoading] = useState(false)

  const loadDocs = useCallback((kbId: number) => {
    setDocsLoading(true)
    listKbDocuments(kbId)
      .then(setDocs)
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false))
  }, [])

  useEffect(() => {
    if (selectedKbId != null) {
      loadDocs(selectedKbId)
      // 切換 KB 時重置對話
      setMessages([])
      createChatThread({ agent_id: agent.id, title: null })
        .then((t) => setThreadId(t.id))
        .catch(() => {})
    } else {
      setDocs([])
    }
  }, [selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!selectedKbId) return
      const files = e.target.files
      if (!files?.length) return
      const file = files[0]
      e.target.value = ''
      setUploading(true)
      setUploadProgress(0)
      try {
        const doc = await uploadKmDocument(file, 'public', (pct) => setUploadProgress(pct), [], selectedKbId)
        setDocs((prev) => [doc, ...prev])
        // 更新 KB doc count
        setKbs((prev) => prev.map((kb) =>
          kb.id === selectedKbId
            ? { ...kb, doc_count: kb.doc_count + 1, ready_count: doc.status === 'ready' ? kb.ready_count + 1 : kb.ready_count }
            : kb
        ))
        showToast(doc.status === 'ready' ? `「${doc.filename}」上傳完成` : `「${doc.filename}」上傳成功，處理中…`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上傳失敗'
        setErrorModal({ title: '上傳失敗', message: msg })
      } finally {
        setUploading(false)
        setUploadProgress(0)
      }
    },
    [selectedKbId]
  )

  const handleDeleteDoc = useCallback(async () => {
    if (!deleteDocTarget || !selectedKbId) return
    setDeleteDocLoading(true)
    try {
      await deleteKmDocument(deleteDocTarget.id)
      setDocs((prev) => prev.filter((d) => d.id !== deleteDocTarget.id))
      setKbs((prev) => prev.map((kb) =>
        kb.id === selectedKbId
          ? {
              ...kb,
              doc_count: Math.max(0, kb.doc_count - 1),
              ready_count: deleteDocTarget.status === 'ready' ? Math.max(0, kb.ready_count - 1) : kb.ready_count,
            }
          : kb
      ))
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '刪除失敗'
      showToast(String(msg), 'error')
    } finally {
      setDeleteDocLoading(false)
      setDeleteDocTarget(null)
    }
  }, [deleteDocTarget, selectedKbId])

  // ── 右欄：Chat ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)

  useEffect(() => {
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [agent.id])

  const latestKbIdRef = useRef(selectedKbId)
  latestKbIdRef.current = selectedKbId

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text || isLoading) return
      const kbId = latestKbIdRef.current

      if (!kbId) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '請先在左側選擇一個知識庫，再開始提問。' },
        ])
        return
      }

      const readyCount = docs.filter((d) => d.status === 'ready').length
      if (readyCount === 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '此知識庫目前沒有可用文件，請先上傳並等待處理完成。' },
        ])
        return
      }

      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setIsLoading(true)
      if (threadId) appendChatMessage(threadId, { role: 'user', content: text }).catch(() => {})

      let assistantText = ''
      const startIdx = messages.length + 1
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      try {
        await chatCompletionsStream(
          {
            agent_id: agent.agent_id,
            prompt_type: 'cs',
            system_prompt: '',
            user_prompt: '',
            data: '',
            model: '',
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            content: text,
            knowledge_base_id: kbId,
            chat_thread_id: threadId ?? '',
          },
          {
            onDelta: (chunk) => {
              assistantText += chunk
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: assistantText }
                return next
              })
            },
            onDone: (done) => {
              const meta: ResponseMeta | undefined =
                done.usage != null
                  ? { model: done.model, usage: done.usage, finish_reason: done.finish_reason }
                  : undefined
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: done.content, meta }
                return next
              })
              if (threadId && done.content)
                appendChatMessage(threadId, { role: 'assistant', content: done.content }).catch(() => {})
            },
            onError: (errMsg) => {
              setMessages((prev) => prev.slice(0, startIdx))
              setErrorModal({ title: '對話發生錯誤', message: errMsg })
            },
          }
        )
      } catch (err) {
        setMessages((prev) => prev.slice(0, startIdx))
        const msg = err instanceof Error ? err.message : '未知錯誤'
        setErrorModal({ title: '對話發生錯誤', message: msg })
      } finally {
        setIsLoading(false)
      }
    },
    [agent.agent_id, isLoading, messages, docs, threadId]
  )

  // ── Toast / ErrorModal ─────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type })
  }, [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null
  const readyCount = docs.filter((d) => d.status === 'ready').length

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg px-4 py-2 text-base text-white shadow-lg ${
            toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'
          }`}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >
          {toast.msg}
        </div>
      )}

      <ErrorModal
        open={errorModal !== null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />

      <ConfirmModal
        open={deleteKbTarget !== null}
        title="刪除知識庫"
        message={`確定要刪除「${deleteKbTarget?.name}」嗎？\n知識庫內的文件不會被刪除，但將失去分類。`}
        confirmText="刪除"
        variant="danger"
        onConfirm={handleDeleteKb}
        onCancel={() => setDeleteKbTarget(null)}
      />

      <ConfirmModal
        open={deleteDocTarget !== null}
        title="刪除文件"
        message={`確定要刪除「${deleteDocTarget?.filename}」嗎？文件與所有切片將永久刪除。`}
        confirmText={deleteDocLoading ? '處理中…' : '刪除'}
        variant="danger"
        onConfirm={() => { if (!deleteDocLoading) void handleDeleteDoc() }}
        onCancel={() => !deleteDocLoading && setDeleteDocTarget(null)}
      />

      <ConfirmModal
        open={showClearConfirm}
        title="確認清除"
        message="確定要清除此段對話嗎？"
        confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => setThreadId(t.id))
            .catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)}
      />

      {/* ── KB 設定 Modal ─────────────────────────────────────────────────── */}
      {settingsKb && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setSettingsKb(null) }}
        >
          <div
            className="flex w-full max-w-md flex-col rounded-xl border border-gray-200 bg-white shadow-xl"
            role="dialog"
            aria-labelledby="kb-settings-title"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 id="kb-settings-title" className="text-base font-semibold text-gray-900">
                知識庫設定 — {settingsKb.name}
              </h2>
              <button
                type="button"
                onClick={() => setSettingsKb(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 px-5 py-4">
              {/* Model 選擇 */}
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                <LLMModelSelect
                  value={settingsModel}
                  onChange={setSettingsModel}
                  label=""
                  labelPosition="stacked"
                  allowEmpty
                  emptyLabel="無"
                  selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                <p className="mt-1 text-base text-gray-400">Widget 將使用此模型，未設定則使用系統預設</p>
              </div>
              {/* System Prompt */}
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">
                  自訂系統提示詞
                  <span className="ml-1 font-normal text-gray-400">（選填，留空使用預設 CS 提示詞）</span>
                </label>
                <textarea
                  value={settingsPrompt}
                  onChange={(e) => setSettingsPrompt(e.target.value)}
                  rows={5}
                  placeholder="你是 XX 公司的客服助手，請根據知識庫文件回答問題…"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 placeholder-gray-300 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setSettingsKb(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 transition-colors hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleSaveKbSettings()}
                disabled={settingsSaving}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
              >
                {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：知識庫列表 ═══════════════════════════════════════════════ */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-60'
          }`}
          style={{ backgroundColor: HEADER_COLOR }}
        >
          {/* Sidebar Header */}
          <div
            className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${
              sidebarCollapsed ? 'px-2' : 'pl-4 pr-2'
            }`}
          >
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開知識庫列表"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Headphones className="h-4 w-4 text-white/70" />
                  <span className="text-base font-semibold text-white">知識庫</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => { setCreatingKb(true); setKbMenuId(null) }}
                      className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                      title="新增知識庫"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(true)}
                    className="rounded-lg px-1 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    title="折疊"
                  >
                    {'<<'}
                  </button>
                </div>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* Create KB inline input */}
              {creatingKb && (
                <div className="shrink-0 border-b border-white/10 px-3 py-2 space-y-1.5">
                  <input
                    ref={newKbInputRef}
                    value={newKbName}
                    onChange={(e) => setNewKbName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleCreateKb()
                      if (e.key === 'Escape') { setCreatingKb(false); setNewKbName(''); setNewKbModel('') }
                    }}
                    placeholder="知識庫名稱…"
                    className="w-full rounded-md bg-white/15 px-2 py-1.5 text-base text-white placeholder-white/40 outline-none focus:bg-white/20"
                    maxLength={100}
                  />
                  <LLMModelSelect
                    value={newKbModel}
                    onChange={setNewKbModel}
                    label=""
                    compact
                    labelPosition="stacked"
                    selectClassName="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-base text-white focus:outline-none focus:border-white/40"
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCreateKb()}
                      disabled={newKbSaving || !newKbName.trim()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-sky-500/40 py-1 text-base font-medium text-white transition-colors hover:bg-sky-500/60 disabled:opacity-50"
                    >
                      {newKbSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      建立
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingKb(false); setNewKbName(''); setNewKbModel('') }}
                      className="rounded-md px-2 py-1 text-base text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* KB List */}
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {kbsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                  </div>
                ) : kbs.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-base leading-relaxed text-white/40">
                      尚無知識庫
                      {canManage && (
                        <>，點擊上方 <Plus className="inline h-3 w-3" /> 新增</>
                      )}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-0.5 px-2">
                    {kbs.map((kb) => (
                      <li
                        key={kb.id}
                        className="relative"
                        ref={kbMenuId === kb.id ? kbMenuRef : undefined}
                      >
                        {renamingKbId === kb.id ? (
                          <div className="rounded-lg bg-white/15 px-2 py-1.5">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleRenameKb(kb.id)
                                if (e.key === 'Escape') setRenamingKbId(null)
                              }}
                              onBlur={() => void handleRenameKb(kb.id)}
                              className="w-full bg-transparent text-base text-white outline-none"
                              maxLength={100}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setSelectedKbId(kb.id); setKbMenuId(null) }}
                            className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                              selectedKbId === kb.id
                                ? 'bg-sky-500/30 text-white'
                                : 'text-white/75 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{kb.name}</span>
                            <span className={`shrink-0 text-base ${selectedKbId === kb.id ? 'text-sky-200/80' : 'text-white/40'}`}>
                              {kb.ready_count}/{kb.doc_count}
                            </span>
                            {canManage && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setKbMenuId(kbMenuId === kb.id ? null : kb.id) }}
                                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20"
                                aria-label="更多操作"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </button>
                        )}

                        {/* KB 操作選單 */}
                        {kbMenuId === kb.id && (
                          <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-lg border border-white/20 bg-[#1a3a52] shadow-xl">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingKbId(kb.id)
                                setRenameValue(kb.name)
                                setKbMenuId(null)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Pencil className="h-3 w-3" />重命名
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSettingsKb(kb)
                                setSettingsModel(kb.model_name ?? '')
                                setSettingsPrompt(kb.system_prompt ?? '')
                                setKbMenuId(null)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Settings className="h-3 w-3" />設定
                            </button>
                            <button
                              type="button"
                              onClick={() => { setDeleteKbTarget(kb); setKbMenuId(null) }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-red-300 transition-colors hover:bg-red-500/20"
                            >
                              <Trash2 className="h-3 w-3" />刪除
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ══ 中欄：文件管理 ═════════════════════════════════════════════════ */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-md">
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="min-w-0 flex-1">
              {selectedKb ? (
                <>
                  <h2 className="truncate text-base font-semibold text-gray-800">{selectedKb.name}</h2>
                  <p className="text-base text-gray-400">
                    {selectedKb.doc_count} 份文件・{selectedKb.ready_count} 份就緒
                  </p>
                </>
              ) : (
                <p className="text-base text-gray-400">請選擇知識庫</p>
              )}
            </div>
            {selectedKbId && (
              <button
                type="button"
                onClick={() => loadDocs(selectedKbId)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="重新整理"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Doc List */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!selectedKbId ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-base text-gray-300">← 選擇知識庫</p>
              </div>
            ) : docsLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
              </div>
            ) : docs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                <FileText className="h-8 w-8 text-gray-200" />
                <p className="text-base text-gray-400">尚無文件</p>
                {canManage && (
                  <p className="text-base text-gray-300">點擊下方「上傳文件」開始建立知識庫</p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
                  >
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium text-gray-700" title={doc.filename}>
                        {doc.filename}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={doc.status} />
                        {doc.chunk_count != null && doc.status === 'ready' && (
                          <span className="text-base text-gray-400">{doc.chunk_count} 段</span>
                        )}
                        {doc.size_bytes != null && (
                          <span className="text-base text-gray-300">{formatBytes(doc.size_bytes)}</span>
                        )}
                      </div>
                      {doc.status === 'error' && doc.error_message && (
                        <p className="mt-0.5 truncate text-base text-red-400">{doc.error_message}</p>
                      )}
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => setDeleteDocTarget(doc)}
                        className="mt-0.5 shrink-0 rounded p-1 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-400"
                        aria-label={`刪除 ${doc.filename}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Upload Area */}
          {canManage && selectedKbId && (
            <div className="shrink-0 border-t border-gray-100 p-3">
              {uploading && uploadProgress > 0 && (
                <div className="mb-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-1.5 rounded-full bg-sky-400 transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50 py-2.5 text-base text-gray-500 transition-colors hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 disabled:opacity-60"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    上傳中 {uploadProgress > 0 ? `${uploadProgress}%` : '…'}
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    上傳文件（PDF / TXT / MD）
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* ══ 右欄：Chatbot ══════════════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* Chat 頂部 KB + model 資訊列 + refresh */}
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            {selectedKb ? (
              <>
                <span className="text-base font-medium text-gray-600 truncate">{selectedKb.name}</span>
                {selectedKb.model_name ? (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-base text-sky-700">
                      {selectedKb.model_name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="shrink-0 text-base text-gray-400">系統預設模型</span>
                  </>
                )}
              </>
            ) : (
              <span className="text-base text-gray-400">請選擇知識庫</span>
            )}
            <button
              type="button"
              onClick={() => messages.length > 0 && setShowClearConfirm(true)}
              disabled={isLoading || messages.length === 0}
              className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              aria-label="清除對話"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
          </div>
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            headerTitle=""
            emptyPlaceholder={
              !selectedKb
                ? '請在左側選擇知識庫後開始提問。'
                : readyCount === 0
                ? `「${selectedKb.name}」尚無可用文件，請先在中間欄上傳並等待處理完成。`
                : `知識庫：${selectedKb.name}（${readyCount} 份可用）\n輸入問題，AI 將從知識庫中搜尋相關資料回答。`
            }
            onCopySuccess={() => showToast('已複製到剪貼簿')}
            onCopyError={() => showToast('複製失敗', 'error')}
            showChart={false}
            showPdf={false}
          />
        </div>

      </div>
    </div>
  )
}
