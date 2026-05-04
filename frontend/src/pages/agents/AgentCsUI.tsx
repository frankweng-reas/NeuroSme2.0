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
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import VoiceInput from '@/components/VoiceInput'
import { transcribeAudio, getSpeechStatus } from '@/api/speech'
import type { Agent, UserRole } from '@/types'
import {
  listWidgetSessions,
  getWidgetSessionMessages,
  type WidgetSessionItem,
  type WidgetSessionDetail,
} from '@/api/widget_admin'
import AgentCsApiKeys from './AgentCsApiKeys'

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

function StatusBadge({ status }: { status: KmDocument['status'] }) {
  if (status === 'ready')
    return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-base text-emerald-700">就緒</span>
  if (status === 'processing' || status === 'pending')
    return (
      <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-base text-amber-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />{status === 'pending' ? '需要重新載入' : '處理中'}
      </span>
    )
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-base text-red-700">錯誤</span>
}

export default function AgentCsUI({ agent }: AgentCsUIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 使用者角色 ─────────────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

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

  // KB 設定 Modal（model + system_prompt + widget）
  const [settingsKb, setSettingsKb] = useState<KmKnowledgeBase | null>(null)
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsWidgetTitle, setSettingsWidgetTitle] = useState('')
  const [settingsWidgetColor, setSettingsWidgetColor] = useState('#1A3A52')
  const [settingsWidgetLang, setSettingsWidgetLang] = useState('zh-TW')
  const [settingsWidgetLogoUrl, setSettingsWidgetLogoUrl] = useState('')
  const [settingsWidgetVoiceEnabled, setSettingsWidgetVoiceEnabled] = useState(false)
  const [settingsWidgetVoicePrompt, setSettingsWidgetVoicePrompt] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [showHelpModal, setShowHelpModal] = useState(false)

  // ── 右欄 Tab：'chat' | 'history' | 'api' ────────────────────────────────
  const [rightTab, setRightTab] = useState<'chat' | 'history' | 'api'>('chat')
  const [wSessions, setWSessions] = useState<WidgetSessionItem[]>([])
  const [wSessionsLoading, setWSessionsLoading] = useState(false)
  const [wDetail, setWDetail] = useState<WidgetSessionDetail | null>(null)
  const [wDetailLoading, setWDetailLoading] = useState(false)

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
        widget_title: settingsWidgetTitle,
        widget_color: settingsWidgetColor,
        widget_lang: settingsWidgetLang,
        widget_logo_url: settingsWidgetLogoUrl || undefined,
        widget_voice_enabled: settingsWidgetVoiceEnabled,
        widget_voice_prompt: settingsWidgetVoicePrompt || undefined,
      })
      setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
      setSettingsKb(null)
      showToast('設定已儲存')
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
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())
  const [docsLoading, setDocsLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadCurrent, setUploadCurrent] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadDocType, setUploadDocType] = useState<string>('article')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [deleteDocTarget, setDeleteDocTarget] = useState<KmDocument | null>(null)
  const [deleteDocLoading, setDeleteDocLoading] = useState(false)

  const storageKey = (kbId: number) => `cs-selected-docs-${kbId}`

  const loadDocs = useCallback((kbId: number) => {
    setDocsLoading(true)
    listKbDocuments(kbId)
      .then((loaded) => {
        setDocs(loaded)
        const readyIds = loaded.filter((d) => d.status === 'ready').map((d) => d.id)
        const saved = localStorage.getItem(storageKey(kbId))
        if (saved) {
          try {
            const parsed: number[] = JSON.parse(saved)
            // 過濾掉已不存在的 doc id（文件可能已被刪除）
            const valid = parsed.filter((id) => readyIds.includes(id))
            setSelectedDocIds(new Set(valid))
          } catch {
            setSelectedDocIds(new Set(readyIds))
          }
        } else {
          setSelectedDocIds(new Set(readyIds))
        }
      })
      .catch(() => { setDocs([]); setSelectedDocIds(new Set()) })
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
      const fileList = Array.from(files)
      e.target.value = ''

      setUploading(true)
      setUploadTotal(fileList.length)
      setUploadCurrent(0)

      let successCount = 0
      let errorCount = 0

      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i]
        setUploadCurrent(i + 1)
        setUploadProgress(0)

        // 依檔名自動偵測文件類型（僅在使用者未明確選擇類型時套用）
        const lower = file.name.toLowerCase()
        let detectedType = uploadDocType
        if (uploadDocType === 'article') {
          if (/faq|q[&＆]a|問答/.test(lower)) detectedType = 'faq'
          else if (/spec|規格|technical|datasheet/.test(lower)) detectedType = 'spec'
          else if (/policy|政策|條款|terms|contract/.test(lower)) detectedType = 'policy'
        }

        try {
          const doc = await uploadKmDocument(file, 'public', (pct) => setUploadProgress(pct), [], selectedKbId, detectedType)
          setDocs((prev) => [doc, ...prev])
          if (doc.status === 'ready') setSelectedDocIds((prev) => new Set([...prev, doc.id]))
          setKbs((prev) => prev.map((kb) =>
            kb.id === selectedKbId
              ? { ...kb, doc_count: kb.doc_count + 1, ready_count: doc.status === 'ready' ? kb.ready_count + 1 : kb.ready_count }
              : kb
          ))
          successCount++
        } catch (err) {
          errorCount++
          const msg = err instanceof Error ? err.message : '上傳失敗'
          setErrorModal({ title: `「${file.name}」上傳失敗`, message: msg })
        }
      }

      setUploading(false)
      setUploadProgress(0)
      setUploadCurrent(0)
      setUploadTotal(0)

      if (fileList.length > 1) {
        showToast(errorCount === 0
          ? `${successCount} 個檔案上傳完成`
          : `完成 ${successCount} 個，失敗 ${errorCount} 個`)
      } else if (successCount === 1) {
        showToast('上傳完成')
      }
      setUploadModalOpen(false)
    },
    [selectedKbId, uploadDocType]
  )

  const handleDeleteDoc = useCallback(async () => {
    if (!deleteDocTarget || !selectedKbId) return
    setDeleteDocLoading(true)
    try {
      await deleteKmDocument(deleteDocTarget.id)
      setDocs((prev) => prev.filter((d) => d.id !== deleteDocTarget.id))
      setSelectedDocIds((prev) => { const next = new Set(prev); next.delete(deleteDocTarget.id); return next })
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
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceAutoSendText, setVoiceAutoSendText] = useState('')
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

      if (selectedDocIds.size === 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '目前沒有勾選任何文件，請至少勾選一份文件後再提問。' },
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
            selected_doc_ids: [...selectedDocIds],
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
                if (next[startIdx]) next[startIdx] = {
                  ...next[startIdx],
                  content: done.content,
                  meta,
                  sources: done.sources?.length ? done.sources : undefined,
                }
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
    [agent.agent_id, isLoading, messages, docs, selectedDocIds, threadId]
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

  // 切換到 history tab 時載入 sessions
  useEffect(() => {
    if (rightTab !== 'history' || !selectedKb) return
    setWSessionsLoading(true)
    setWDetail(null)
    listWidgetSessions(selectedKb.id)
      .then(setWSessions)
      .catch(() => setWSessions([]))
      .finally(() => setWSessionsLoading(false))
  }, [rightTab, selectedKb])

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

      {/* ── 上傳檔案 Modal ──────────────────────────────────────────────────── */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-sky-500" />
                <span className="text-lg font-semibold text-gray-800">上傳檔案</span>
              </div>
              <button
                type="button"
                onClick={() => !uploading && setUploadModalOpen(false)}
                disabled={uploading}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-6 space-y-6">
              {/* 文件類型 Radio */}
              <div>
                <p className="mb-1 text-base font-semibold text-gray-700">文件類型</p>
                <p className="mb-3 text-sm text-gray-400">智能文檔處理可提昇搜尋準確度，請選擇適合類型</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'article',   emoji: '📄', label: '一般文章', sub: '說明文件、公告' },
                    { value: 'faq',       emoji: '💬', label: 'FAQ 問答集', sub: '常見問題、Q&A' },
                    { value: 'spec',      emoji: '🔧', label: '技術規格', sub: '參數表、Datasheet' },
                    { value: 'policy',    emoji: '📋', label: '政策 / 條款', sub: '合約、規章' },
                    { value: 'reference', emoji: '📑', label: '參考資料', sub: '菜單、價目表、術語表、組織表' },
                  ] as const).map(({ value, emoji, label, sub }) => (
                    <button
                      key={value}
                      type="button"
                      disabled={uploading}
                      onClick={() => setUploadDocType(value)}
                      className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all disabled:opacity-60 ${
                        uploadDocType === value
                          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                          : 'border-gray-200 bg-gray-50 hover:border-sky-200 hover:bg-sky-50/50'
                      }`}
                    >
                      <span className="mt-0.5 text-2xl leading-none">{emoji}</span>
                      <div>
                        <p className={`text-base font-medium ${uploadDocType === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</p>
                        <p className="text-sm text-gray-400">{sub}</p>
                      </div>
                      {uploadDocType === value && (
                        <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* 進度條 */}
              {uploading && (
                <div className="space-y-1">
                  {uploadTotal > 1 && (
                    <p className="text-sm text-gray-500 text-center">
                      處理中 {uploadCurrent}/{uploadTotal}：{Array.from(Array(uploadTotal)).map((_, i) => (
                        <span key={i} className={`inline-block mx-0.5 h-2 w-2 rounded-full ${i < uploadCurrent - 1 ? 'bg-sky-400' : i === uploadCurrent - 1 ? 'bg-sky-500' : 'bg-gray-200'}`} />
                      ))}
                    </p>
                  )}
                  <div className="overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-sky-400 transition-all"
                      style={{ width: `${uploadProgress > 0 ? uploadProgress : 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 隱藏 input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {/* 上傳按鈕 */}
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-6 text-base font-medium text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: HEADER_COLOR }}
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    {uploadTotal > 1
                      ? `上傳中 (${uploadCurrent}/${uploadTotal}) ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}`
                      : `上傳中 ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}`}
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    點擊選擇檔案（可多選，PDF / TXT / MD）
                  </>
                )}
              </button>
            </div>
          </div>
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
        message={`確定要刪除「${deleteKbTarget?.name}」嗎？\n知識庫內的所有文件也將一併刪除，此操作無法復原。`}
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
      {settingsKb && (() => {
        return (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
        >
          <div
            className="flex w-full max-w-5xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl max-h-[90vh]"
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
            <div className="space-y-4 overflow-y-auto px-5 py-4">
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
                  rows={8}
                  placeholder="你是 XX 公司的客服助手，請根據知識庫文件回答問題…"
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
                />
              </div>
              {/* ── Widget 設定 ── */}
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-3 text-base font-semibold text-gray-700">Widget 設定</p>
                {/* Logo 上傳 */}
                <div className="mb-3">
                  <label className="mb-1 block text-base font-medium text-gray-700">Logo</label>
                  <div className="flex items-center gap-4">
                    {settingsWidgetLogoUrl ? (
                      <img
                        src={settingsWidgetLogoUrl}
                        alt="logo preview"
                        className="h-12 w-12 rounded-lg border border-gray-200 object-contain p-0.5"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 text-gray-400">
                        <span className="text-xs">無</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 hover:bg-gray-50">
                        選擇圖片
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (!file) return
                            const reader = new FileReader()
                            reader.onload = (ev) => {
                              setSettingsWidgetLogoUrl(ev.target?.result as string ?? '')
                            }
                            reader.readAsDataURL(file)
                          }}
                        />
                      </label>
                      {settingsWidgetLogoUrl && (
                        <button
                          type="button"
                          onClick={() => setSettingsWidgetLogoUrl('')}
                          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-base text-red-500 hover:bg-red-50"
                        >
                          移除
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-gray-400">建議 PNG／SVG，正方形，&lt;200 KB</p>
                  </div>
                </div>
                <div className="mb-3">
                  <label className="mb-1 block text-base font-medium text-gray-700">Widget 顯示名稱</label>
                  <input
                    type="text"
                    value={settingsWidgetTitle}
                    onChange={(e) => setSettingsWidgetTitle(e.target.value)}
                    placeholder={settingsKb?.name ?? ''}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
                <div className="mb-3 flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-base font-medium text-gray-700">主色</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={settingsWidgetColor}
                        onChange={(e) => setSettingsWidgetColor(e.target.value)}
                        className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5"
                      />
                      <input
                        type="text"
                        value={settingsWidgetColor}
                        onChange={(e) => setSettingsWidgetColor(e.target.value)}
                        className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  </div>
                  <div className="w-40">
                    <label className="mb-1 block text-base font-medium text-gray-700">語言</label>
                    <select
                      value={settingsWidgetLang}
                      onChange={(e) => setSettingsWidgetLang(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    >
                      <option value="zh-TW">繁中</option>
                      <option value="zh-CN">簡中</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                    </select>
                  </div>
                </div>
                <hr className="border-gray-200" />
                <div className="mb-3">
                  <label className="flex cursor-pointer items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={settingsWidgetVoiceEnabled}
                      onChange={(e) => setSettingsWidgetVoiceEnabled(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 accent-sky-500"
                    />
                    <span className="text-base font-medium text-gray-700">啟用語音</span>
                    <span className="text-sm text-gray-400">（顯示麥克風按鈕）</span>
                  </label>
                  {settingsWidgetVoiceEnabled && (
                    <div className="mt-2">
                      <label className="mb-1 block text-base font-medium text-gray-700">
                        語音辨識提示詞
                        <span className="ml-1 font-normal text-gray-400">（選填：列出業務常見詞彙，提升辨識準確率）</span>
                      </label>
                      <textarea
                        value={settingsWidgetVoicePrompt}
                        onChange={(e) => setSettingsWidgetVoicePrompt(e.target.value)}
                        rows={3}
                        placeholder={`例：常見詞彙：專有名詞A、專有名詞B、產品名稱...`}
                        className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      />
                    </div>
                  )}
                </div>
                <hr className="border-gray-200" />
                <div>
                  <label className="mb-1 block text-base font-medium text-gray-700">Widget 連結</label>
                  {settingsKb?.public_token ? (
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={`${window.location.origin}/widget/${settingsKb.public_token}`}
                        className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base font-mono text-gray-700 focus:outline-none"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(`${window.location.origin}/widget/${settingsKb.public_token}`)
                          showToast('連結已複製')
                        }}
                        className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-700 hover:bg-gray-50"
                      >
                        複製
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">
                      尚未開通，請至管理後台（設定 › Widget 管理）開通
                      {isAdmin && (
                        <a href="/admin/widget-management" className="ml-1 text-sky-600 hover:underline">前往</a>
                      )}
                    </p>
                  )}
                </div>
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
        )
      })()}

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：知識庫列表 ═══════════════════════════════════════════════ */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-80'
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
                      if (e.nativeEvent.isComposing) return
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
                                if (e.nativeEvent.isComposing) return
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
                                setSettingsWidgetTitle(kb.widget_title ?? '')
                                setSettingsWidgetColor(kb.widget_color ?? '#1A3A52')
                                setSettingsWidgetLang(kb.widget_lang ?? 'zh-TW')
                                setSettingsWidgetLogoUrl(kb.widget_logo_url ?? '')
                                setSettingsWidgetVoiceEnabled(kb.widget_voice_enabled ?? false)
                                setSettingsWidgetVoicePrompt(kb.widget_voice_prompt ?? '')
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
              <>
                {(() => {
                  const readyIds = docs.filter((d) => d.status === 'ready').map((d) => d.id)
                  const allSelected = readyIds.length > 0 && readyIds.every((id) => selectedDocIds.has(id))
                  const toggleAll = (select: boolean) => {
                    const next = select ? new Set(readyIds) : new Set<number>()
                    setSelectedDocIds(next)
                    if (selectedKbId != null)
                      localStorage.setItem(storageKey(selectedKbId), JSON.stringify([...next]))
                  }
                  return readyIds.length > 0 ? (
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
                      <span className="flex-1 text-base text-gray-400">
                        已選 {selectedDocIds.size} / {readyIds.length} 份
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleAll(true)}
                        disabled={allSelected}
                        className="rounded px-2 py-0.5 text-base text-sky-600 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        全選
                      </button>
                      <span className="text-gray-200">|</span>
                      <button
                        type="button"
                        onClick={() => toggleAll(false)}
                        disabled={selectedDocIds.size === 0}
                        className="rounded px-2 py-0.5 text-base text-gray-500 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        全不選
                      </button>
                    </div>
                  ) : null
                })()}
              <ul className="divide-y divide-gray-50">
                {docs.map((doc) => (
                  <li
                    key={doc.id}
                    className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50"
                  >
                    {doc.status === 'ready' ? (
                      <input
                        type="checkbox"
                        checked={selectedDocIds.has(doc.id)}
                        onChange={(e) => setSelectedDocIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(doc.id)
                          else next.delete(doc.id)
                          if (selectedKbId != null)
                            localStorage.setItem(storageKey(selectedKbId), JSON.stringify([...next]))
                          return next
                        })}
                        className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500"
                        aria-label={`勾選 ${doc.filename}`}
                      />
                    ) : (
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-all text-base font-medium text-gray-700" title={doc.filename}>
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
                        className="mt-0.5 shrink-0 rounded p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-400"
                        aria-label={`刪除 ${doc.filename}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              </>
            )}
          </div>

          {/* Upload Area */}
          {canManage && selectedKbId && (
            <div className="shrink-0 border-t border-gray-100 p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,.md,.markdown"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                onClick={() => setUploadModalOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-base font-medium text-white transition-opacity hover:opacity-90 active:opacity-80"
                style={{ backgroundColor: HEADER_COLOR }}
              >
                <Upload className="h-4 w-4" />
                上傳檔案
              </button>
            </div>
          )}
        </div>

        {/* ══ 右欄：Chatbot / 訪客對話 ══════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* Tab 切換 */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            <button
              type="button"
              onClick={() => setRightTab('chat')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'chat' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              內部對話
            </button>
            <button
              type="button"
              onClick={() => setRightTab('history')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'history' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              訪客對話
            </button>
            <button
              type="button"
              onClick={() => setRightTab('api')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'api' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              API 整合
            </button>
            {rightTab === 'chat' && (
              <>
                <span className="mx-1 text-gray-200">|</span>
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
              </>
            )}
            {rightTab === 'history' && selectedKb && (
              <button
                type="button"
                onClick={() => {
                  setWSessionsLoading(true)
                  setWDetail(null)
                  listWidgetSessions(selectedKb.id)
                    .then(setWSessions)
                    .catch(() => setWSessions([]))
                    .finally(() => setWSessionsLoading(false))
                }}
                className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50"
                aria-label="重新整理"
              >
                <RefreshCw className="h-5 w-5" />
              </button>
            )}
          </div>

          {/* ── 內部對話 ── */}
          {rightTab === 'chat' && (
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
            composerLeading={
              <VoiceInput
                transcribe={(blob, filename, lang) =>
                  transcribeAudio(blob, filename, lang, selectedKb?.widget_voice_prompt ?? undefined).then((r) => r.text)
                }
                checkStatus={getSpeechStatus}
                onTranscript={(text, autoSend) => {
                  if (autoSend) {
                    setVoiceAutoSendText(text)
                    setTimeout(() => setVoiceAutoSendText(''), 50)
                  } else {
                    setVoiceTranscript(text)
                    setTimeout(() => setVoiceTranscript(''), 50)
                  }
                }}
                onError={(msg) => showToast(msg, 'error')}
                disabled={isLoading}
              />
            }
            appendInputText={voiceTranscript}
            appendAndSendText={voiceAutoSendText}
          />
          )}

          {/* ── 訪客對話 ── */}
          {rightTab === 'history' && (            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* session 列表 */}
              <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-100">
                {!selectedKb ? (
                  <p className="p-4 text-base text-gray-400">請先選擇知識庫</p>
                ) : wSessionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                  </div>
                ) : wSessions.length === 0 ? (
                  <p className="p-4 text-base text-gray-400">尚無訪客對話紀錄</p>
                ) : (
                  <ul>
                    {wSessions.map((s) => (
                      <li key={s.session_id}>
                        <button
                          type="button"
                          onClick={() => {
                            setWDetailLoading(true)
                            getWidgetSessionMessages(s.session_id)
                              .then(setWDetail)
                              .catch(() => setWDetail(null))
                              .finally(() => setWDetailLoading(false))
                          }}
                          className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${wDetail?.session_id === s.session_id ? 'bg-sky-50' : ''}`}
                        >
                          <p className="truncate text-base font-medium text-gray-700">
                            {s.visitor_name || '匿名訪客'}
                          </p>
                          {s.visitor_email && (
                            <p className="truncate text-sm text-gray-400">{s.visitor_email}</p>
                          )}
                          <p className="mt-0.5 text-sm text-gray-400">
                            {s.message_count} 則 · {new Date(s.last_active_at).toLocaleDateString('zh-TW')}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 對話內容 */}
              <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
                {wDetailLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                  </div>
                ) : !wDetail ? (
                  <p className="text-base text-gray-400">← 點選左側訪客查看對話</p>
                ) : (
                  <>
                    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm text-gray-600">
                      <p><span className="font-medium">訪客：</span>{wDetail.visitor_name || '匿名'}</p>
                      {wDetail.visitor_email && <p><span className="font-medium">Email：</span>{wDetail.visitor_email}</p>}
                      {wDetail.visitor_phone && <p><span className="font-medium">電話：</span>{wDetail.visitor_phone}</p>}
                      <p><span className="font-medium">開始時間：</span>{new Date(wDetail.created_at).toLocaleString('zh-TW')}</p>
                    </div>
                    <ul className="space-y-3">
                      {wDetail.messages.map((m) => (
                        <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div
                            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
                              m.role === 'user'
                                ? 'bg-sky-600 text-white'
                                : 'bg-gray-100 text-gray-800'
                            }`}
                          >
                            {m.content}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {/* ── API 整合 ── */}
          {rightTab === 'api' && (
            <AgentCsApiKeys canManage={canManage} kbs={kbs} selectedKbId={selectedKbId} />
          )}
        </div>

      </div>
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-cs-agent.md"
        title="客服助理使用說明"
      />
    </div>
  )
}
