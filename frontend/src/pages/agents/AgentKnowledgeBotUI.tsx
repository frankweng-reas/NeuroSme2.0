/**
 * Knowledge Bot Agent UI（agent_id = knowledge-bot）
 * 三欄式：左=KB列表+Bot列表 / 中=文件管理 / 右=Bot設定+測試Chat+部署
 * KB 管理完整整合，取代 CS Agent 的知識庫管理入口
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
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
import {
  createBot,
  deleteBot,
  generateBotToken,
  listBots,
  revokeBotToken,
  updateBot,
  type Bot as BotType,
  type BotKbItem,
} from '@/api/bots'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread } from '@/api/chatThreads'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, UserRole } from '@/types'

interface Props {
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
        <Loader2 className="h-2.5 w-2.5 animate-spin" />{status === 'pending' ? '需重新載入' : '處理中'}
      </span>
    )
  return <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-base text-red-700">錯誤</span>
}

type RightTab = 'chat' | 'settings' | 'deploy'

export default function AgentKnowledgeBotUI({ agent }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 角色 ─────────────────────────────────────────────────────────────────
  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  useEffect(() => {
    getMe().then((me) => setUserRole(me.role as UserRole)).catch(() => {})
  }, [])

  // ── 左欄：sidebar 折疊 ────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [kbSectionOpen, setKbSectionOpen] = useState(true)
  const [botSectionOpen, setBotSectionOpen] = useState(true)

  // ── 左欄：KB 列表 ─────────────────────────────────────────────────────────
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [kbsLoading, setKbsLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<number | null>(null)
  const [kbMenuId, setKbMenuId] = useState<number | null>(null)
  const kbMenuRef = useRef<HTMLLIElement | null>(null)

  const [creatingKb, setCreatingKb] = useState(false)
  const [newKbName, setNewKbName] = useState('')
  const [newKbModel, setNewKbModel] = useState('')
  const [newKbSaving, setNewKbSaving] = useState(false)
  const newKbInputRef = useRef<HTMLInputElement>(null)

  const [renamingKbId, setRenamingKbId] = useState<number | null>(null)
  const [renameKbValue, setRenameKbValue] = useState('')
  const renameKbInputRef = useRef<HTMLInputElement>(null)

  const [deleteKbTarget, setDeleteKbTarget] = useState<KmKnowledgeBase | null>(null)

  // KB 設定 Modal
  const [settingsKb, setSettingsKb] = useState<KmKnowledgeBase | null>(null)
  const [settingsKbModel, setSettingsKbModel] = useState('')
  const [settingsKbPrompt, setSettingsKbPrompt] = useState('')
  const [settingsKbSaving, setSettingsKbSaving] = useState(false)

  // ── 左欄：Bot 列表 ────────────────────────────────────────────────────────
  const [bots, setBots] = useState<BotType[]>([])
  const [botsLoading, setBotsLoading] = useState(true)
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null)
  const [botMenuId, setBotMenuId] = useState<number | null>(null)
  const botMenuRef = useRef<HTMLLIElement | null>(null)

  const [creatingBot, setCreatingBot] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  const [newBotSaving, setNewBotSaving] = useState(false)
  const newBotInputRef = useRef<HTMLInputElement>(null)

  const [renamingBotId, setRenamingBotId] = useState<number | null>(null)
  const [renameBotValue, setRenameBotValue] = useState('')
  const renameBotInputRef = useRef<HTMLInputElement>(null)

  const [deleteBotTarget, setDeleteBotTarget] = useState<BotType | null>(null)

  // ── 右欄 Tab ──────────────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<RightTab>('chat')

  // ── Bot 設定 ──────────────────────────────────────────────────────────────
  const [settingsActive, setSettingsActive] = useState(true)
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsWidgetTitle, setSettingsWidgetTitle] = useState('')
  const [settingsWidgetColor, setSettingsWidgetColor] = useState('#1A3A52')
  const [settingsWidgetLang, setSettingsWidgetLang] = useState('zh-TW')
  const [settingsWidgetLogoUrl, setSettingsWidgetLogoUrl] = useState('')
  const [settingsKbIds, setSettingsKbIds] = useState<BotKbItem[]>([])
  const [settingsSaving, setSettingsSaving] = useState(false)

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

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)

  // ── Toast / Error ─────────────────────────────────────────────────────────
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

  // ── 初始載入 ──────────────────────────────────────────────────────────────
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

  const loadBots = useCallback(() => {
    setBotsLoading(true)
    listBots()
      .then((data) => {
        setBots(data)
        if (data.length > 0 && selectedBotId === null) setSelectedBotId(data[0].id)
      })
      .catch(() => setBots([]))
      .finally(() => setBotsLoading(false))
  }, [selectedBotId])

  useEffect(() => { loadKbs(); loadBots() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 點擊外部關閉 menu
  useEffect(() => {
    if (!kbMenuId && !botMenuId) return
    const handler = (e: MouseEvent) => {
      if (kbMenuRef.current && !kbMenuRef.current.contains(e.target as Node)) setKbMenuId(null)
      if (botMenuRef.current && !botMenuRef.current.contains(e.target as Node)) setBotMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [kbMenuId, botMenuId])

  useEffect(() => { if (creatingKb) newKbInputRef.current?.focus() }, [creatingKb])
  useEffect(() => { if (renamingKbId) renameKbInputRef.current?.focus() }, [renamingKbId])
  useEffect(() => { if (creatingBot) newBotInputRef.current?.focus() }, [creatingBot])
  useEffect(() => { if (renamingBotId) renameBotInputRef.current?.focus() }, [renamingBotId])

  // ── KB → 文件 ──────────────────────────────────────────────────────────────
  const storageKey = (kbId: number) => `kbot-selected-docs-${kbId}`

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

  useEffect(() => {
    if (selectedKbId != null) loadDocs(selectedKbId)
    else setDocs([])
  }, [selectedKbId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Bot → 設定欄位 ─────────────────────────────────────────────────────────
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null

  useEffect(() => {
    if (!selectedBot) return
    setSettingsModel(selectedBot.model_name ?? '')
    setSettingsPrompt(selectedBot.system_prompt ?? '')
    setSettingsWidgetTitle(selectedBot.widget_title ?? '')
    setSettingsWidgetColor(selectedBot.widget_color ?? '#1A3A52')
    setSettingsWidgetLang(selectedBot.widget_lang ?? 'zh-TW')
    setSettingsWidgetLogoUrl(selectedBot.widget_logo_url ?? '')
    setSettingsKbIds(selectedBot.knowledge_bases.map((kb) => ({ knowledge_base_id: kb.knowledge_base_id, sort_order: kb.sort_order })))
    setSettingsActive(selectedBot.is_active)
    setMessages([])
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [selectedBotId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── KB CRUD ───────────────────────────────────────────────────────────────
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
      setErrorModal({ title: '建立知識庫失敗', message: err instanceof Error ? err.message : '建立失敗' })
    } finally {
      setNewKbSaving(false)
    }
  }

  const handleRenameKb = async (id: number) => {
    const name = renameKbValue.trim()
    if (!name) { setRenamingKbId(null); return }
    try {
      const updated = await updateKnowledgeBase(id, { name })
      setKbs((prev) => prev.map((kb) => kb.id === id ? updated : kb))
    } catch (err) {
      setErrorModal({ title: '重命名失敗', message: err instanceof Error ? err.message : '更新失敗' })
    } finally {
      setRenamingKbId(null)
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
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setDeleteKbTarget(null)
    }
  }

  const handleSaveKbSettings = async () => {
    if (!settingsKb) return
    setSettingsKbSaving(true)
    try {
      const updated = await updateKnowledgeBase(settingsKb.id, {
        model_name: settingsKbModel,
        system_prompt: settingsKbPrompt,
      })
      setKbs((prev) => prev.map((kb) => kb.id === updated.id ? updated : kb))
      setSettingsKb(null)
      showToast('KB 設定已儲存')
    } catch (err) {
      setErrorModal({ title: '儲存設定失敗', message: err instanceof Error ? err.message : '儲存失敗' })
    } finally {
      setSettingsKbSaving(false)
    }
  }

  // ── Bot CRUD ──────────────────────────────────────────────────────────────
  const handleCreateBot = async () => {
    const name = newBotName.trim()
    if (!name) return
    setNewBotSaving(true)
    try {
      const bot = await createBot({ name })
      setBots((prev) => [...prev, bot])
      setSelectedBotId(bot.id)
      setCreatingBot(false)
      setNewBotName('')
      setRightTab('settings')
    } catch (err) {
      setErrorModal({ title: '建立 Bot 失敗', message: err instanceof Error ? err.message : '建立失敗' })
    } finally {
      setNewBotSaving(false)
    }
  }

  const handleRenameBot = async (id: number) => {
    const name = renameBotValue.trim()
    if (!name) { setRenamingBotId(null); return }
    try {
      const updated = await updateBot(id, { name })
      setBots((prev) => prev.map((b) => b.id === id ? updated : b))
    } catch (err) {
      setErrorModal({ title: '重命名失敗', message: err instanceof Error ? err.message : '更新失敗' })
    } finally {
      setRenamingBotId(null)
    }
  }

  const handleDeleteBot = async () => {
    if (!deleteBotTarget) return
    try {
      await deleteBot(deleteBotTarget.id)
      setBots((prev) => prev.filter((b) => b.id !== deleteBotTarget.id))
      if (selectedBotId === deleteBotTarget.id) {
        const remaining = bots.filter((b) => b.id !== deleteBotTarget.id)
        setSelectedBotId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (err) {
      setErrorModal({ title: '刪除失敗', message: err instanceof Error ? err.message : '刪除失敗' })
    } finally {
      setDeleteBotTarget(null)
    }
  }

  const handleSaveBotSettings = async () => {
    if (!selectedBot) return
    setSettingsSaving(true)
    try {
      const updated = await updateBot(selectedBot.id, {
        is_active: settingsActive,
        model_name: settingsModel,
        system_prompt: settingsPrompt,
        widget_title: settingsWidgetTitle,
        widget_color: settingsWidgetColor,
        widget_lang: settingsWidgetLang,
        widget_logo_url: settingsWidgetLogoUrl || undefined,
        knowledge_base_ids: settingsKbIds,
      })
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
      showToast('Bot 設定已儲存')
    } catch (err) {
      setErrorModal({ title: '儲存設定失敗', message: err instanceof Error ? err.message : '儲存失敗' })
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleGenerateToken = async () => {
    if (!selectedBot || !isAdmin) return
    try {
      const updated = await generateBotToken(selectedBot.id)
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
      showToast('Widget Token 已產生')
    } catch (err) {
      setErrorModal({ title: '產生 Token 失敗', message: err instanceof Error ? err.message : '失敗' })
    }
  }

  const handleRevokeToken = async () => {
    if (!selectedBot || !isAdmin) return
    try {
      const updated = await revokeBotToken(selectedBot.id)
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
      showToast('Widget Token 已停用')
    } catch (err) {
      setErrorModal({ title: '停用 Token 失敗', message: err instanceof Error ? err.message : '失敗' })
    }
  }

  // ── 文件上傳 ──────────────────────────────────────────────────────────────
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
          setErrorModal({ title: `「${file.name}」上傳失敗`, message: err instanceof Error ? err.message : '上傳失敗' })
        }
      }
      setUploading(false)
      setUploadProgress(0)
      setUploadCurrent(0)
      setUploadTotal(0)
      if (fileList.length > 1) {
        showToast(errorCount === 0 ? `${successCount} 個檔案上傳完成` : `完成 ${successCount} 個，失敗 ${errorCount} 個`)
      } else if (successCount === 1) {
        showToast('上傳完成')
      }
      setUploadModalOpen(false)
    },
    [selectedKbId, uploadDocType, showToast]
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
  }, [deleteDocTarget, selectedKbId, showToast])

  // ── Chat ──────────────────────────────────────────────────────────────────
  const latestBotIdRef = useRef(selectedBotId)
  latestBotIdRef.current = selectedBotId

  const handleSendMessage = useCallback(
    async (text: string) => {
      if (!text || isLoading) return
      const botId = latestBotIdRef.current
      const bot = bots.find((b) => b.id === botId)
      if (!bot) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '請先在左側選擇 Bot。' }])
        return
      }
      if (!bot.is_active) {
        setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '此 Bot 已停用。' }])
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
            model: bot.model_name ?? '',
            messages: messages.map((m) => ({ role: m.role, content: m.content })),
            content: text,
            bot_id: botId,
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
    [agent.agent_id, isLoading, messages, bots, threadId]
  )

  function toggleKb(kbId: number) {
    setSettingsKbIds((prev) => {
      const exists = prev.find((item) => item.knowledge_base_id === kbId)
      if (exists) return prev.filter((item) => item.knowledge_base_id !== kbId)
      return [...prev, { knowledge_base_id: kbId, sort_order: prev.length }]
    })
  }

  const selectedKb = kbs.find((kb) => kb.id === selectedKbId) ?? null

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg px-4 py-2 text-base text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}
          role={toast.type === 'error' ? 'alert' : 'status'}
        >{toast.msg}</div>
      )}

      {/* ── 上傳 Modal ──────────────────────────────────────────────────── */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-sky-500" />
                <span className="text-lg font-semibold text-gray-800">上傳檔案</span>
              </div>
              <button type="button" onClick={() => !uploading && setUploadModalOpen(false)} disabled={uploading}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-40">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="px-6 py-6 space-y-6">
              <div>
                <p className="mb-1 text-base font-semibold text-gray-700">文件類型</p>
                <p className="mb-3 text-base text-gray-400">智能文檔處理可提昇搜尋準確度，請選擇適合類型</p>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    { value: 'article',   emoji: '📄', label: '一般文章', sub: '說明文件、公告' },
                    { value: 'faq',       emoji: '💬', label: 'FAQ 問答集', sub: '常見問題、Q&A' },
                    { value: 'spec',      emoji: '🔧', label: '技術規格', sub: '參數表、Datasheet' },
                    { value: 'policy',    emoji: '📋', label: '政策 / 條款', sub: '合約、規章' },
                    { value: 'reference', emoji: '📑', label: '參考資料', sub: '菜單、價目表、術語表' },
                  ] as const).map(({ value, emoji, label, sub }) => (
                    <button key={value} type="button" disabled={uploading} onClick={() => setUploadDocType(value)}
                      className={`flex items-start gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all disabled:opacity-60 ${
                        uploadDocType === value ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-200' : 'border-gray-200 bg-gray-50 hover:border-sky-200 hover:bg-sky-50/50'
                      }`}>
                      <span className="mt-0.5 text-2xl leading-none">{emoji}</span>
                      <div>
                        <p className={`text-base font-medium ${uploadDocType === value ? 'text-sky-700' : 'text-gray-800'}`}>{label}</p>
                        <p className="text-base text-gray-400">{sub}</p>
                      </div>
                      {uploadDocType === value && <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-sky-500" />}
                    </button>
                  ))}
                </div>
              </div>
              {uploading && (
                <div className="space-y-1">
                  {uploadTotal > 1 && (
                    <p className="text-base text-gray-500 text-center">處理中 {uploadCurrent}/{uploadTotal}</p>
                  )}
                  <div className="overflow-hidden rounded-full bg-gray-100">
                    <div className="h-2 rounded-full bg-sky-400 transition-all" style={{ width: `${uploadProgress > 0 ? uploadProgress : 100}%` }} />
                  </div>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.txt,.md,.markdown" multiple className="hidden" onChange={handleFileChange} />
              <button type="button" disabled={uploading} onClick={() => fileInputRef.current?.click()}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-6 text-base font-medium text-white transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50"
                style={{ backgroundColor: HEADER_COLOR }}>
                {uploading ? (
                  <><Loader2 className="h-5 w-5 animate-spin" />{uploadTotal > 1 ? `上傳中 (${uploadCurrent}/${uploadTotal}) ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}` : `上傳中 ${uploadProgress > 0 ? `${uploadProgress}%` : '…'}`}</>
                ) : (
                  <><Upload className="h-5 w-5" />點擊選擇檔案（可多選，PDF / TXT / MD）</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── KB 設定 Modal ─────────────────────────────────────────────── */}
      {settingsKb && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4">
          <div className="flex w-full max-w-2xl flex-col rounded-xl border border-gray-200 bg-white shadow-xl max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">知識庫設定 — {settingsKb.name}</h2>
              <button type="button" onClick={() => setSettingsKb(null)} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                <LLMModelSelect value={settingsKbModel} onChange={setSettingsKbModel} label="" labelPosition="stacked" allowEmpty emptyLabel="無"
                  selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </div>
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">
                  自訂系統提示詞<span className="ml-1 font-normal text-gray-400">（選填）</span>
                </label>
                <textarea value={settingsKbPrompt} onChange={(e) => setSettingsKbPrompt(e.target.value)} rows={6}
                  placeholder="你是 XX 公司的客服助手…"
                  className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400" />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button type="button" onClick={() => setSettingsKb(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50">取消</button>
              <button type="button" onClick={() => void handleSaveKbSettings()} disabled={settingsKbSaving}
                className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                {settingsKbSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}儲存
              </button>
            </div>
          </div>
        </div>
      )}

      <ErrorModal open={errorModal !== null} title={errorModal?.title} message={errorModal?.message ?? ''} onClose={() => setErrorModal(null)} />

      <ConfirmModal open={deleteKbTarget !== null} title="刪除知識庫"
        message={`確定要刪除「${deleteKbTarget?.name}」嗎？\n知識庫內所有文件也將一併刪除，此操作無法復原。`}
        confirmText="刪除" variant="danger" onConfirm={() => void handleDeleteKb()} onCancel={() => setDeleteKbTarget(null)} />

      <ConfirmModal open={deleteBotTarget !== null} title="刪除 Bot"
        message={`確定要刪除「${deleteBotTarget?.name}」嗎？此操作無法復原。`}
        confirmText="刪除" variant="danger" onConfirm={() => void handleDeleteBot()} onCancel={() => setDeleteBotTarget(null)} />

      <ConfirmModal open={deleteDocTarget !== null} title="刪除文件"
        message={`確定要刪除「${deleteDocTarget?.filename}」嗎？文件與所有切片將永久刪除。`}
        confirmText={deleteDocLoading ? '處理中…' : '刪除'} variant="danger"
        onConfirm={() => { if (!deleteDocLoading) void handleDeleteDoc() }}
        onCancel={() => !deleteDocLoading && setDeleteDocTarget(null)} />

      <ConfirmModal open={showClearConfirm} title="確認清除" message="確定要清除此段對話嗎？" confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          createChatThread({ agent_id: agent.id, title: null }).then((t) => setThreadId(t.id)).catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)} />

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：KB + Bot 列表 ══════════════════════════════════════════ */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-72'}`}
          style={{ backgroundColor: HEADER_COLOR }}
        >
          {/* Sidebar Header */}
          <div className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${sidebarCollapsed ? 'px-2' : 'pl-4 pr-2'}`}>
            {sidebarCollapsed ? (
              <button type="button" onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10" title="展開">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <span className="text-base font-semibold text-white">知識管理</span>
                <button type="button" onClick={() => setSidebarCollapsed(true)}
                  className="rounded-lg px-1 py-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white" title="折疊">
                  {'<<'}
                </button>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">

              {/* ── 知識庫 Section ── */}
              <div className="shrink-0">
                <button type="button" onClick={() => setKbSectionOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-white/5">
                  <Headphones className="h-3.5 w-3.5 text-white/60" />
                  <span className="flex-1 text-base font-semibold text-white/80">知識庫</span>
                  {canManage && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setCreatingKb(true); setKbMenuId(null) }}
                      className="rounded p-0.5 text-white/60 hover:bg-white/15 hover:text-white" title="新增知識庫">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {kbSectionOpen ? <ChevronUp className="h-3.5 w-3.5 text-white/40" /> : <ChevronDown className="h-3.5 w-3.5 text-white/40" />}
                </button>

                {kbSectionOpen && (
                  <div className="pb-1">
                    {creatingKb && (
                      <div className="border-b border-white/10 px-3 py-2 space-y-1.5">
                        <input ref={newKbInputRef} value={newKbName} onChange={(e) => setNewKbName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return
                            if (e.key === 'Enter') void handleCreateKb()
                            if (e.key === 'Escape') { setCreatingKb(false); setNewKbName(''); setNewKbModel('') }
                          }}
                          placeholder="知識庫名稱…"
                          className="w-full rounded-md bg-white/15 px-2 py-1.5 text-base text-white placeholder-white/40 outline-none focus:bg-white/20" maxLength={100} />
                        <LLMModelSelect value={newKbModel} onChange={setNewKbModel} label="" compact labelPosition="stacked"
                          selectClassName="w-full rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-base text-white focus:outline-none focus:border-white/40" />
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => void handleCreateKb()} disabled={newKbSaving || !newKbName.trim()}
                            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-sky-500/40 py-1 text-base font-medium text-white hover:bg-sky-500/60 disabled:opacity-50">
                            {newKbSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}建立
                          </button>
                          <button type="button" onClick={() => { setCreatingKb(false); setNewKbName(''); setNewKbModel('') }}
                            className="rounded-md px-2 py-1 text-base text-white/60 hover:bg-white/10 hover:text-white">取消</button>
                        </div>
                      </div>
                    )}
                    {kbsLoading ? (
                      <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
                    ) : kbs.length === 0 ? (
                      <p className="px-4 py-3 text-base text-white/40">尚無知識庫</p>
                    ) : (
                      <ul className="space-y-0.5 px-2">
                        {kbs.map((kb) => (
                          <li key={kb.id} className="relative" ref={kbMenuId === kb.id ? kbMenuRef : undefined}>
                            {renamingKbId === kb.id ? (
                              <div className="rounded-lg bg-white/15 px-2 py-1.5">
                                <input ref={renameKbInputRef} value={renameKbValue} onChange={(e) => setRenameKbValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.nativeEvent.isComposing) return
                                    if (e.key === 'Enter') void handleRenameKb(kb.id)
                                    if (e.key === 'Escape') setRenamingKbId(null)
                                  }}
                                  onBlur={() => void handleRenameKb(kb.id)}
                                  className="w-full bg-transparent text-base text-white outline-none" maxLength={100} />
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setSelectedKbId(kb.id); setKbMenuId(null) }}
                                className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                                  selectedKbId === kb.id ? 'bg-sky-500/30 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
                                }`}>
                                <span className="min-w-0 flex-1 truncate font-medium">{kb.name}</span>
                                <span className={`shrink-0 text-base ${selectedKbId === kb.id ? 'text-sky-200/80' : 'text-white/40'}`}>{kb.ready_count}/{kb.doc_count}</span>
                                {canManage && (
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setKbMenuId(kbMenuId === kb.id ? null : kb.id) }}
                                    className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </button>
                            )}
                            {kbMenuId === kb.id && (
                              <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-lg border border-white/20 bg-[#1a3a52] shadow-xl">
                                <button type="button" onClick={() => { setRenamingKbId(kb.id); setRenameKbValue(kb.name); setKbMenuId(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 hover:bg-white/10 hover:text-white">
                                  <Pencil className="h-3 w-3" />重命名
                                </button>
                                <button type="button" onClick={() => {
                                  setSettingsKb(kb); setSettingsKbModel(kb.model_name ?? ''); setSettingsKbPrompt(kb.system_prompt ?? '')
                                  setKbMenuId(null)
                                }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 hover:bg-white/10 hover:text-white">
                                  <Settings className="h-3 w-3" />設定
                                </button>
                                <button type="button" onClick={() => { setDeleteKbTarget(kb); setKbMenuId(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-red-300 hover:bg-red-500/20">
                                  <Trash2 className="h-3 w-3" />刪除
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {/* divider */}
              <div className="mx-3 border-t border-white/15" />

              {/* ── Bots Section ── */}
              <div className="shrink-0" style={{ backgroundColor: '#0d3d35' }}>
                <button type="button" onClick={() => setBotSectionOpen((v) => !v)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-white/5">
                  <Bot className="h-3.5 w-3.5 text-emerald-300/80" />
                  <span className="flex-1 text-base font-semibold text-emerald-100">Bots</span>
                  {canManage && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); setCreatingBot(true); setBotMenuId(null) }}
                      className="rounded p-0.5 text-emerald-300/60 hover:bg-white/15 hover:text-emerald-100" title="新增 Bot">
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {botSectionOpen ? <ChevronUp className="h-3.5 w-3.5 text-emerald-300/40" /> : <ChevronDown className="h-3.5 w-3.5 text-emerald-300/40" />}
                </button>

                {botSectionOpen && (
                  <div className="pb-2">
                    {creatingBot && (
                      <div className="border-b border-white/10 px-3 py-2 space-y-1.5">
                        <input ref={newBotInputRef} value={newBotName} onChange={(e) => setNewBotName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.nativeEvent.isComposing) return
                            if (e.key === 'Enter') void handleCreateBot()
                            if (e.key === 'Escape') { setCreatingBot(false); setNewBotName('') }
                          }}
                          placeholder="Bot 名稱…"
                          className="w-full rounded-md bg-white/15 px-2 py-1.5 text-base text-white placeholder-white/40 outline-none focus:bg-white/20" maxLength={100} />
                        <div className="flex gap-1.5">
                          <button type="button" onClick={() => void handleCreateBot()} disabled={newBotSaving || !newBotName.trim()}
                            className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-500/40 py-1 text-base font-medium text-white hover:bg-emerald-500/60 disabled:opacity-50">
                            {newBotSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}建立
                          </button>
                          <button type="button" onClick={() => { setCreatingBot(false); setNewBotName('') }}
                            className="rounded-md px-2 py-1 text-base text-white/60 hover:bg-white/10 hover:text-white">取消</button>
                        </div>
                      </div>
                    )}
                    {botsLoading ? (
                      <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
                    ) : bots.length === 0 ? (
                      <p className="px-4 py-3 text-base text-white/40">尚無 Bot</p>
                    ) : (
                      <ul className="space-y-0.5 px-2">
                        {bots.map((bot) => (
                          <li key={bot.id} className="relative" ref={botMenuId === bot.id ? botMenuRef : undefined}>
                            {renamingBotId === bot.id ? (
                              <div className="rounded-lg bg-white/15 px-2 py-1.5">
                                <input ref={renameBotInputRef} value={renameBotValue} onChange={(e) => setRenameBotValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.nativeEvent.isComposing) return
                                    if (e.key === 'Enter') void handleRenameBot(bot.id)
                                    if (e.key === 'Escape') setRenamingBotId(null)
                                  }}
                                  onBlur={() => void handleRenameBot(bot.id)}
                                  className="w-full bg-transparent text-base text-white outline-none" maxLength={100} />
                              </div>
                            ) : (
                              <button type="button" onClick={() => { setSelectedBotId(bot.id); setBotMenuId(null) }}
                                className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                                  selectedBotId === bot.id ? 'bg-emerald-400/25 text-emerald-50' : 'text-emerald-100/75 hover:bg-white/10 hover:text-emerald-100'
                                }`}>
                                <span className="min-w-0 flex-1 truncate font-medium">{bot.name}</span>
                                {!bot.is_active && <span className="shrink-0 rounded bg-black/20 px-1 text-base text-emerald-300/60">停用</span>}
                                {canManage && (
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setBotMenuId(botMenuId === bot.id ? null : bot.id) }}
                                    className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20">
                                    <MoreHorizontal className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </button>
                            )}
                            {botMenuId === bot.id && (
                              <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-lg border border-white/20 bg-[#0d3d35] shadow-xl">
                                <button type="button" onClick={() => { setRenamingBotId(bot.id); setRenameBotValue(bot.name); setBotMenuId(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 hover:bg-white/10 hover:text-white">
                                  <Pencil className="h-3 w-3" />重命名
                                </button>
                                <button type="button" onClick={() => { setSelectedBotId(bot.id); setRightTab('settings'); setBotMenuId(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 hover:bg-white/10 hover:text-white">
                                  <Settings className="h-3 w-3" />設定
                                </button>
                                <button type="button" onClick={() => { setDeleteBotTarget(bot); setBotMenuId(null) }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-red-300 hover:bg-red-500/20">
                                  <Trash2 className="h-3 w-3" />刪除
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>

        {/* ══ 中欄：文件管理 ════════════════════════════════════════════════ */}
        <div className="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-md">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-3">
            <div className="min-w-0 flex-1">
              {selectedKb ? (
                <>
                  <h2 className="truncate text-base font-semibold text-gray-800">{selectedKb.name}</h2>
                  <p className="text-base text-gray-400">{selectedKb.doc_count} 份文件・{selectedKb.ready_count} 份就緒</p>
                </>
              ) : (
                <p className="text-base text-gray-400">請選擇知識庫</p>
              )}
            </div>
            {selectedKbId && (
              <button type="button" onClick={() => loadDocs(selectedKbId)}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600">
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

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
                {canManage && <p className="text-base text-gray-300">點擊下方「上傳文件」開始建立知識庫</p>}
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
                    <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
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
                    <li key={doc.id} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
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
                        <p className="line-clamp-2 break-all text-base font-medium text-gray-700" title={doc.filename}>{doc.filename}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge status={doc.status} />
                          {doc.chunk_count != null && doc.status === 'ready' && <span className="text-base text-gray-400">{doc.chunk_count} 段</span>}
                          {doc.size_bytes != null && <span className="text-base text-gray-300">{formatBytes(doc.size_bytes)}</span>}
                        </div>
                        {doc.status === 'error' && doc.error_message && (
                          <p className="mt-0.5 truncate text-base text-red-400">{doc.error_message}</p>
                        )}
                      </div>
                      {canManage && (
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

          {canManage && selectedKbId && (
            <div className="shrink-0 border-t border-gray-100 p-3">
              <button type="button" onClick={() => setUploadModalOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-base font-medium text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: HEADER_COLOR }}>
                <Upload className="h-4 w-4" />上傳文件
              </button>
            </div>
          )}
        </div>

        {/* ══ 右欄：Bot 測試 / 設定 / 部署 ══════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            <button type="button" onClick={() => setRightTab('chat')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'chat' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              測試 Chat
            </button>
            <button type="button" onClick={() => setRightTab('settings')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'settings' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              Bot 設定
            </button>
            <button type="button" onClick={() => setRightTab('deploy')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'deploy' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              部署
            </button>

            {rightTab === 'chat' && selectedBot && (
              <>
                <span className="mx-1 text-gray-200">|</span>
                <span className="text-base font-medium text-gray-600 truncate">{selectedBot.name}</span>
                {selectedBot.model_name ? (
                  <><span className="text-gray-300">·</span><span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-base text-sky-700">{selectedBot.model_name}</span></>
                ) : (
                  <><span className="text-gray-300">·</span><span className="shrink-0 text-base text-amber-500">尚未設定模型</span></>
                )}
                {!selectedBot.is_active && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-base text-gray-400">已停用</span>}
                <button type="button" onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                  disabled={isLoading || messages.length === 0}
                  className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50">
                  <RefreshCw className="h-5 w-5" />
                </button>
              </>
            )}
          </div>

          {/* ── 測試 Chat ── */}
          {rightTab === 'chat' && (
            <AgentChat
              messages={messages}
              onSubmit={handleSendMessage}
              isLoading={isLoading}
              headerTitle=""
              emptyPlaceholder={
                !selectedBot ? '請在左側選擇 Bot 後開始提問。'
                : !selectedBot.model_name ? `「${selectedBot.name}」尚未設定模型，請先至 Bot 設定完成設定。`
                : !selectedBot.is_active ? `「${selectedBot.name}」已停用。`
                : selectedBot.knowledge_bases.length === 0 ? `「${selectedBot.name}」尚未選擇知識庫，請至 Bot 設定選擇 KB。`
                : `Bot：${selectedBot.name}\n輸入問題，AI 將從已選知識庫中搜尋相關資料回答。`
              }
              onCopySuccess={() => showToast('已複製到剪貼簿')}
              onCopyError={() => showToast('複製失敗', 'error')}
              showChart={false}
              showPdf={false}
            />
          )}

          {/* ── Bot 設定 ── */}
          {rightTab === 'settings' && (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {!selectedBot ? (
                <p className="text-base text-gray-400">請先在左側選擇 Bot</p>
              ) : (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                    <div>
                      <p className="text-base font-medium text-gray-700">啟用 Bot</p>
                      <p className="text-base text-gray-400">停用後 Widget、API、測試 Chat 全部拒絕服務</p>
                    </div>
                    {canManage ? (
                      <button type="button" onClick={() => setSettingsActive((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${settingsActive ? 'bg-blue-600' : 'bg-gray-300'}`}>
                        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${settingsActive ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-base font-medium ${settingsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {settingsActive ? '啟用中' : '已停用'}
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                    <LLMModelSelect value={settingsModel} onChange={setSettingsModel} label="" labelPosition="stacked" allowEmpty emptyLabel="無"
                      selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">知識來源（KB）</label>
                    <div className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                      {kbs.length === 0 ? (
                        <p className="text-base text-gray-400">尚無知識庫，請先在左側新增</p>
                      ) : kbs.map((kb) => {
                        const checked = settingsKbIds.some((item) => item.knowledge_base_id === kb.id)
                        return (
                          <label key={kb.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                            <input type="checkbox" checked={checked} onChange={() => toggleKb(kb.id)} disabled={!canManage}
                              className="h-4 w-4 shrink-0 cursor-pointer accent-sky-500" />
                            <span className="flex-1 text-base text-gray-700">{kb.name}</span>
                            <span className="text-base text-gray-400">{kb.ready_count} 份</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">
                      自訂系統提示詞<span className="ml-1 font-normal text-gray-400">（選填）</span>
                    </label>
                    <textarea value={settingsPrompt} onChange={(e) => setSettingsPrompt(e.target.value)} disabled={!canManage} rows={8}
                      placeholder="你是 XX 公司的客服助手，請根據知識庫文件回答問題…"
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60" />
                  </div>

                  {canManage && (
                    <div className="flex justify-end">
                      <button type="button" onClick={() => void handleSaveBotSettings()} disabled={settingsSaving}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                        {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}儲存 Bot 設定
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── 部署 ── */}
          {rightTab === 'deploy' && (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
              {!selectedBot ? (
                <p className="text-base text-gray-400">請先在左側選擇 Bot</p>
              ) : (
                <>
                  <div>
                    <p className="mb-1 text-base font-semibold text-gray-700">嵌入式 Widget</p>
                    <p className="mb-3 text-base text-gray-400">產生 Token 後可將 Widget 嵌入到任何網頁</p>
                    {selectedBot.public_token ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input readOnly value={`${window.location.origin}/widget/bot/${selectedBot.public_token}`}
                            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base font-mono text-gray-700 focus:outline-none"
                            onClick={(e) => (e.target as HTMLInputElement).select()} />
                          <button type="button" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/widget/bot/${selectedBot.public_token}`); showToast('連結已複製') }}
                            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-700 hover:bg-gray-50">複製</button>
                        </div>
                        {isAdmin && (
                          <button type="button" onClick={() => void handleRevokeToken()} className="text-base text-red-500 hover:underline">停用 Widget Token</button>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="mb-2 text-base text-gray-400">尚未產生 Widget Token</p>
                        {isAdmin ? (
                          <button type="button" onClick={() => void handleGenerateToken()}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700">
                            產生 Widget Token
                          </button>
                        ) : (
                          <p className="text-base text-gray-400">請聯繫系統管理員開通</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-4 space-y-3">
                    <p className="text-base font-semibold text-gray-700">Widget 外觀</p>
                    <div>
                      <label className="mb-1 block text-base font-medium text-gray-700">顯示名稱</label>
                      <input type="text" value={settingsWidgetTitle} onChange={(e) => setSettingsWidgetTitle(e.target.value)} disabled={!canManage}
                        placeholder={selectedBot.name}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" />
                    </div>
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-base font-medium text-gray-700">主色</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={settingsWidgetColor} onChange={(e) => setSettingsWidgetColor(e.target.value)} disabled={!canManage}
                            className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5 disabled:opacity-60" />
                          <input type="text" value={settingsWidgetColor} onChange={(e) => setSettingsWidgetColor(e.target.value)} disabled={!canManage}
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none" />
                        </div>
                      </div>
                      <div className="w-36">
                        <label className="mb-1 block text-base font-medium text-gray-700">語言</label>
                        <select value={settingsWidgetLang} onChange={(e) => setSettingsWidgetLang(e.target.value)} disabled={!canManage}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none">
                          <option value="zh-TW">繁中</option>
                          <option value="zh-CN">簡中</option>
                          <option value="en">English</option>
                          <option value="ja">日本語</option>
                        </select>
                      </div>
                    </div>
                    {canManage && (
                      <div className="flex justify-end">
                        <button type="button" onClick={() => void handleSaveBotSettings()} disabled={settingsSaving}
                          className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-60">
                          {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}儲存
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
