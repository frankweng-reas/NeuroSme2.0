/**
 * KB 管理 Agent UI（agent_id = kb-manager）
 * 三欄式：左=知識庫列表 / 中=文件管理 / 右=測試查詢
 * 對象：一般員工（可查詢）、manager+（可建立/管理 KB 與文件）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BarChart2,
  Check,
  ChevronRight,
  Download,
  FileText,
  Headphones,
  Loader2,
  Maximize2,
  Minimize2,
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
  addChunk,
  createKnowledgeBase,
  deleteChunk,
  deleteKnowledgeBase,
  deleteKmDocument,
  getKbQueryStats,
  listDocChunks,
  listKbDocuments,
  listKnowledgeBases,
  updateChunk,
  updateKnowledgeBase,
  uploadKmDocument,
  type KbScope,
  type KmChunk,
  type KmDocument,
  type KmKnowledgeBase,
  type QueryStatsResponse,
  type QueryStatsView,
} from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread, listChatMessages } from '@/api/chatThreads'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, UserRole } from '@/types'

interface Props { agent: Agent }

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
        <Loader2 className="h-2.5 w-2.5 animate-spin" />{status === 'pending' ? '需重新載入' : '處理中'}
      </span>
    )
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-base text-red-700">錯誤</span>
}

export default function AgentKbManagerUI({ agent }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'

  useEffect(() => {
    getMe().then((me) => setUserRole(me.role as UserRole)).catch(() => {})
  }, [])

  // ── 左欄：KB 列表 ─────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [midExpanded, setMidExpanded] = useState(false)
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [kbsLoading, setKbsLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)
  const [kbMenuId, setKbMenuId] = useState<number | null>(null)
  const kbMenuRef = useRef<HTMLLIElement | null>(null)
  // 折疊狀態（記憶在 localStorage）
  const [myKbOpen, setMyKbOpen] = useState(() => {
    try { return localStorage.getItem('kb-section-my') !== 'closed' } catch { return true }
  })
  const [companyKbOpen, setCompanyKbOpen] = useState(() => {
    try { return localStorage.getItem('kb-section-company') === 'open' } catch { return false }
  })

  const [creatingKbModal, setCreatingKbModal] = useState(false)

  const [deleteKbTarget, setDeleteKbTarget] = useState<KmKnowledgeBase | null>(null)

  // KB 設定 Modal（新增 & 編輯共用）
  const [settingsKb, setSettingsKb] = useState<KmKnowledgeBase | null>(null)
  const [settingsName, setSettingsName] = useState('')
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsScope, setSettingsScope] = useState<KbScope>('personal')
  const [settingsAnswerMode, setSettingsAnswerMode] = useState<'rag' | 'direct'>('rag')
  const [settingsSaving, setSettingsSaving] = useState(false)

  const loadKbs = useCallback(() => {
    setKbsLoading(true)
    listKnowledgeBases()
      .then((data) => {
        setKbs(data)
        if (data.length > 0 && selectedKbId === null) setSelectedKbId(data[0].id)
      })
      .catch(() => setKbs([]))
      .finally(() => setKbsLoading(false))
  }, [selectedKbId])

  useEffect(() => { loadKbs() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!kbMenuId) return
    const handler = (e: MouseEvent) => {
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node)) setKbMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [kbMenuId])

  useEffect(() => { if (creatingKbModal) {} }, [creatingKbModal])

  const openCreateKbModal = () => {
    setSettingsKb(null)
    setSettingsName('')
    setSettingsModel('')
    setSettingsPrompt('')
    setSettingsScope('personal')
    setSettingsAnswerMode('rag')
    setCreatingKbModal(true)
  }

  const closeSettingsModal = () => {
    setSettingsKb(null)
    setCreatingKbModal(false)
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
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setDeleteKbTarget(null)
    }
  }

  const handleSaveSettings = async () => {
    if (!settingsName.trim()) return
    setSettingsSaving(true)
    try {
      if (creatingKbModal) {
        // 新增模式
        const kb = await createKnowledgeBase({
          name: settingsName.trim(),
          model_name: settingsModel,
          answer_mode: settingsAnswerMode,
          scope: settingsScope,
          system_prompt: settingsPrompt,
        })
        setKbs((prev) => [...prev, kb])
        setSelectedKbId(kb.id)
        setCreatingKbModal(false)
        showToast('知識庫已建立')
      } else {
        if (!settingsKb) return
        const updated = await updateKnowledgeBase(settingsKb.id, {
          name: settingsName.trim(),
          model_name: settingsModel,
          system_prompt: settingsPrompt,
          scope: settingsScope,
          answer_mode: settingsAnswerMode,
        })
        setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
        setSettingsKb(null)
        showToast('設定已儲存')
      }
    } catch (err) {
      setErrorModal({ title: creatingKbModal ? '建立知識庫失敗' : '儲存設定失敗', message: err instanceof Error ? err.message : '操作失敗' })
    } finally {
      setSettingsSaving(false)
    }
  }

  // ── Chunk 編輯 Drawer ──────────────────────────────────────────────────────
  const [drawerDoc, setDrawerDoc] = useState<KmDocument | null>(null)
  const [chunks, setChunks] = useState<KmChunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)
  const [editingChunkId, setEditingChunkId] = useState<number | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [savingChunkId, setSavingChunkId] = useState<number | null>(null)
  const [deletingChunkId, setDeletingChunkId] = useState<number | null>(null)
  const [addingChunk, setAddingChunk] = useState(false)
  const [newChunkContent, setNewChunkContent] = useState('')
  const [addingChunkLoading, setAddingChunkLoading] = useState(false)

  const openDrawer = useCallback((doc: KmDocument) => {
    setDrawerDoc(doc)
    setChunks([])
    setEditingChunkId(null)
    setNewChunkContent('')
    setAddingChunk(false)
    setChunksLoading(true)
    listDocChunks(doc.id)
      .then(setChunks)
      .catch(() => setChunks([]))
      .finally(() => setChunksLoading(false))
  }, [])

  const closeDrawer = useCallback(() => {
    setDrawerDoc(null)
    setChunks([])
    setEditingChunkId(null)
    setAddingChunk(false)
  }, [])

  const handleSaveChunk = useCallback(async (chunkId: number) => {
    const content = editingContent.trim()
    if (!content) return
    setSavingChunkId(chunkId)
    try {
      const updated = await updateChunk(chunkId, content)
      setChunks((prev) => prev.map((c) => c.id === chunkId ? updated : c))
      setEditingChunkId(null)
      showToast('段落已儲存並重新 Embedding')
    } catch (err) {
      setErrorModal({ title: '儲存失敗', message: err instanceof Error ? err.message : '儲存失敗' })
    } finally {
      setSavingChunkId(null)
    }
  }, [editingContent]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteChunkItem = useCallback(async (chunkId: number) => {
    setDeletingChunkId(chunkId)
    try {
      await deleteChunk(chunkId)
      setChunks((prev) => prev.filter((c) => c.id !== chunkId))
      if (drawerDoc) {
        setDocs((prev) => prev.map((d) =>
          d.id === drawerDoc.id ? { ...d, chunk_count: Math.max(0, (d.chunk_count ?? 1) - 1) } : d
        ))
      }
      showToast('段落已刪除')
    } catch (err) {
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setDeletingChunkId(null)
    }
  }, [drawerDoc]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddChunk = useCallback(async () => {
    if (!drawerDoc || !newChunkContent.trim()) return
    setAddingChunkLoading(true)
    try {
      const added = await addChunk(drawerDoc.id, newChunkContent.trim())
      setChunks((prev) => [...prev, added])
      setDocs((prev) => prev.map((d) =>
        d.id === drawerDoc.id ? { ...d, chunk_count: (d.chunk_count ?? 0) + 1 } : d
      ))
      setNewChunkContent('')
      setAddingChunk(false)
      showToast('段落已新增並完成 Embedding')
    } catch (err) {
      setErrorModal({ title: '新增失敗', message: err instanceof Error ? err.message : '新增失敗' })
    } finally {
      setAddingChunkLoading(false)
    }
  }, [drawerDoc, newChunkContent]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── 中欄：Tab 切換（文件管理 / 查詢統計） ─────────────────────────────────
  const [centerTab, setCenterTab] = useState<'docs' | 'stats'>('docs')

  // ── 中欄：查詢統計 ─────────────────────────────────────────────────────────
  const [statsDays, setStatsDays] = useState<7 | 30 | 90>(30)
  const [statsView, setStatsView] = useState<QueryStatsView>('top_queries')
  const [statsData, setStatsData] = useState<QueryStatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsOffset, setStatsOffset] = useState(0)
  const STATS_LIMIT = 20

  const loadStats = useCallback((kbId: number, days: 7 | 30 | 90, view: QueryStatsView, offset = 0) => {
    setStatsLoading(true)
    getKbQueryStats(kbId, { days, view, limit: STATS_LIMIT, offset })
      .then((data) => {
        if (offset === 0) {
          setStatsData(data)
        } else {
          setStatsData((prev) => prev ? {
            ...data,
            queries: [...prev.queries, ...data.queries],
          } : data)
        }
        setStatsOffset(offset)
      })
      .catch(() => {})
      .finally(() => setStatsLoading(false))
  }, [])

  const storageKey = (kbId: number) => `kb-manager-docs-${kbId}`

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
            setSelectedDocIds(new Set(parsed.filter((id) => readyIds.includes(id))))
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

  const threadStorageKey = (kbId: number) => `kb-manager-thread-${kbId}`

  useEffect(() => {
    if (selectedKbId != null) {
      loadDocs(selectedKbId)
      // 切換 KB 時重置統計狀態
      setCenterTab('docs')
      setStatsData(null)
      setStatsOffset(0)
      setStatsDays(30)
      setStatsView('top_queries')
      // direct 模式知識庫自動鎖定 faq 文件類型
      const kb = kbs.find((k) => k.id === selectedKbId)
      if (kb?.answer_mode === 'direct') setUploadDocType('faq')
      // 嘗試復原舊 thread；沒有則建新的
      const savedThreadId = localStorage.getItem(threadStorageKey(selectedKbId))
      if (savedThreadId) {
        setThreadId(savedThreadId)
        setMessages([])
        listChatMessages(savedThreadId)
          .then((msgs) => {
            setMessages(
              msgs.map((m) => ({
                role: m.role as 'user' | 'assistant',
                content: m.content,
              }))
            )
          })
          .catch(() => {
            // thread 已失效，建新的
            localStorage.removeItem(threadStorageKey(selectedKbId))
            setMessages([])
            createChatThread({ agent_id: agent.id, title: null })
              .then((t) => {
                setThreadId(t.id)
                localStorage.setItem(threadStorageKey(selectedKbId), t.id)
              })
              .catch(() => {})
          })
      } else {
        setMessages([])
        createChatThread({ agent_id: agent.id, title: null })
          .then((t) => {
            setThreadId(t.id)
            localStorage.setItem(threadStorageKey(selectedKbId), t.id)
          })
          .catch(() => {})
      }
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
        const lower = file.name.toLowerCase()
        let detectedType = uploadDocType
        if (uploadDocType === 'article') {
          if (/faq|q[&＆]a|問答/.test(lower)) detectedType = 'faq'
          else if (/spec|規格|technical|datasheet/.test(lower)) detectedType = 'spec'
          else if (/policy|政策|條款|terms|contract/.test(lower)) detectedType = 'policy'
        }
        try {
          const doc = await uploadKmDocument(file, 'private', (pct) => setUploadProgress(pct), [], selectedKbId, detectedType)
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
          setErrorModal({ title: `「${file.name}」上傳失敗`, message: err instanceof Error ? err.message : '上傳失敗' })
        }
      }
      setUploading(false); setUploadProgress(0); setUploadCurrent(0); setUploadTotal(0)
      if (fileList.length > 1) showToast(errorCount === 0 ? `${successCount} 個上傳完成` : `完成 ${successCount}，失敗 ${errorCount}`)
      else if (successCount === 1) showToast('上傳完成')
      setUploadModalOpen(false)
    },
    [selectedKbId, uploadDocType] // eslint-disable-line react-hooks/exhaustive-deps
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
          ? { ...kb, doc_count: Math.max(0, kb.doc_count - 1), ready_count: deleteDocTarget.status === 'ready' ? Math.max(0, kb.ready_count - 1) : kb.ready_count }
          : kb
      ))
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '刪除失敗'
      showToast(String(msg), 'error')
    } finally {
      setDeleteDocLoading(false)
      setDeleteDocTarget(null)
    }
  }, [deleteDocTarget, selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 右欄：Chat ─────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  const latestKbIdRef = useRef(selectedKbId)
  latestKbIdRef.current = selectedKbId

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text || isLoading) return
      const kbId = latestKbIdRef.current
      if (!kbId) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '請先在左側選擇知識庫。' }])
        return
      }
      const readyCount = docs.filter((d) => d.status === 'ready').length
      if (readyCount === 0) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '此知識庫尚無可用文件，請先上傳並等待處理完成。' }])
        return
      }
      if (selectedDocIds.size === 0) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '目前沒有勾選任何文件，請至少勾選一份後再提問。' }])
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
            prompt_type: 'knowledge',
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
              const meta: ResponseMeta | undefined = done.usage != null
                ? { model: done.model, usage: done.usage, finish_reason: done.finish_reason }
                : undefined
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: done.content, meta, sources: done.sources?.length ? done.sources : undefined }
                return next
              })
              if (threadId && done.content) appendChatMessage(threadId, { role: 'assistant', content: done.content }).catch(() => {})
            },
            onError: (errMsg) => {
              setMessages((prev) => prev.slice(0, startIdx))
              setErrorModal({ title: '對話發生錯誤', message: errMsg })
            },
          }
        )
      } catch (err) {
        setMessages((prev) => prev.slice(0, startIdx))
        setErrorModal({ title: '對話發生錯誤', message: err instanceof Error ? err.message : '未知錯誤' })
      } finally {
        setIsLoading(false)
      }
    },
    [agent.agent_id, isLoading, messages, docs, selectedDocIds, threadId]
  )

  // ── Toast / Error ─────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => setToast({ msg, type }), [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null
  const readyCount = docs.filter((d) => d.status === 'ready').length
  // personal KB：後端只回傳建立者自己的，所以 member 看到的 personal KB 一定是自己的，可上傳
  // company KB：只有 manager+ 才能上傳
  const canUploadToSelectedKb = selectedKb != null && (selectedKb.scope === 'personal' || canManage)

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {toast && (
        <div className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg px-4 py-2 text-base text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}
          role={toast.type === 'error' ? 'alert' : 'status'}>{toast.msg}</div>
      )}

      {/* ── Chunk 編輯 Drawer ──────────────────────────────────────────────── */}
      {drawerDoc && (
        <div className="fixed inset-0 z-40 flex justify-end">
          {/* 半透明背景 */}
          <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />
          {/* Drawer 本體 */}
          <div className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            {/* 標題列 */}
            <div className="flex shrink-0 items-center gap-3 border-b border-gray-100 px-5 py-4">
              <Pencil className="h-4 w-4 shrink-0 text-sky-500" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold text-gray-800">{drawerDoc.filename}</p>
                <p className="text-base text-gray-400">
                  {chunksLoading ? '載入中…' : `${chunks.length} 個段落`}
                </p>
              </div>
              {!chunksLoading && chunks.length > 0 && (
                <button
                  type="button"
                  title="匯出所有段落為 txt"
                  onClick={() => {
                    const content = chunks
                      .map((c) => c.content.trim())
                      .join('\n\n')
                    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    const baseName = drawerDoc?.filename.replace(/\.[^.]+$/, '') ?? 'chunks'
                    a.href = url
                    a.download = `${baseName}.txt`
                    a.click()
                    URL.revokeObjectURL(url)
                  }}
                  className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <Download className="h-4 w-4" />
                </button>
              )}
              <button type="button" onClick={closeDrawer}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 段落列表 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {chunksLoading ? (
                <div className="flex h-40 items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
                </div>
              ) : chunks.length === 0 ? (
                <p className="py-12 text-center text-base text-gray-300">尚無段落</p>
              ) : (
                chunks.map((chunk) => {
                  const isEditing = editingChunkId === chunk.id
                  const isSaving = savingChunkId === chunk.id
                  const isDeleting = deletingChunkId === chunk.id
                  return (
                    <div key={chunk.id}
                      className={`rounded-xl border p-3 transition-colors ${isEditing ? 'border-sky-300 bg-sky-50/40' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                      {/* 段落標頭 */}
                      <div className="mb-2 flex items-center gap-2">
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                          #{chunk.chunk_index + 1}
                        </span>
                        <span className="text-xs text-gray-300">{chunk.content.length} 字</span>
                        <div className="ml-auto flex items-center gap-1">
                          {!isEditing && (
                            <button type="button"
                              onClick={() => { setEditingChunkId(chunk.id); setEditingContent(chunk.content) }}
                              className="rounded p-1 text-gray-300 hover:bg-sky-50 hover:text-sky-500">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button type="button"
                            disabled={isDeleting || isEditing}
                            onClick={() => handleDeleteChunkItem(chunk.id)}
                            className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-400 disabled:opacity-40">
                            {isDeleting
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* 內容 / 編輯區 */}
                      {isEditing ? (
                        <>
                          <textarea
                            autoFocus
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            rows={6}
                            className="w-full rounded-lg border border-sky-300 bg-white px-3 py-2 text-base text-gray-700 focus:outline-none focus:ring-1 focus:ring-sky-400"
                          />
                          <div className="mt-2 flex justify-end gap-2">
                            <button type="button"
                              onClick={() => setEditingChunkId(null)}
                              disabled={isSaving}
                              className="rounded-lg border border-gray-300 px-3 py-1.5 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                              取消
                            </button>
                            <button type="button"
                              onClick={() => void handleSaveChunk(chunk.id)}
                              disabled={isSaving || !editingContent.trim()}
                              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                              {isSaving ? '儲存中…' : '儲存'}
                            </button>
                          </div>
                        </>
                      ) : (
                        <p className="whitespace-pre-wrap break-words text-base text-gray-600 leading-relaxed">
                          {chunk.content}
                        </p>
                      )}
                    </div>
                  )
                })
              )}

              {/* 新增段落區 */}
              {addingChunk ? (
                <div className="rounded-xl border border-dashed border-sky-300 bg-sky-50/40 p-3">
                  <p className="mb-2 text-base font-medium text-sky-700">新增段落</p>
                  <textarea
                    autoFocus
                    value={newChunkContent}
                    onChange={(e) => setNewChunkContent(e.target.value)}
                    rows={5}
                    placeholder="輸入新段落內容…"
                    className="w-full rounded-lg border border-sky-300 bg-white px-3 py-2 text-base text-gray-700 placeholder-gray-300 focus:outline-none focus:ring-1 focus:ring-sky-400"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button type="button"
                      onClick={() => { setAddingChunk(false); setNewChunkContent('') }}
                      disabled={addingChunkLoading}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-base text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                      取消
                    </button>
                    <button type="button"
                      onClick={() => void handleAddChunk()}
                      disabled={addingChunkLoading || !newChunkContent.trim()}
                      className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-50">
                      {addingChunkLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {addingChunkLoading ? '新增中…' : '新增'}
                    </button>
                  </div>
                </div>
              ) : (
                !chunksLoading && (
                  <button type="button"
                    onClick={() => setAddingChunk(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-base text-gray-400 hover:border-sky-300 hover:text-sky-500">
                    <Plus className="h-4 w-4" />新增段落
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* 上傳 Modal */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-sky-500" />
                <span className="text-lg font-semibold text-gray-800">上傳檔案</span>
              </div>
              <button type="button" onClick={() => !uploading && setUploadModalOpen(false)} disabled={uploading}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-6 space-y-6">
              <div>
                <p className="mb-1 text-base font-semibold text-gray-700">文件類型</p>
                <p className="mb-3 text-base text-gray-400">選擇適合類型可提升搜尋準確度</p>
                {selectedKb?.answer_mode === 'direct' && (
                  <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-base text-amber-700">
                    精確直答模式只支援 FAQ 問答集類型
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'article',   emoji: '📄', label: '一般文章',   sub: '說明文件、公告' },
                    { value: 'faq',       emoji: '💬', label: 'FAQ 問答集', sub: '常見問題、Q&A' },
                    { value: 'spec',      emoji: '🔧', label: '技術規格',   sub: '參數表、Datasheet' },
                    { value: 'policy',    emoji: '📋', label: '政策 / 條款', sub: '合約、規章' },
                    { value: 'reference', emoji: '📑', label: '參考資料',   sub: '菜單、價目表、術語表' },
                  ] as const).map(({ value, emoji, label, sub }) => {
                    const isDirectLocked = selectedKb?.answer_mode === 'direct' && value !== 'faq'
                    return (
                    <button key={value} type="button"
                      disabled={uploading || isDirectLocked}
                      onClick={() => !isDirectLocked && setUploadDocType(value)}
                      className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all ${isDirectLocked ? 'cursor-not-allowed opacity-30' : 'disabled:opacity-60'} ${uploadDocType === value ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 bg-gray-50 hover:border-sky-200'}`}>
                      <span className="mt-0.5 text-2xl leading-none">{emoji}</span>
                      <div>
                        <p className={`text-base font-medium ${uploadDocType === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</p>
                        <p className="text-base text-gray-400">{sub}</p>
                      </div>
                      {uploadDocType === value && <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
                    </button>
                    )
                  })}
                </div>
              </div>
              {uploading && (
                <div className="space-y-1">
                  {uploadTotal > 1 && <p className="text-center text-base text-gray-500">處理中 {uploadCurrent}/{uploadTotal}</p>}
                  <div className="overflow-hidden rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-sky-400 transition-all" style={{ width: `${uploadProgress > 0 ? uploadProgress : 100}%` }} />
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.markdown" multiple className="hidden" onChange={handleFileChange} />
              <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-6 text-base font-medium text-white hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: HEADER_COLOR }}>
                {uploading
                  ? <><Loader2 className="h-5 w-5 animate-spin" />{`上傳中 ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}`}</>
                  : <><Upload className="h-5 w-5" />點擊選擇檔案（可多選，PDF / TXT / MD）</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KB 設定 Modal */}
      {(settingsKb || creatingKbModal) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="flex w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">{creatingKbModal ? '新增知識庫' : '知識庫設定'}</h2>
              <button type="button" onClick={closeSettingsModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">
                  名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={settingsName}
                  onChange={(e) => setSettingsName(e.target.value)}
                  maxLength={100}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                <LLMModelSelect value={settingsModel} onChange={setSettingsModel} label="" labelPosition="stacked" allowEmpty emptyLabel="無"
                  selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">知識庫範圍</label>
                <p className="mb-2 text-base text-gray-400">公司共用需 manager 以上權限才能設定</p>
                <div className="flex gap-3">
                  {([
                    { value: 'personal', label: '🔒 個人私有', sub: '只有建立者可見' },
                    { value: 'company',  label: '🏢 公司共用', sub: '同公司全員可引用' },
                  ] as const).map(({ value, label, sub }) => (
                    <button key={value} type="button"
                      disabled={!canManage}
                      onClick={() => canManage && setSettingsScope(value)}
                      className={`flex flex-1 flex-col items-start rounded-xl border-2 px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                        settingsScope === value
                          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                          : 'border-gray-200 bg-gray-50 hover:border-sky-200'
                      }`}>
                      <span className={`text-base font-medium ${settingsScope === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</span>
                      <span className="text-base text-gray-400">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">回答模式</label>
                <p className="mb-2 text-base text-gray-400">FAQ 模式會直接回傳原文答案，不經 AI 改寫，建議搭配 Doc Refiner 整理的 Q&A 內容</p>
                <div className="flex gap-3">
                  {([
                    { value: 'rag', label: '✨ AI 整合回答', sub: '整合多份文件，彈性回答' },
                    { value: 'direct', label: '🎯 精確直答', sub: '直接回傳原文，100% 忠實' },
                  ] as const).map(({ value, label, sub }) => (
                    <button key={value} type="button"
                      onClick={() => setSettingsAnswerMode(value)}
                      className={`flex flex-1 flex-col items-start rounded-xl border-2 px-4 py-3 text-left transition-all ${
                        settingsAnswerMode === value
                          ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200'
                          : 'border-gray-200 bg-gray-50 hover:border-sky-200'
                      }`}>
                      <span className={`text-base font-medium ${settingsAnswerMode === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</span>
                      <span className="text-base text-gray-400">{sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">
                  自訂系統提示詞<span className="ml-1 font-normal text-gray-400">（選填）</span>
                </label>
                <textarea value={settingsPrompt} onChange={(e) => setSettingsPrompt(e.target.value)} rows={8}
                  placeholder="你是 XX 公司的客服助手…"
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={closeSettingsModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50">取消</button>
              <button type="button" onClick={() => void handleSaveSettings()} disabled={settingsSaving || !settingsName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{creatingKbModal ? '建立' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ErrorModal open={errorModal !== null} title={errorModal?.title} message={errorModal?.message ?? ''} onClose={() => setErrorModal(null)} />
      <ConfirmModal open={deleteKbTarget !== null} title="刪除知識庫"
        message={`確定要刪除「${deleteKbTarget?.name}」嗎？\n知識庫內所有文件也將一併刪除，此操作無法復原。`}
        confirmText="刪除" variant="danger" onConfirm={() => void handleDeleteKb()} onCancel={() => setDeleteKbTarget(null)} />
      <ConfirmModal open={deleteDocTarget !== null} title="刪除文件"
        message={`確定要刪除「${deleteDocTarget?.filename}」嗎？文件與所有切片將永久刪除。`}
        confirmText={deleteDocLoading ? '處理中…' : '刪除'} variant="danger"
        onConfirm={() => { if (!deleteDocLoading) void handleDeleteDoc() }}
        onCancel={() => !deleteDocLoading && setDeleteDocTarget(null)} />
      <ConfirmModal open={showClearConfirm} title="確認清除" message="確定要清除此段對話嗎？" confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          if (selectedKbId != null) localStorage.removeItem(threadStorageKey(selectedKbId))
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => {
              setThreadId(t.id)
              if (selectedKbId != null) localStorage.setItem(threadStorageKey(selectedKbId), t.id)
            })
            .catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)} />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-kb-manager.md" title="KB 管理 使用說明" />
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setHelpOpen(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：KB 列表 ═══════════════════════════════════════════════ */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-80'}`}
          style={{ backgroundColor: HEADER_COLOR }}>
          <div className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${sidebarCollapsed ? 'px-2' : 'pl-4 pr-2'}`}>
            {sidebarCollapsed ? (
              <button type="button" onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10" title="展開">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Headphones className="h-4 w-4 text-white/70" />
                  <span className="text-lg font-semibold text-white">知識庫</span>
                </div>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={() => { openCreateKbModal(); setKbMenuId(null) }}
                    className="rounded-lg p-1.5 text-white/70 hover:bg-white/15 hover:text-white" title="新增知識庫">
                    <Plus className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => setSidebarCollapsed(true)}
                    className="rounded-lg px-1 py-1 text-white/60 hover:bg-white/10 hover:text-white" title="折疊">
                    {'<<'}
                  </button>
                </div>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {kbsLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
                ) : (() => {
                  const myKbs = kbs.filter((kb) => kb.scope === 'personal')
                  const companyKbs = kbs.filter((kb) => kb.scope === 'company')

                  const renderKbItem = (kb: KmKnowledgeBase) => (
                    <li key={kb.id} className="relative" ref={kbMenuId === kb.id ? kbMenuRef : undefined}>
                      <button type="button" onClick={() => { setSelectedKbId(kb.id); setKbMenuId(null) }}
                        className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-lg transition-colors ${selectedKbId === kb.id ? 'bg-sky-500/30 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'}`}>
                        <span className="min-w-0 flex-1 truncate font-medium">{kb.name}</span>
                        <span className={`shrink-0 text-lg ${selectedKbId === kb.id ? 'text-sky-200/80' : 'text-white/40'}`}>{kb.ready_count}/{kb.doc_count}</span>
                        {kb.scope === 'company' && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${kb.bot_count > 0 ? 'bg-emerald-500/30 text-emerald-200' : 'bg-white/10 text-white/30'}`}
                            title={kb.bot_count > 0 ? `${kb.bot_count} 個 Bot 使用中` : '尚無 Bot 使用'}
                          >
                            {kb.bot_count}
                          </span>
                        )}
                        {canManage && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); setKbMenuId(kbMenuId === kb.id ? null : kb.id) }}
                            className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </button>
                      {kbMenuId === kb.id && (
                        <div className="absolute right-0 top-full z-20 mt-0.5 w-24 overflow-hidden rounded-lg border border-white/20 bg-[#1a3a52] shadow-xl">
                          <button type="button" onClick={() => { setSettingsKb(kb); setSettingsName(kb.name); setSettingsModel(kb.model_name ?? ''); setSettingsPrompt(kb.system_prompt ?? ''); setSettingsScope(kb.scope ?? 'personal'); setSettingsAnswerMode(kb.answer_mode ?? 'rag'); setKbMenuId(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-white/80 hover:bg-white/10 hover:text-white">
                            <Settings className="h-3 w-3" />設定
                          </button>
                          <button type="button" onClick={() => { setDeleteKbTarget(kb); setKbMenuId(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-red-300 hover:bg-red-500/20">
                            <Trash2 className="h-3 w-3" />刪除
                          </button>
                        </div>
                      )}
                    </li>
                  )

                  return (
                    <div className="space-y-1">
                      {/* ── 我的知識庫 ── */}
                      <div>
                        <button type="button"
                          onClick={() => { const next = !myKbOpen; setMyKbOpen(next); try { localStorage.setItem('kb-section-my', next ? 'open' : 'closed') } catch {} }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-lg font-semibold text-sky-200 hover:text-white" style={{ backgroundColor: 'rgba(56,139,192,0.25)' }}>
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${myKbOpen ? 'rotate-90' : ''}`} />
                          <span className="flex-1">我的知識庫</span>
                          <span className="rounded-full bg-white/10 px-1.5 text-lg text-sky-200/70">{myKbs.length}</span>
                        </button>
                        {myKbOpen && (
                          myKbs.length === 0 ? (
                            <p className="px-7 pb-2 text-lg text-white/30">點擊上方 + 新增</p>
                          ) : (
                            <ul className="space-y-0.5 px-2">
                              {myKbs.map(renderKbItem)}
                            </ul>
                          )
                        )}
                      </div>

                      {/* ── 公司共用 ── */}
                      <div>
                        <div className="border-t border-white/20" />
                        <div className="mb-1 mt-0.5 border-t border-white/20" />
                      </div>
                      <div>
                        <button type="button"
                          onClick={() => { const next = !companyKbOpen; setCompanyKbOpen(next); try { localStorage.setItem('kb-section-company', next ? 'open' : 'closed') } catch {} }}
                          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left text-lg font-semibold text-emerald-200 hover:text-white" style={{ backgroundColor: 'rgba(16,120,80,0.30)' }}>
                          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${companyKbOpen ? 'rotate-90' : ''}`} />
                          <span className="flex-1">公司共用</span>
                          <span className="rounded-full bg-white/10 px-1.5 text-lg text-emerald-200/70">{companyKbs.length}</span>
                        </button>
                        {companyKbOpen && (
                          companyKbs.length === 0 ? (
                            <p className="px-7 pb-2 text-lg text-white/30">尚無公司共用知識庫</p>
                          ) : (
                            <ul className="space-y-0.5 px-2">
                              {companyKbs.map(renderKbItem)}
                            </ul>
                          )
                        )}
                      </div>
                    </div>
                  )
                })()}
              </div>
            </div>
          )}
        </div>

        {/* ══ 中欄：文件管理 / 查詢統計 ══════════════════════════════════════ */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-md transition-[width] duration-200 ${midExpanded ? 'w-[600px]' : 'w-80'}`}>
          {/* 標題列 */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="min-w-0 flex-1">
              {selectedKb ? (
                <>
                  <h2 className="truncate text-base font-semibold text-gray-800">{selectedKb.name}</h2>
                  <p className="text-base text-gray-400">
                    {selectedKb.scope === 'company' && (
                      selectedKb.bot_count > 0
                        ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-base font-medium text-emerald-700">{selectedKb.bot_count} 個 Bot 使用中</span>
                        : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-base font-medium text-gray-400">未被 Bot 使用</span>
                    )}
                  </p>
                </>
              ) : (
                <p className="text-base text-gray-400">請選擇知識庫</p>
              )}
            </div>
            {selectedKbId && centerTab === 'docs' && (
              <button type="button" onClick={() => loadDocs(selectedKbId)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            {selectedKbId && centerTab === 'stats' && (
              <button type="button" onClick={() => loadStats(selectedKbId, statsDays, statsView, 0)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              title={midExpanded ? '縮小' : '放大'}
              onClick={() => setMidExpanded((v) => !v)}
              className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              {midExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Tab bar（只在選了 KB 且有查詢功能時顯示） */}
          {selectedKbId && (
            <div className="flex shrink-0 border-b border-gray-100">
              <button
                type="button"
                onClick={() => setCenterTab('docs')}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                  centerTab === 'docs'
                    ? 'border-b-2 border-sky-500 text-sky-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />文件管理
              </button>
              <button
                type="button"
                onClick={() => {
                  setCenterTab('stats')
                  if (!statsData) loadStats(selectedKbId, statsDays, statsView, 0)
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                  centerTab === 'stats'
                    ? 'border-b-2 border-sky-500 text-sky-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <BarChart2 className="h-3.5 w-3.5" />查詢統計
              </button>
            </div>
          )}

          {/* ── 文件管理內容 ── */}
          {centerTab === 'docs' && (
            <>
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
                    {canUploadToSelectedKb && <p className="text-base text-gray-300">點擊下方「上傳文件」開始建立知識庫</p>}
                  </div>
                ) : (
                  <>
                    {(() => {
                      const readyIds = docs.filter((d) => d.status === 'ready').map((d) => d.id)
                      const allSelected = readyIds.length > 0 && readyIds.every((id) => selectedDocIds.has(id))
                      const toggleAll = (select: boolean) => {
                        const next = select ? new Set(readyIds) : new Set<number>()
                        setSelectedDocIds(next)
                        if (selectedKbId != null) localStorage.setItem(storageKey(selectedKbId), JSON.stringify([...next]))
                      }
                      return readyIds.length > 0 ? (
                        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-100 px-4 py-2">
                          <span className="flex-1 text-base text-gray-400">已選 {selectedDocIds.size} / {readyIds.length} 份</span>
                          <button type="button" onClick={() => toggleAll(true)} disabled={allSelected}
                            className="rounded px-2 py-0.5 text-base text-sky-600 hover:bg-sky-50 disabled:opacity-40">全選</button>
                          <span className="text-gray-200">|</span>
                          <button type="button" onClick={() => toggleAll(false)} disabled={selectedDocIds.size === 0}
                            className="rounded px-2 py-0.5 text-base text-gray-500 hover:bg-gray-100 disabled:opacity-40">全不選</button>
                        </div>
                      ) : null
                    })()}
                    <ul className="divide-y divide-gray-50">
                      {docs.map((doc) => (
                        <li key={doc.id} className="group flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                          {doc.status === 'ready' ? (
                            <input type="checkbox" checked={selectedDocIds.has(doc.id)}
                              onChange={(e) => setSelectedDocIds((prev) => {
                                const next = new Set(prev)
                                if (e.target.checked) next.add(doc.id); else next.delete(doc.id)
                                if (selectedKbId != null) localStorage.setItem(storageKey(selectedKbId), JSON.stringify([...next]))
                                return next
                              })}
                              className="mt-1 h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500" />
                          ) : (
                            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 break-all text-base font-medium text-gray-700">{doc.filename}</p>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                              <StatusBadge status={doc.status} />
                              {doc.chunk_count != null && doc.status === 'ready' && <span className="text-base text-gray-400">{doc.chunk_count} 段</span>}
                              {doc.size_bytes != null && <span className="text-base text-gray-300">{formatBytes(doc.size_bytes)}</span>}
                            </div>
                            {doc.status === 'error' && doc.error_message && (
                              <p className="mt-0.5 truncate text-base text-red-400">{doc.error_message}</p>
                            )}
                          </div>
                          {canUploadToSelectedKb && doc.status === 'ready' && (
                            <button type="button" onClick={() => openDrawer(doc)}
                              title="編輯段落內容"
                              className="mt-0.5 shrink-0 rounded p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-sky-50 hover:text-sky-500">
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canUploadToSelectedKb && (
                            <button type="button" onClick={() => setDeleteDocTarget(doc)}
                              className="mt-0.5 shrink-0 rounded p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-red-50 hover:text-red-400">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {canUploadToSelectedKb && (
                <div className="shrink-0 border-t border-gray-100 p-3">
                  <button type="button" onClick={() => setUploadModalOpen(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-base font-medium text-white hover:opacity-90"
                    style={{ backgroundColor: HEADER_COLOR }}>
                    <Upload className="h-4 w-4" />上傳文件
                  </button>
                </div>
              )}
            </>
          )}

          {/* ── 查詢統計內容 ── */}
          {centerTab === 'stats' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {/* 篩選列 */}
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-gray-100 px-4 py-2">
                <span className="text-base text-gray-400">近</span>
                {([7, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      setStatsDays(d)
                      if (selectedKbId) loadStats(selectedKbId, d, statsView, 0)
                    }}
                    className={`rounded-full px-2.5 py-0.5 text-base font-medium transition-colors ${
                      statsDays === d
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {d}天
                  </button>
                ))}
              </div>

              {/* 摘要卡片 */}
              {statsData && (
                <div className="grid shrink-0 grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                  <div className="flex flex-col items-center bg-slate-50 py-3">
                    <span className="text-lg font-bold text-slate-700">{statsData.summary.total_queries}</span>
                    <span className="text-base text-slate-500">總查詢</span>
                  </div>
                  <div className="flex flex-col items-center bg-emerald-50 py-3">
                    <span className="text-lg font-bold text-emerald-600">
                      {statsData.summary.total_queries > 0
                        ? `${Math.round(statsData.summary.hit_rate * 100)}%`
                        : '—'}
                    </span>
                    <span className="text-base text-emerald-600">命中率</span>
                  </div>
                  <div className={`flex flex-col items-center py-3 ${statsData.summary.zero_hit_count > 0 ? 'bg-amber-50' : 'bg-gray-50'}`}>
                    <span className={`text-lg font-bold ${statsData.summary.zero_hit_count > 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                      {statsData.summary.zero_hit_count}
                    </span>
                    <span className={`text-base ${statsData.summary.zero_hit_count > 0 ? 'text-amber-600' : 'text-gray-500'}`}>零命中</span>
                  </div>
                </div>
              )}

              {/* Sub-tab */}
              <div className="flex shrink-0 border-b border-gray-100">
                {(['top_queries', 'zero_hit'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      setStatsView(v)
                      if (selectedKbId) loadStats(selectedKbId, statsDays, v, 0)
                    }}
                    className={`flex-1 py-2 text-base font-medium transition-colors ${
                      statsView === v
                        ? 'border-b-2 border-sky-500 text-sky-600'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    {v === 'top_queries' ? '最多人問' : '零命中'}
                  </button>
                ))}
              </div>

              {/* 清單 */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {statsLoading && !statsData ? (
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : !statsData || statsData.queries.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
                    <BarChart2 className="h-8 w-8 text-gray-200" />
                    <p className="text-base text-gray-400">
                      {statsView === 'zero_hit' ? '近期無零命中查詢' : '尚無查詢記錄'}
                    </p>
                  </div>
                ) : (
                  <>
                    <ol className="divide-y divide-gray-50">
                      {statsData.queries.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-3 px-4 py-2.5">
                          <span className="mt-0.5 w-5 shrink-0 text-center text-base font-medium text-gray-300">
                            {statsOffset + idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 break-all text-base text-gray-700">{item.query}</p>
                          </div>
                          <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-base font-medium ${
                            item.hit ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                          }`}>
                            {item.count} 次
                          </span>
                        </li>
                      ))}
                    </ol>
                    {statsData.has_more && (
                      <div className="flex justify-center py-3">
                        <button
                          type="button"
                          disabled={statsLoading}
                          onClick={() => {
                            if (selectedKbId) {
                              const nextOffset = statsOffset + STATS_LIMIT
                              loadStats(selectedKbId, statsDays, statsView, nextOffset)
                            }
                          }}
                          className="text-base text-sky-500 hover:underline disabled:opacity-40"
                        >
                          {statsLoading ? '載入中…' : '載入更多'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ══ 右欄：測試查詢 Chat ═══════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            {selectedKb && (
              <>
                {selectedKb.model_name ? (
                  <><span className="flex shrink-0 items-center gap-1"><span className="text-base text-gray-500">使用模型：</span><span className="rounded-full bg-sky-100 px-2 py-0.5 text-base text-sky-700">{selectedKb.model_name}</span></span></>
                ) : (
                  <><span className="shrink-0 text-base text-gray-400">系統預設模型</span></>
                )}
              </>
            )}
            <button type="button" onClick={() => messages.length > 0 && setShowClearConfirm(true)}
              disabled={isLoading || messages.length === 0}
              className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <RefreshCw className="h-5 w-5" />
            </button>
          </div>
          <AgentChat
            messages={messages}
            onSubmit={handleSendMessage}
            isLoading={isLoading}
            headerTitle=""
            emptyPlaceholder={
              !selectedKb ? '請在左側選擇知識庫後開始提問。'
              : readyCount === 0 ? `「${selectedKb.name}」尚無可用文件，請先在中間欄上傳並等待處理完成。`
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
