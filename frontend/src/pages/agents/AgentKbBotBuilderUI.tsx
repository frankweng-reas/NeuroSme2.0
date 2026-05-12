/**
 * KB Bot Builder Agent UI（agent_id = kb-bot-builder）
 * 兩欄式：左=Bot 列表 / 右=Bot 設定 + 測試 Chat + 部署
 * 對象：manager+（建立/設定/部署 Bot）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  BarChart2,
  Check,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { chatCompletionsStream } from '@/api/chat'
import {
  createBot,
  deleteBot,
  generateBotToken,
  getBotQueryStats,
  listBots,
  revokeBotToken,
  updateBot,
  type Bot as BotType,
  type BotKbItem,
  type BotQueryStatsResponse,
  type BotQueryStatsView,
} from '@/api/bots'
import { listKnowledgeBases, type KmKnowledgeBase } from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread, listChatMessages } from '@/api/chatThreads'
import {
  listBotWidgetSessions,
  getBotWidgetSessionMessages,
  type WidgetSessionItem,
  type WidgetSessionDetail,
} from '@/api/widget_admin'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, UserRole } from '@/types'
import AgentKbBotApiKeys from './AgentKbBotApiKeys'

interface Props { agent: Agent }

const BOT_COLOR = '#0d3d35'

const threadStorageKey = (botId: number) => `kb-bot-thread-${botId}`

type RightTab = 'chat' | 'history' | 'api' | 'settings' | 'deploy' | 'stats'

export default function AgentKbBotBuilderUI({ agent }: Props) {
  const [userRole, setUserRole] = useState<UserRole>('member')
  const canManage = userRole === 'admin' || userRole === 'super_admin' || userRole === 'manager'
  const isAdmin = userRole === 'admin' || userRole === 'super_admin'

  useEffect(() => {
    getMe().then((me) => setUserRole(me.role as UserRole)).catch(() => {})
  }, [])

  // ── 左欄：Bot 列表 ────────────────────────────────────────────────────────
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [bots, setBots] = useState<BotType[]>([])
  const [botsLoading, setBotsLoading] = useState(true)
  const [selectedBotId, setSelectedBotId] = useState<number | null>(null)
  const [botMenuId, setBotMenuId] = useState<number | null>(null)
  const botMenuRef = useRef<HTMLLIElement | null>(null)

  const [creatingBot, setCreatingBot] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  const [newBotSaving, setNewBotSaving] = useState(false)
  const newBotInputRef = useRef<HTMLInputElement>(null)

  const [settingsName, setSettingsName] = useState('')

  const [deleteBotTarget, setDeleteBotTarget] = useState<BotType | null>(null)

  // ── KB 列表（供設定時選擇）────────────────────────────────────────────────
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])

  // ── 右欄 Tab ──────────────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<RightTab>('chat')

  // ── Bot 設定欄位 ──────────────────────────────────────────────────────────
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsWidgetTitle, setSettingsWidgetTitle] = useState('')
  const [settingsWidgetLogoUrl, setSettingsWidgetLogoUrl] = useState('')
  const [settingsWidgetColor, setSettingsWidgetColor] = useState('#1A3A52')
  const [settingsWidgetLang, setSettingsWidgetLang] = useState('zh-TW')
  const [settingsWidgetVoiceEnabled, setSettingsWidgetVoiceEnabled] = useState(false)
  const [settingsWidgetVoicePrompt, setSettingsWidgetVoicePrompt] = useState('')
  const [settingsKbIds, setSettingsKbIds] = useState<BotKbItem[]>([])
  const [settingsSaving, setSettingsSaving] = useState(false)

  // ── 訪客對話 ──────────────────────────────────────────────────────────────
  const [wSessions, setWSessions] = useState<WidgetSessionItem[]>([])
  const [wSessionsLoading, setWSessionsLoading] = useState(false)
  const [wDetail, setWDetail] = useState<WidgetSessionDetail | null>(null)
  const [wDetailLoading, setWDetailLoading] = useState(false)

  // ── 查詢統計 ──────────────────────────────────────────────────────────────
  const [statsDays, setStatsDays] = useState<7 | 30 | 90>(30)
  const [statsView, setStatsView] = useState<BotQueryStatsView>('top_queries')
  const [statsData, setStatsData] = useState<BotQueryStatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsOffset, setStatsOffset] = useState(0)

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  // ── Toast / Error ─────────────────────────────────────────────────────────
  const [toast, setToast] = useState<{ msg: string; type: 'info' | 'error' } | null>(null)
  const showToast = useCallback((msg: string, type: 'info' | 'error' = 'info') => setToast({ msg, type }), [])
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  // ── 初始載入 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([listBots(), listKnowledgeBases()])
      .then(([botList, kbList]) => {
        setBots(botList)
        setKbs(kbList)
        if (botList.length > 0) setSelectedBotId(botList[0].id)
      })
      .catch(() => {})
      .finally(() => setBotsLoading(false))
  }, [])

  useEffect(() => {
    if (!botMenuId) return
    const handler = (e: MouseEvent) => {
      if (botMenuRef.current && !botMenuRef.current.contains(e.target as Node)) setBotMenuId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [botMenuId])

  useEffect(() => { if (creatingBot) newBotInputRef.current?.focus() }, [creatingBot])

  // 選中 Bot 時初始化設定欄位
  const selectedBot = bots.find((b) => b.id === selectedBotId) ?? null

  useEffect(() => {
    if (!selectedBot) return
    setSettingsName(selectedBot.name)
    setSettingsModel(selectedBot.model_name ?? '')
    setSettingsPrompt(selectedBot.system_prompt ?? '')
    setSettingsWidgetTitle(selectedBot.widget_title ?? '')
    setSettingsWidgetLogoUrl(selectedBot.widget_logo_url ?? '')
    setSettingsWidgetColor(selectedBot.widget_color ?? '#1A3A52')
    setSettingsWidgetLang(selectedBot.widget_lang ?? 'zh-TW')
    setSettingsWidgetVoiceEnabled(selectedBot.widget_voice_enabled ?? false)
    setSettingsWidgetVoicePrompt(selectedBot.widget_voice_prompt ?? '')
    setSettingsKbIds(selectedBot.knowledge_bases.map((kb) => ({ knowledge_base_id: kb.knowledge_base_id, sort_order: kb.sort_order })))
    setMessages([])
    setWDetail(null)
    setWSessions([])
    setStatsData(null)
    setStatsOffset(0)

    // 嘗試從 localStorage 復原舊 thread，沒有或失效時建新的
    const savedThreadId = localStorage.getItem(threadStorageKey(selectedBot.id))
    if (savedThreadId) {
      setThreadId(savedThreadId)
      listChatMessages(savedThreadId)
        .then((msgs) => {
          setMessages(
            msgs.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          )
        })
        .catch(() => {
          localStorage.removeItem(threadStorageKey(selectedBot.id))
          setMessages([])
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => {
              setThreadId(t.id)
              localStorage.setItem(threadStorageKey(selectedBot.id), t.id)
            })
            .catch(() => {})
        })
    } else {
      createChatThread({ agent_id: agent.id, title: null })
        .then((t) => {
          setThreadId(t.id)
          localStorage.setItem(threadStorageKey(selectedBot.id), t.id)
        })
        .catch(() => {})
    }
  }, [selectedBotId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 切換到 history tab 時載入 sessions
  useEffect(() => {
    if (rightTab !== 'history' || !selectedBot) return
    setWSessionsLoading(true)
    setWDetail(null)
    listBotWidgetSessions(selectedBot.id)
      .then(setWSessions)
      .catch(() => setWSessions([]))
      .finally(() => setWSessionsLoading(false))
  }, [rightTab, selectedBot])

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

  const handleToggleActive = async () => {
    if (!selectedBot) return
    const newValue = !selectedBot.is_active
    try {
      const updated = await updateBot(selectedBot.id, { is_active: newValue })
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
      showToast(newValue ? 'Bot 已啟用' : 'Bot 已暫停')
    } catch (err) {
      setErrorModal({ title: '更新失敗', message: err instanceof Error ? err.message : '更新失敗' })
    }
  }

  const handleSaveSettings = async () => {
    if (!selectedBot) return
    setSettingsSaving(true)
    try {
      const updated = await updateBot(selectedBot.id, {
        name: settingsName.trim() || selectedBot.name,
        model_name: settingsModel,
        system_prompt: settingsPrompt,
        widget_title: settingsWidgetTitle,
        widget_logo_url: settingsWidgetLogoUrl || undefined,
        widget_color: settingsWidgetColor,
        widget_lang: settingsWidgetLang,
        widget_voice_enabled: settingsWidgetVoiceEnabled,
        widget_voice_prompt: settingsWidgetVoicePrompt || undefined,
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
    [agent.agent_id, isLoading, messages, bots, threadId]
  )

  const loadStats = useCallback(async (
    botId: number,
    days: 7 | 30 | 90,
    view: BotQueryStatsView,
    offset: number,
  ) => {
    setStatsLoading(true)
    try {
      const data = await getBotQueryStats(botId, { days, view, limit: 20, offset })
      setStatsData(data)
      setStatsOffset(offset)
    } catch {
      // 靜默失敗
    } finally {
      setStatsLoading(false)
    }
  }, [])

  function toggleKb(kbId: number) {
    setSettingsKbIds((prev) => {
      const exists = prev.find((item) => item.knowledge_base_id === kbId)
      if (exists) return prev.filter((item) => item.knowledge_base_id !== kbId)
      return [...prev, { knowledge_base_id: kbId, sort_order: prev.length }]
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      {toast && (
        <div className={`fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg px-4 py-2 text-base text-white shadow-lg ${toast.type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}
          role={toast.type === 'error' ? 'alert' : 'status'}>{toast.msg}</div>
      )}

      <ErrorModal open={errorModal !== null} title={errorModal?.title} message={errorModal?.message ?? ''} onClose={() => setErrorModal(null)} />
      <ConfirmModal open={deleteBotTarget !== null} title="刪除 Bot"
        message={`確定要刪除「${deleteBotTarget?.name}」嗎？此操作無法復原。`}
        confirmText="刪除" variant="danger" onConfirm={() => void handleDeleteBot()} onCancel={() => setDeleteBotTarget(null)} />
      <ConfirmModal open={showClearConfirm} title="確認清除" message="確定要清除此段對話嗎？" confirmText="確認清除"
        onConfirm={() => {
          setMessages([])
          setShowClearConfirm(false)
          if (selectedBotId != null) localStorage.removeItem(threadStorageKey(selectedBotId))
          createChatThread({ agent_id: agent.id, title: null })
            .then((t) => {
              setThreadId(t.id)
              if (selectedBotId != null) localStorage.setItem(threadStorageKey(selectedBotId), t.id)
            })
            .catch(() => {})
        }}
        onCancel={() => setShowClearConfirm(false)} />

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-kb-bot-builder.md" title="KB Bot Builder 使用說明" />
      <AgentHeader agent={agent} headerBackgroundColor={BOT_COLOR} onOnlineHelpClick={() => setHelpOpen(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：Bot 列表 ═══════════════════════════════════════════════ */}
        <div className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-72'}`}
          style={{ backgroundColor: BOT_COLOR }}>
          <div className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${sidebarCollapsed ? 'px-2' : 'pl-4 pr-2'}`}>
            {sidebarCollapsed ? (
              <button type="button" onClick={() => setSidebarCollapsed(false)}
                className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10" title="展開">
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-emerald-300/80" />
                  <span className="text-lg font-semibold text-emerald-100">Bots</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {canManage && (
                    <button type="button" onClick={() => { setCreatingBot(true); setBotMenuId(null) }}
                      className="rounded-lg p-1.5 text-emerald-300/70 hover:bg-white/15 hover:text-emerald-100" title="新增 Bot">
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                  <button type="button" onClick={() => setSidebarCollapsed(true)}
                    className="rounded-lg px-1 py-1 text-emerald-300/60 hover:bg-white/10 hover:text-emerald-100" title="折疊">
                    {'<<'}
                  </button>
                </div>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {creatingBot && (
                <div className="shrink-0 border-b border-white/10 px-3 py-2 space-y-1.5">
                  <input ref={newBotInputRef} value={newBotName} onChange={(e) => setNewBotName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === 'Enter') void handleCreateBot()
                      if (e.key === 'Escape') { setCreatingBot(false); setNewBotName('') }
                    }}
                    placeholder="Bot 名稱…"
                    className="w-full rounded-md bg-white/15 px-2 py-1.5 text-lg text-white placeholder-white/40 outline-none focus:bg-white/20" maxLength={100} />
                  <div className="flex gap-1.5">
                    <button type="button" onClick={() => void handleCreateBot()} disabled={newBotSaving || !newBotName.trim()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-500/40 py-1 text-lg font-medium text-white hover:bg-emerald-500/60 disabled:opacity-50">
                      {newBotSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}建立
                    </button>
                    <button type="button" onClick={() => { setCreatingBot(false); setNewBotName('') }}
                      className="rounded-md px-2 py-1 text-lg text-emerald-200/60 hover:bg-white/10 hover:text-emerald-100">取消</button>
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {botsLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-4 w-4 animate-spin text-white/50" /></div>
                ) : bots.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-lg leading-relaxed text-emerald-200/40">
                      尚無 Bot{canManage && <> ，點擊 <Plus className="inline h-3 w-3" /> 新增</>}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-0.5 px-2">
                    {bots.map((bot) => (
                      <li key={bot.id} className="relative" ref={botMenuId === bot.id ? botMenuRef : undefined}>
                        {(
                          <button type="button" onClick={() => { setSelectedBotId(bot.id); setBotMenuId(null) }}
                            className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-lg transition-colors ${
                              selectedBotId === bot.id ? 'bg-emerald-400/25 text-emerald-50' : 'text-emerald-100/75 hover:bg-white/10 hover:text-emerald-100'
                            }`}>
                            <span className="min-w-0 flex-1 truncate font-medium">{bot.name}</span>
                            {!bot.is_active && <span className="shrink-0 rounded bg-black/20 px-1 text-lg text-emerald-300/60">停用</span>}
                            {canManage && (
                              <button type="button" onClick={(e) => { e.stopPropagation(); setBotMenuId(botMenuId === bot.id ? null : bot.id) }}
                                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20">
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </button>
                        )}
                        {botMenuId === bot.id && (
                          <div className="absolute right-0 top-full z-20 mt-0.5 w-32 overflow-hidden rounded-lg border border-white/20 shadow-xl" style={{ backgroundColor: BOT_COLOR }}>
                            <button type="button" onClick={() => { setSelectedBotId(bot.id); setRightTab('settings'); setBotMenuId(null) }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-emerald-100/80 hover:bg-white/10 hover:text-emerald-100">
                              <Bot className="h-3.5 w-3.5" />設定
                            </button>
                            <button type="button" onClick={() => { setDeleteBotTarget(bot); setBotMenuId(null) }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-lg text-red-300 hover:bg-red-500/20">
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

        {/* ══ 右欄 ════════════════════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          <div className="flex shrink-0 items-center gap-0 border-b-2 border-gray-200 bg-white px-4">
            {(
              [
                { key: 'chat',     label: '測試 Chat' },
                { key: 'history',  label: '訪客對話' },
                { key: 'api',      label: 'API 整合' },
                { key: 'settings', label: 'Bot 設定' },
                { key: 'deploy',   label: '部署' },
                { key: 'stats',    label: '查詢統計' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setRightTab(key)}
                className={`relative px-4 py-3 text-lg font-semibold transition-colors focus:outline-none ${
                  rightTab === key
                    ? 'text-emerald-700 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-emerald-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {label}
              </button>
            ))}


            {rightTab === 'chat' && selectedBot && (
              <>
                <div className="ml-auto flex items-center gap-2">
                  {!selectedBot.is_active && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-base text-gray-400">已停用</span>}
                  {selectedBot.model_name
                    ? <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-base text-emerald-700">{selectedBot.model_name}</span>
                    : <span className="shrink-0 text-base text-amber-500">尚未設定模型</span>}
                  <button type="button" onClick={() => messages.length > 0 && setShowClearConfirm(true)}
                    disabled={isLoading || messages.length === 0}
                    className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    <RefreshCw className="h-5 w-5" />
                  </button>
                </div>
              </>
            )}
            {rightTab === 'history' && selectedBot && (
              <button type="button" onClick={() => {
                setWSessionsLoading(true)
                setWDetail(null)
                listBotWidgetSessions(selectedBot.id)
                  .then(setWSessions)
                  .catch(() => setWSessions([]))
                  .finally(() => setWSessionsLoading(false))
              }}
                className="ml-auto rounded-lg border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50"
                aria-label="重新整理">
                <RefreshCw className="h-5 w-5" />
              </button>
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
                !selectedBot ? '請在左側選擇 Bot 後開始測試。'
                : !selectedBot.model_name ? `「${selectedBot.name}」尚未設定模型，請先至「Bot 設定」完成設定。`
                : !selectedBot.is_active ? `「${selectedBot.name}」已停用。`
                : selectedBot.knowledge_bases.length === 0 ? `「${selectedBot.name}」尚未選擇知識庫，請至「Bot 設定」選擇 KB。`
                : `Bot：${selectedBot.name}\n輸入問題，AI 將從已選知識庫中搜尋相關資料回答。`
              }
              onCopySuccess={() => showToast('已複製到剪貼簿')}
              onCopyError={() => showToast('複製失敗', 'error')}
              showChart={false}
              showPdf={false}
            />
          )}

          {/* ── 訪客對話 ── */}
          {rightTab === 'history' && (
            <div className="flex min-h-0 flex-1 overflow-hidden">
              {/* session 列表 */}
              <div className="w-64 shrink-0 overflow-y-auto border-r border-gray-100">
                {!selectedBot ? (
                  <p className="p-4 text-base text-gray-400">請先選擇 Bot</p>
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
                        <button type="button"
                          onClick={() => {
                            setWDetailLoading(true)
                            getBotWidgetSessionMessages(s.session_id)
                              .then(setWDetail)
                              .catch(() => setWDetail(null))
                              .finally(() => setWDetailLoading(false))
                          }}
                          className={`w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${wDetail?.session_id === s.session_id ? 'bg-sky-50' : ''}`}>
                          <p className="truncate text-base font-medium text-gray-700">
                            {s.visitor_name || '匿名訪客'}
                          </p>
                          {s.visitor_email && (
                            <p className="truncate text-base text-gray-400">{s.visitor_email}</p>
                          )}
                          <p className="mt-0.5 text-base text-gray-400">
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
                    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3 text-base text-gray-600">
                      <p><span className="font-medium">訪客：</span>{wDetail.visitor_name || '匿名'}</p>
                      {wDetail.visitor_email && <p><span className="font-medium">Email：</span>{wDetail.visitor_email}</p>}
                      {wDetail.visitor_phone && <p><span className="font-medium">電話：</span>{wDetail.visitor_phone}</p>}
                      <p><span className="font-medium">開始時間：</span>{new Date(wDetail.created_at).toLocaleString('zh-TW')}</p>
                    </div>
                    <ul className="space-y-3">
                      {wDetail.messages.map((m) => (
                        <li key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
                            m.role === 'user' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-800'
                          }`}>
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
            <AgentKbBotApiKeys canManage={canManage} bots={bots} selectedBotId={selectedBotId} selectedBot={selectedBot} />
          )}

          {/* ── Bot 設定 ── */}
          {rightTab === 'settings' && (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {!selectedBot ? (
                <p className="text-base text-gray-400">請先在左側選擇 Bot</p>
              ) : (
                <>
                  {/* Bot 名稱 */}
                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">Bot 名稱</label>
                    <input
                      type="text"
                      value={settingsName}
                      onChange={(e) => setSettingsName(e.target.value)}
                      disabled={!canManage}
                      maxLength={100}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:opacity-60"
                    />
                  </div>

                  {/* LLM 模型 */}
                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">LLM 模型</label>
                    <LLMModelSelect value={settingsModel} onChange={setSettingsModel} label="" labelPosition="stacked" allowEmpty emptyLabel="無"
                      selectClassName="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                  </div>

                  {/* 知識來源 */}
                  <div>
                    <label className="mb-1 block text-base font-medium text-gray-700">知識來源（KB）</label>
                    <p className="mb-2 text-base text-gray-400">在「KB 管理」建立知識庫後，可在此勾選引用</p>
                    <div className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                      {kbs.filter((kb) => kb.scope === 'company').length === 0 ? (
                        <p className="text-base text-gray-400">尚無公司知識庫，請先至「KB 管理」建立 Company 知識庫</p>
                      ) : kbs.filter((kb) => kb.scope === 'company').map((kb) => {
                        const checked = settingsKbIds.some((item) => item.knowledge_base_id === kb.id)
                        return (
                          <label key={kb.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                            <input type="checkbox" checked={checked} onChange={() => toggleKb(kb.id)} disabled={!canManage}
                              className="h-4 w-4 shrink-0 cursor-pointer accent-emerald-600" />
                            <span className="flex-1 text-base text-gray-700">{kb.name}</span>
                            <span className="text-base text-gray-400">{kb.ready_count} 份</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  {/* System Prompt */}
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
                      <button type="button" onClick={() => void handleSaveSettings()} disabled={settingsSaving}
                        className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-base font-medium text-white hover:opacity-90 disabled:opacity-60"
                        style={{ backgroundColor: BOT_COLOR }}>
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
                  {/* ── 服務狀態 ── */}
                  <div className="rounded-xl border border-gray-200 px-4 py-4">
                    <p className="mb-3 text-base font-semibold text-gray-700">服務狀態</p>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-base font-medium text-gray-700">
                          {selectedBot.is_active ? '目前運行中' : '目前已暫停'}
                        </p>
                        <p className="text-base text-gray-400">
                          暫停後 Widget、API、測試 Chat 均拒絕服務；恢復後 Widget URL 不變
                        </p>
                      </div>
                      {canManage ? (
                        <button
                          type="button"
                          onClick={() => void handleToggleActive()}
                          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${selectedBot.is_active ? 'bg-emerald-600' : 'bg-gray-300'}`}
                        >
                          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${selectedBot.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      ) : (
                        <span className={`rounded-full px-3 py-1 text-base font-medium ${selectedBot.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                          {selectedBot.is_active ? '運行中' : '已暫停'}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── 嵌入式 Widget ── */}
                  <div className="rounded-xl border border-gray-200 px-4 py-4">
                    <p className="mb-1 text-base font-semibold text-gray-700">嵌入式 Widget</p>
                    <p className="mb-3 text-base text-gray-400">產生 Token 後可將 Bot Widget 嵌入到任何網頁</p>
                    {selectedBot.public_token ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input readOnly value={`${window.location.origin}/widget/bot/${selectedBot.public_token}`}
                            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base font-mono text-gray-700 focus:outline-none"
                            onClick={(e) => (e.target as HTMLInputElement).select()} />
                          <button type="button" onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/widget/bot/${selectedBot.public_token}`)
                            showToast('連結已複製')
                          }} className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-700 hover:bg-gray-50">複製</button>
                        </div>
                        {isAdmin && (
                          <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                            <p className="text-base text-red-700 font-medium">撤銷 Widget Token</p>
                            <p className="mt-0.5 text-base text-red-500">撤銷後舊 Widget 連結永久失效，需重新產生新 Token（URL 會改變）</p>
                            <button type="button" onClick={() => void handleRevokeToken()} className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-base text-red-600 hover:bg-red-50">確認撤銷</button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="mb-2 text-base text-gray-400">尚未產生 Widget Token</p>
                        {isAdmin ? (
                          <button type="button" onClick={() => void handleGenerateToken()}
                            className="rounded-lg px-4 py-2 text-base font-medium text-white hover:opacity-90"
                            style={{ backgroundColor: BOT_COLOR }}>
                            產生 Widget Token
                          </button>
                        ) : (
                          <p className="text-base text-gray-400">請聯繫系統管理員開通</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-gray-200 px-4 py-4 space-y-3">
                    <p className="text-base font-semibold text-gray-700">Widget 外觀</p>

                    {/* Logo */}
                    <div>
                      <label className="mb-1 block text-base font-medium text-gray-700">Logo</label>
                      <div className="flex items-center gap-4">
                        {settingsWidgetLogoUrl ? (
                          <img src={settingsWidgetLogoUrl} alt="logo preview"
                            className="h-12 w-12 rounded-lg border border-gray-200 object-contain p-0.5" />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
                            <Bot className="h-5 w-5 text-gray-300" />
                          </div>
                        )}
                        <div className="flex gap-2">
                          <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 hover:bg-gray-50">
                            上傳圖片
                            <input type="file" accept="image/*" className="hidden" disabled={!canManage}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (!file) return
                                const reader = new FileReader()
                                reader.onload = (ev) => setSettingsWidgetLogoUrl(ev.target?.result as string ?? '')
                                reader.readAsDataURL(file)
                              }} />
                          </label>
                          {settingsWidgetLogoUrl && (
                            <button type="button" onClick={() => setSettingsWidgetLogoUrl('')}
                              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-base text-red-500 hover:bg-red-50">
                              移除
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* 顯示名稱 */}
                    <div>
                      <label className="mb-1 block text-base font-medium text-gray-700">Widget 顯示名稱</label>
                      <input type="text" value={settingsWidgetTitle} onChange={(e) => setSettingsWidgetTitle(e.target.value)} disabled={!canManage}
                        placeholder={selectedBot.name}
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                    </div>

                    {/* 主色 + 語言 */}
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-base font-medium text-gray-700">主色</label>
                        <div className="flex items-center gap-2">
                          <input type="color" value={settingsWidgetColor} onChange={(e) => setSettingsWidgetColor(e.target.value)} disabled={!canManage}
                            className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5 disabled:opacity-60" />
                          <input type="text" value={settingsWidgetColor} onChange={(e) => setSettingsWidgetColor(e.target.value)} disabled={!canManage}
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-emerald-500 focus:outline-none" />
                        </div>
                      </div>
                      <div className="w-36">
                        <label className="mb-1 block text-base font-medium text-gray-700">語言</label>
                        <select value={settingsWidgetLang} onChange={(e) => setSettingsWidgetLang(e.target.value)} disabled={!canManage}
                          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-emerald-500 focus:outline-none">
                          <option value="zh-TW">繁中</option>
                          <option value="zh-CN">簡中</option>
                          <option value="en">English</option>
                          <option value="ja">日本語</option>
                        </select>
                      </div>
                    </div>

                    {/* 語音 */}
                    <div>
                      <label className="flex cursor-pointer items-center gap-2.5">
                        <input type="checkbox" checked={settingsWidgetVoiceEnabled}
                          onChange={(e) => setSettingsWidgetVoiceEnabled(e.target.checked)}
                          disabled={!canManage}
                          className="h-4 w-4 rounded border-gray-300 accent-emerald-600" />
                        <span className="text-base font-medium text-gray-700">啟用語音</span>
                        <span className="text-base text-gray-400">（顯示麥克風按鈕）</span>
                      </label>
                      {settingsWidgetVoiceEnabled && (
                        <div className="mt-2">
                          <label className="mb-1 block text-base font-medium text-gray-700">
                            語音辨識提示詞
                            <span className="ml-1 font-normal text-gray-400">（選填：列出常見詞彙，提升辨識準確率）</span>
                          </label>
                          <textarea value={settingsWidgetVoicePrompt}
                            onChange={(e) => setSettingsWidgetVoicePrompt(e.target.value)}
                            disabled={!canManage}
                            rows={3}
                            placeholder="例：常見詞彙：專有名詞A、產品名稱B..."
                            className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                        </div>
                      )}
                    </div>

                    {canManage && (
                      <div className="flex justify-end">
                        <button type="button" onClick={() => void handleSaveSettings()} disabled={settingsSaving}
                          className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-base font-medium text-white hover:opacity-90 disabled:opacity-60"
                          style={{ backgroundColor: BOT_COLOR }}>
                          {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}儲存
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── 查詢統計 ─────────────────────────────────────────────────── */}
          {rightTab === 'stats' && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {!selectedBot ? (
                <div className="flex flex-1 items-center justify-center text-base text-gray-400">請先在左側選擇 Bot</div>
              ) : (
                <>
                  {/* 篩選列 */}
                  <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 bg-gray-100 px-4 py-2">
                    <span className="text-base text-gray-500">近</span>
                    {([7, 30, 90] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => {
                          setStatsDays(d)
                          if (selectedBotId) loadStats(selectedBotId, d, statsView, 0)
                        }}
                        className={`rounded-full px-2.5 py-0.5 text-base font-medium transition-colors ${
                          statsDays === d
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                        }`}
                      >
                        {d}天
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => selectedBotId && loadStats(selectedBotId, statsDays, statsView, 0)}
                      className="ml-auto rounded-lg p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
                    </button>
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
                          if (selectedBotId) loadStats(selectedBotId, statsDays, v, 0)
                        }}
                        className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-base font-medium transition-colors ${
                          statsView === v
                            ? 'border-b-2 border-sky-500 text-sky-600'
                            : 'text-gray-400 hover:text-gray-600'
                        }`}
                      >
                        <BarChart2 className="h-3.5 w-3.5" />
                        {v === 'top_queries' ? '最多人問' : '零命中'}
                      </button>
                    ))}
                  </div>

                  {/* 查詢列表 */}
                  <div className="min-h-0 flex-1 overflow-y-auto">
                    {!statsData ? (
                      <div className="flex h-full items-center justify-center">
                        <button
                          type="button"
                          onClick={() => selectedBotId && loadStats(selectedBotId, statsDays, statsView, 0)}
                          className="rounded-lg bg-sky-50 px-4 py-2 text-base text-sky-600 hover:bg-sky-100"
                        >
                          載入統計資料
                        </button>
                      </div>
                    ) : statsLoading ? (
                      <div className="flex h-full items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                      </div>
                    ) : statsData.queries.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-base text-gray-400">
                        {statsView === 'zero_hit' ? '近期無零命中查詢' : '尚無查詢記錄'}
                      </div>
                    ) : (
                      <>
                        {statsData.queries.map((item, i) => (
                          <div key={i} className="flex items-start gap-3 border-b border-gray-50 px-4 py-2.5">
                            <span className="mt-0.5 shrink-0 text-base font-bold text-gray-300">
                              {String(statsOffset + i + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-base text-gray-700">{item.query}</p>
                              <p className="text-base text-gray-400">
                                {item.count} 次・{new Date(item.last_asked_at).toLocaleDateString('zh-TW')}
                              </p>
                            </div>
                          </div>
                        ))}
                        {/* 分頁 */}
                        <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-4 py-2">
                          <button
                            type="button"
                            disabled={statsOffset === 0}
                            onClick={() => selectedBotId && loadStats(selectedBotId, statsDays, statsView, Math.max(0, statsOffset - 20))}
                            className="rounded px-2 py-1 text-base text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >← 上一頁</button>
                          <span className="text-base text-gray-400">{statsOffset + 1}–{Math.min(statsOffset + 20, statsData.total)} / {statsData.total}</span>
                          <button
                            type="button"
                            disabled={statsOffset + 20 >= statsData.total}
                            onClick={() => selectedBotId && loadStats(selectedBotId, statsDays, statsView, statsOffset + 20)}
                            className="rounded px-2 py-1 text-base text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >下一頁 →</button>
                        </div>
                      </>
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
