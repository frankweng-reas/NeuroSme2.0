/**
 * AI 知識庫 Agent UI（agent_id 含 knowledge）
 * 左側：知識庫文件管理（公共 + 個人）
 * 右側：RAG Chat + AI 設定
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Check,
  ChevronRight,
  ChevronsRight,
  Globe,
  HelpCircle,
  Loader2,
  Lock,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletionsStream } from '@/api/chat'
import { ApiError } from '@/api/client'
import { deleteKmDocument, listKmDocuments, uploadKmDocument, type KmDocument } from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread } from '@/api/chatThreads'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import AISettingsPanelAdvanced from '@/components/AISettingsPanelAdvanced'
import AISettingsPanelBasic from '@/components/AISettingsPanelBasic'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import { DETAIL_OPTIONS, LANGUAGE_OPTIONS, ROLE_OPTIONS } from '@/constants/aiOptions'
import type { Agent, UserRole } from '@/types'

interface AgentKmUIProps {
  agent: Agent
}

const HEADER_COLOR = '#1C3939'

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <Separator
      className={`flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${className}`}
    >
      <div className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80" aria-hidden />
    </Separator>
  )
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusBadge({ status }: { status: KmDocument['status'] }) {
  if (status === 'ready')
    return <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-700">就緒</span>
  if (status === 'processing' || status === 'pending')
    return (
      <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        {status === 'pending' ? '需要重新載入' : '處理中'}
      </span>
    )
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[11px] text-red-700">錯誤</span>
}

function buildUserPromptPrefix(settings: {
  role: string
  language: string
  detailLevel: string
  exampleQuestionsCount: string
  userPrompt: string
}): string {
  const parts: string[] = []
  const roleOpt = ROLE_OPTIONS.find((o) => o.value === settings.role)
  const langOpt = LANGUAGE_OPTIONS.find((o) => o.value === settings.language)
  const detailOpt = DETAIL_OPTIONS.find((o) => o.value === settings.detailLevel)
  if (roleOpt) parts.push(roleOpt.prompt)
  if (langOpt) parts.push(langOpt.prompt)
  if (detailOpt) parts.push(detailOpt.prompt)
  const n = parseInt(settings.exampleQuestionsCount, 10)
  if (n > 0) parts.push(`回覆結尾請提供 ${n} 個建議追問的問題。`)
  if (settings.userPrompt.trim()) parts.push(settings.userPrompt.trim())
  return parts.join(' ')
}

export default function AgentKmUI({ agent }: AgentKmUIProps) {
  const aiPanelRef = useRef<PanelImperativeHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 左側面板 ──────────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── 文件管理 ──────────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<KmDocument[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadCurrent, setUploadCurrent] = useState(0)
  const [uploadTotal, setUploadTotal] = useState(0)
  const [uploadScope, setUploadScope] = useState<'private' | 'public'>('private')
  const [uploadDocType, setUploadDocType] = useState<string>('article')
  const [uploadModalOpen, setUploadModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<KmDocument | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── 使用者角色（控制公共上傳權限）────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole>('member')

  useEffect(() => {
    getMe().then((me) => setUserRole(me.role)).catch(() => {})
  }, [])

  const canUploadPublic = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'

  // ── 勾選的文件（個人 default check，公共 default uncheck）────────────────
  const [selectedDocIds, setSelectedDocIds] = useState<Set<number>>(new Set())

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [showHelpModal, setShowHelpModal] = useState(false)

  // 進入頁面時自動建立 thread（用於後端儲存對話紀錄）
  useEffect(() => {
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [agent.id])

  // ── AI 設定 ───────────────────────────────────────────────────────────────
  const [model, setModel] = useState('') 
  const [language, setLanguage] = useState('zh-TW')
  const [detailLevel, setDetailLevel] = useState('brief')
  const [exampleQuestionsCount, setExampleQuestionsCount] = useState('0')
  const [userPrompt, setUserPrompt] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null)

  // ── Toast ─────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)

  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => {
    setToast({ msg, type })
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  // ── 錯誤 Modal ────────────────────────────────────────────────────────────
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  // ── 載入文件 ──────────────────────────────────────────────────────────────
  const loadDocs = useCallback(() => {
    setDocsLoading(true)
    listKmDocuments(undefined, true)
      .then((data) => {
        setDocs(data)
        // 個人文件 default check，公共文件 default uncheck
        setSelectedDocIds((prev) => {
          const next = new Set(prev)
          data.forEach((d) => {
            if (d.scope === 'private' && !next.has(d.id)) next.add(d.id)
          })
          return next
        })
      })
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false))
  }, [])

  useEffect(() => {
    loadDocs()
  }, [loadDocs])

  // ── 上傳 ──────────────────────────────────────────────────────────────────
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
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

        // 依檔名自動偵測文件類型
        const lower = file.name.toLowerCase()
        let detectedType = uploadDocType
        if (/faq|q[&＆]a|問答/.test(lower)) detectedType = 'faq'
        else if (/spec|規格|technical|datasheet/.test(lower)) detectedType = 'spec'
        else if (/policy|政策|條款|terms|contract/.test(lower)) detectedType = 'policy'

        try {
          const doc = await uploadKmDocument(file, uploadScope, (pct) => setUploadProgress(pct), [], undefined, detectedType)
          setDocs((prev) => [doc, ...prev])
          if (doc.scope === 'private') {
            setSelectedDocIds((prev) => new Set([...prev, doc.id]))
          }
          successCount++
          if (doc.status === 'error') {
            setErrorModal({
              title: '文件處理失敗',
              message: `「${doc.filename}」\n\n${doc.error_message ?? '未知錯誤'}`,
            })
          }
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
    [uploadScope, uploadDocType, showToast]
  )

  // ── 刪除 ──────────────────────────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteKmDocument(deleteTarget.id)
      setDocs((prev) => prev.filter((d) => d.id !== deleteTarget.id))
      setSelectedDocIds((prev) => { const next = new Set(prev); next.delete(deleteTarget.id); return next })
      showToast(`「${deleteTarget.filename}」已刪除`)
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '刪除失敗'
      showToast(String(msg), 'error')
    } finally {
      setDeleteLoading(false)
      setDeleteTarget(null)
    }
  }, [deleteTarget, showToast])

  // ── 最新設定 ref（避免 stale closure）────────────────────────────────────
  const latestRef = useRef({ model, language, detailLevel, exampleQuestionsCount, userPrompt })
  latestRef.current = { model, language, detailLevel, exampleQuestionsCount, userPrompt }

  // ── 全選 / 全不選 ─────────────────────────────────────────────────────────
  const readyDocs = docs.filter((d) => d.status === 'ready')
  const allSelected = readyDocs.length > 0 && readyDocs.every((d) => selectedDocIds.has(d.id))

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedDocIds(new Set())
    } else {
      setSelectedDocIds(new Set(readyDocs.map((d) => d.id)))
    }
  }, [allSelected, readyDocs])

  // ── 傳送訊息 ──────────────────────────────────────────────────────────────
  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text || isLoading) return

      const readyCount = docs.filter((d) => d.status === 'ready').length
      if (readyCount === 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '知識庫目前沒有可用文件，請先上傳並等待處理完成後再提問。' },
        ])
        return
      }

      const s = latestRef.current
      const userPromptPrefix = buildUserPromptPrefix({
        role: '',
        language: s.language,
        detailLevel: s.detailLevel,
        exampleQuestionsCount: s.exampleQuestionsCount,
        userPrompt: s.userPrompt,
      })

      setMessages((prev) => [...prev, { role: 'user', content: text }])
      setIsLoading(true)

      // 儲存 user 訊息到 thread（monitoring 用）
      if (threadId) {
        appendChatMessage(threadId, { role: 'user', content: text }).catch(() => {})
      }

      let assistantText = ''
      const startIdx = messages.length + 1

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      try {
        await chatCompletionsStream(
          {
            agent_id: agent.agent_id,
            prompt_type: 'knowledge',
            system_prompt: '',
            user_prompt: userPromptPrefix,
            data: '',
            model: s.model,
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            content: text,
            selected_doc_ids: selectedDocIds.size > 0 ? [...selectedDocIds] : [],
            chat_thread_id: threadId ?? '',
          },
          {
            onDelta: (chunk) => {
              assistantText += chunk
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) {
                  next[startIdx] = { ...next[startIdx], content: assistantText }
                }
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
                if (next[startIdx]) {
                  next[startIdx] = { ...next[startIdx], content: done.content, meta }
                }
                return next
              })
              // 儲存 assistant 回覆到 thread（monitoring 用）
              if (threadId && done.content) {
                appendChatMessage(threadId, { role: 'assistant', content: done.content }).catch(() => {})
              }
            },
            onError: (msg) => {
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) {
                  next[startIdx] = { ...next[startIdx], content: `錯誤：${msg}` }
                }
                return next
              })
            },
          }
        )
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知錯誤'
        setMessages((prev) => {
          const next = [...prev]
          if (next[startIdx]) {
            next[startIdx] = { ...next[startIdx], content: `錯誤：${msg}` }
          }
          return next
        })
      } finally {
        setIsLoading(false)
      }
    },
    [agent.agent_id, isLoading, messages, docs, selectedDocIds, threadId]
  )

  const readyCount = docs.filter((d) => d.status === 'ready').length
  const selectedReadyCount = docs.filter((d) => d.status === 'ready' && selectedDocIds.has(d.id)).length

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

      <ConfirmModal
        open={showClearConfirm}
        title="確認清除"
        message="確定要清除所有對話嗎？"
        confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          // 清除對話時建立新 thread
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => setThreadId(t.id))
            .catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)}
      />

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
              {/* 上傳範圍 Scope toggle（只有 admin/manager 可見） */}
              {canUploadPublic && (
                <div>
                  <p className="mb-2 text-base font-semibold text-gray-700">上傳範圍</p>
                  <div className="flex gap-3">
                    {([
                      { value: 'private' as const, icon: <Lock className="h-4 w-4" />, label: '個人文件', sub: '僅自己可見' },
                      { value: 'public'  as const, icon: <Globe className="h-4 w-4" />, label: '公共文件', sub: '所有人可查詢' },
                    ]).map(({ value, icon, label, sub }) => (
                      <button
                        key={value}
                        type="button"
                        disabled={uploading}
                        onClick={() => setUploadScope(value)}
                        className={`flex flex-1 items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all disabled:opacity-60 ${
                          uploadScope === value
                            ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                            : 'border-gray-200 bg-gray-50 hover:border-sky-200 hover:bg-sky-50/50'
                        }`}
                      >
                        <span className={uploadScope === value ? 'text-sky-500' : 'text-gray-400'}>{icon}</span>
                        <div>
                          <p className={`text-base font-medium ${uploadScope === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</p>
                          <p className="text-sm text-gray-400">{sub}</p>
                        </div>
                        {uploadScope === value && <Check className="ml-auto h-4 w-4 shrink-0 text-sky-500" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                      {uploadDocType === value && <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
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
        open={deleteTarget !== null}
        title="刪除文件"
        message={`確定要刪除「${deleteTarget?.filename}」嗎？文件與所有切片將永久刪除。`}
        confirmText={deleteLoading ? '處理中…' : '刪除'}
        variant="danger"
        onConfirm={() => { if (!deleteLoading) void handleDeleteConfirm() }}
        onCancel={() => !deleteLoading && setDeleteTarget(null)}
      />

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* ── 左側：知識庫文件管理 ─────────────────────────────────────────── */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-72'
          }`}
          style={{ backgroundColor: HEADER_COLOR }}
        >
          {/* Sidebar Header */}
          <div
            className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${
              sidebarCollapsed ? 'px-2' : 'pl-4 pr-3'
            }`}
          >
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開知識庫"
                aria-label="展開知識庫"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-white/80" />
                  <h3 className="text-base font-semibold text-white">知識庫</h3>
                  {readyCount > 0 && (
                    <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[11px] text-emerald-300">
                      {readyCount}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                  title="折疊"
                  aria-label="折疊知識庫"
                >
                  {'<<'}
                </button>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <>
              {/* 全選 / 全不選 */}
              {readyCount > 0 && (
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-1.5">
                  <span className="text-[11px] text-white/50">
                    已勾選 {selectedReadyCount} / {readyCount}
                  </span>
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-[11px] text-white/60 transition-colors hover:text-white/90"
                  >
                    {allSelected ? '全不選' : '全選'}
                  </button>
                </div>
              )}

              {/* Document List */}
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {docsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                  </div>
                ) : docs.length === 0 ? (
                  <p className="px-2 py-4 text-center text-xs text-white/50">尚無文件</p>
                ) : (
                  <ul className="space-y-0.5">
                    {docs.map((doc) => (
                      <li
                        key={doc.id}
                        className="group flex items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-white/10"
                      >
                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={selectedDocIds.has(doc.id)}
                          disabled={doc.status !== 'ready'}
                          onChange={(e) => {
                            setSelectedDocIds((prev) => {
                              const next = new Set(prev)
                              if (e.target.checked) next.add(doc.id)
                              else next.delete(doc.id)
                              return next
                            })
                          }}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-emerald-400 disabled:opacity-30"
                          aria-label={`選取 ${doc.filename}`}
                        />
                        {/* Scope icon */}
                        {doc.scope === 'private'
                          ? <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-white/40" />
                          : <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-400/70" />
                        }
                        {/* File info */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-base text-white" title={doc.filename}>
                            {doc.filename}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            <StatusBadge status={doc.status} />
                            {doc.chunk_count != null && doc.status === 'ready' && (
                              <span className="text-[11px] text-white/50">{doc.chunk_count} 段</span>
                            )}
                            {doc.size_bytes != null && (
                              <span className="text-[11px] text-white/40">{formatBytes(doc.size_bytes)}</span>
                            )}
                          </div>
                          {doc.status === 'error' && doc.error_message && (
                            <p className="mt-0.5 truncate text-[11px] text-red-300" title={doc.error_message}>
                              {doc.error_message}
                            </p>
                          )}
                        </div>
                        {/* Delete */}
                        <button
                          type="button"
                          onClick={() => {
                            if (doc.scope === 'public' && userRole !== 'admin' && userRole !== 'super_admin') {
                              setErrorModal({ title: '無法刪除', message: '公共文件只有管理員可以刪除。' })
                              return
                            }
                            setDeleteTarget(doc)
                          }}
                          className="shrink-0 rounded p-1 text-white/40 opacity-0 transition-colors group-hover:opacity-100 hover:bg-white/15 hover:text-red-300"
                          aria-label={`刪除 ${doc.filename}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Upload Controls */}
              <div className="shrink-0 border-t border-white/20 p-3">
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
                <button
                  type="button"
                  onClick={loadDocs}
                  className="mt-1 flex w-full items-center justify-center gap-1 py-1 text-[11px] text-white/40 transition-colors hover:text-white/70"
                >
                  <RefreshCw className="h-3 w-3" />
                  重新整理
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── 主體：Chat + AI 設定 ──────────────────────────────────────────── */}
        <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1">
          <Panel
            defaultSize={50}
            minSize="600px"
            className="flex flex-col rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
          >
            <AgentChat
              messages={messages}
              onSubmit={handleSendMessage}
              isLoading={isLoading}
              emptyPlaceholder={
                readyCount === 0
                  ? '請先在左側上傳文件並等待處理完成，再開始提問。'
                  : selectedReadyCount === 0
                  ? '請在左側勾選至少一份文件後再提問。'
                  : `使用 ${selectedReadyCount} 份文件。請輸入問題，AI 將從知識庫中尋找相關資料回答。`
              }
              onCopySuccess={() => showToast('已複製到剪貼簿')}
              onCopyError={() => showToast('複製失敗', 'error')}
              showChart={false}
              showPdf={false}
              headerActions={
                <button
                  type="button"
                  onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                  disabled={isLoading || messages.length === 0}
                  className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  aria-label="清除對話"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              }
            />
          </Panel>

          <ResizeHandle />

          <Panel
            panelRef={aiPanelRef}
            collapsible
            collapsedSize="250px"
            defaultSize={25}
            minSize="250px"
            className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50"
          >
            <header className="flex shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
              <div className="flex items-center gap-1">
                <span>AI 設定區</span>
                <HelpCircle className="h-4 w-4 text-gray-400" />
              </div>
              <button
                type="button"
                onClick={() => aiPanelRef.current?.collapse()}
                className="rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-200"
                aria-label="折疊"
              >
                <ChevronsRight className="h-5 w-5" />
              </button>
            </header>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden border-b border-gray-200 bg-gray-50 px-4 py-3">
              <AISettingsPanelBasic
                model={model}
                onModelChange={setModel}
                language={language}
                onLanguageChange={setLanguage}
                detailLevel={detailLevel}
                onDetailLevelChange={setDetailLevel}
                exampleQuestionsCount={exampleQuestionsCount}
                onExampleQuestionsCountChange={setExampleQuestionsCount}
              />
              <div className="shrink-0 border-t border-gray-200" />
              <AISettingsPanelAdvanced
                agentId={agent.id}
                userPrompt={userPrompt}
                onUserPromptChange={setUserPrompt}
                selectedTemplateId={selectedTemplateId}
                onSelectedTemplateIdChange={setSelectedTemplateId}
                onToast={showToast}
              />
            </div>
          </Panel>
        </Group>
      </div>
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-km-agent.md"
        title="知識管理助理使用說明"
      />
    </div>
  )
}
