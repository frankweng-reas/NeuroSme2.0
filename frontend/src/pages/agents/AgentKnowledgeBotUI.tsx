/**
 * Knowledge Bot Agent UI（agent_id = knowledge-bot）
 * 兩欄式：左=Bot 列表 / 右=測試 Chat + 設定 + 部署
 * 風格對齊 CS Agent
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { chatCompletionsStream, type ChatStreamDone } from '@/api/chat'
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
import { listKnowledgeBases, type KmKnowledgeBase } from '@/api/km'
import { getMe } from '@/api/users'
import { appendChatMessage, createChatThread } from '@/api/chatThreads'
import AgentChat, { type Message } from '@/components/AgentChat'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent, UserRole } from '@/types'

interface Props {
  agent: Agent
}

const HEADER_COLOR = '#1A3A52'

type RightTab = 'chat' | 'settings' | 'deploy'

export default function AgentKnowledgeBotUI({ agent }: Props) {
  // ── 角色 ─────────────────────────────────────────────────────────────────
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

  // 新增 Bot
  const [creatingBot, setCreatingBot] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  const [newBotSaving, setNewBotSaving] = useState(false)
  const newBotInputRef = useRef<HTMLInputElement>(null)

  // 重命名
  const [renamingBotId, setRenamingBotId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  // 刪除
  const [deleteBotTarget, setDeleteBotTarget] = useState<BotType | null>(null)

  // ── 右欄 Tab ──────────────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<RightTab>('chat')

  // ── 設定 ──────────────────────────────────────────────────────────────────
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [settingsModel, setSettingsModel] = useState('')
  const [settingsPrompt, setSettingsPrompt] = useState('')
  const [settingsWidgetTitle, setSettingsWidgetTitle] = useState('')
  const [settingsWidgetColor, setSettingsWidgetColor] = useState('#1A3A52')
  const [settingsWidgetLang, setSettingsWidgetLang] = useState('zh-TW')
  const [settingsWidgetLogoUrl, setSettingsWidgetLogoUrl] = useState('')
  const [settingsKbIds, setSettingsKbIds] = useState<BotKbItem[]>([])
  const [settingsActive, setSettingsActive] = useState(true)
  const [settingsSaving, setSettingsSaving] = useState(false)

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

  // ── Load data ─────────────────────────────────────────────────────────────
  const loadBots = useCallback(() => {
    setBotsLoading(true)
    Promise.all([listBots(), listKnowledgeBases()])
      .then(([botList, kbList]) => {
        setBots(botList)
        setKbs(kbList)
        if (botList.length > 0 && selectedBotId === null) {
          setSelectedBotId(botList[0].id)
        }
      })
      .catch(() => {})
      .finally(() => setBotsLoading(false))
  }, [selectedBotId])

  useEffect(() => { loadBots() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 點擊外部關閉 menu
  useEffect(() => {
    if (!botMenuId) return
    const handler = (e: MouseEvent) => {
      if (botMenuRef.current && !botMenuRef.current.contains(e.target as Node)) {
        setBotMenuId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [botMenuId])

  useEffect(() => {
    if (creatingBot) newBotInputRef.current?.focus()
  }, [creatingBot])

  useEffect(() => {
    if (renamingBotId) renameInputRef.current?.focus()
  }, [renamingBotId])

  // 選中 Bot 時初始化設定欄位
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
      const msg = err instanceof Error ? err.message : '建立失敗'
      setErrorModal({ title: '建立 Bot 失敗', message: msg })
    } finally {
      setNewBotSaving(false)
    }
  }

  const handleRenameBot = async (id: number) => {
    const name = renameValue.trim()
    if (!name) { setRenamingBotId(null); return }
    try {
      const updated = await updateBot(id, { name })
      setBots((prev) => prev.map((b) => b.id === id ? updated : b))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '更新失敗'
      setErrorModal({ title: '重命名失敗', message: msg })
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
      const msg = err instanceof Error ? err.message : '刪除失敗'
      setErrorModal({ title: '刪除失敗', message: msg })
    } finally {
      setDeleteBotTarget(null)
    }
  }

  const handleSaveSettings = async () => {
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
      showToast('設定已儲存')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '儲存失敗'
      setErrorModal({ title: '儲存設定失敗', message: msg })
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleGenerateToken = async () => {
    if (!selectedBot || !isAdmin) return
    try {
      const updated = await generateBotToken(selectedBot.id)
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
    } catch (err) {
      const msg = err instanceof Error ? err.message : '產生 Token 失敗'
      setErrorModal({ title: '產生 Token 失敗', message: msg })
    }
  }

  const handleRevokeToken = async () => {
    if (!selectedBot || !isAdmin) return
    try {
      const updated = await revokeBotToken(selectedBot.id)
      setBots((prev) => prev.map((b) => b.id === updated.id ? updated : b))
      showToast('Widget Token 已停用')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '停用 Token 失敗'
      setErrorModal({ title: '停用 Token 失敗', message: msg })
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
        setMessages((prev) => [...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '請先在左側選擇一個 Bot，再開始提問。' },
        ])
        return
      }
      if (!bot.is_active) {
        setMessages((prev) => [...prev,
          { role: 'user', content: text },
          { role: 'assistant', content: '此 Bot 已停用，無法回答問題。' },
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
            onDone: (done: ChatStreamDone) => {
              setMessages((prev) => {
                const next = [...prev]
                if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: done.content }
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
    [agent.agent_id, isLoading, messages, bots, threadId]
  )

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
        open={deleteBotTarget !== null}
        title="刪除 Bot"
        message={`確定要刪除「${deleteBotTarget?.name}」嗎？此操作無法復原。`}
        confirmText="刪除"
        variant="danger"
        onConfirm={() => void handleDeleteBot()}
        onCancel={() => setDeleteBotTarget(null)}
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

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} />

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ══ 左欄：Bot 列表 ═══════════════════════════════════════════════ */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-72'
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
                title="展開 Bot 列表"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <Bot className="h-4 w-4 text-white/70" />
                  <span className="text-base font-semibold text-white">Knowledge Bots</span>
                </div>
                <div className="flex items-center gap-0.5">
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => { setCreatingBot(true); setBotMenuId(null) }}
                      className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
                      title="新增 Bot"
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
              {/* Create Bot inline input */}
              {creatingBot && (
                <div className="shrink-0 border-b border-white/10 px-3 py-2 space-y-1.5">
                  <input
                    ref={newBotInputRef}
                    value={newBotName}
                    onChange={(e) => setNewBotName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return
                      if (e.key === 'Enter') void handleCreateBot()
                      if (e.key === 'Escape') { setCreatingBot(false); setNewBotName('') }
                    }}
                    placeholder="Bot 名稱…"
                    className="w-full rounded-md bg-white/15 px-2 py-1.5 text-base text-white placeholder-white/40 outline-none focus:bg-white/20"
                    maxLength={100}
                  />
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCreateBot()}
                      disabled={newBotSaving || !newBotName.trim()}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-sky-500/40 py-1 text-base font-medium text-white transition-colors hover:bg-sky-500/60 disabled:opacity-50"
                    >
                      {newBotSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                      建立
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCreatingBot(false); setNewBotName('') }}
                      className="rounded-md px-2 py-1 text-base text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}

              {/* Bot List */}
              <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
                {botsLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-white/50" />
                  </div>
                ) : bots.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-base leading-relaxed text-white/40">
                      尚無 Bot
                      {canManage && (
                        <>，點擊上方 <Plus className="inline h-3 w-3" /> 新增</>
                      )}
                    </p>
                  </div>
                ) : (
                  <ul className="space-y-0.5 px-2">
                    {bots.map((bot) => (
                      <li
                        key={bot.id}
                        className="relative"
                        ref={botMenuId === bot.id ? botMenuRef : undefined}
                      >
                        {renamingBotId === bot.id ? (
                          <div className="rounded-lg bg-white/15 px-2 py-1.5">
                            <input
                              ref={renameInputRef}
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.nativeEvent.isComposing) return
                                if (e.key === 'Enter') void handleRenameBot(bot.id)
                                if (e.key === 'Escape') setRenamingBotId(null)
                              }}
                              onBlur={() => void handleRenameBot(bot.id)}
                              className="w-full bg-transparent text-base text-white outline-none"
                              maxLength={100}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setSelectedBotId(bot.id); setBotMenuId(null) }}
                            className={`group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                              selectedBotId === bot.id
                                ? 'bg-sky-500/30 text-white'
                                : 'text-white/75 hover:bg-white/10 hover:text-white'
                            }`}
                          >
                            <span className="min-w-0 flex-1 truncate font-medium">{bot.name}</span>
                            {!bot.is_active && (
                              <span className="shrink-0 rounded bg-white/20 px-1 text-base text-white/50">停用</span>
                            )}
                            {canManage && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setBotMenuId(botMenuId === bot.id ? null : bot.id) }}
                                className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/20"
                                aria-label="更多操作"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </button>
                        )}

                        {/* Bot 操作選單 */}
                        {botMenuId === bot.id && (
                          <div className="absolute right-0 top-full z-20 mt-0.5 w-28 overflow-hidden rounded-lg border border-white/20 bg-[#1a3a52] shadow-xl">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingBotId(bot.id)
                                setRenameValue(bot.name)
                                setBotMenuId(null)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Pencil className="h-3 w-3" />重命名
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBotId(bot.id)
                                setRightTab('settings')
                                setBotMenuId(null)
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-base text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                            >
                              <Settings className="h-3 w-3" />設定
                            </button>
                            <button
                              type="button"
                              onClick={() => { setDeleteBotTarget(bot); setBotMenuId(null) }}
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

        {/* ══ 右欄 ════════════════════════════════════════════════════════ */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* Tab 切換 */}
          <div className="flex shrink-0 items-center gap-1 border-b border-gray-100 bg-gray-50/70 px-4 py-2">
            <button
              type="button"
              onClick={() => setRightTab('chat')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'chat' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              測試 Chat
            </button>
            <button
              type="button"
              onClick={() => setRightTab('settings')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'settings' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              設定
            </button>
            <button
              type="button"
              onClick={() => setRightTab('deploy')}
              className={`rounded-lg px-3 py-1 text-base font-medium transition-colors ${rightTab === 'deploy' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              部署
            </button>

            {rightTab === 'chat' && selectedBot && (
              <>
                <span className="mx-1 text-gray-200">|</span>
                <span className="text-base font-medium text-gray-600 truncate">{selectedBot.name}</span>
                {selectedBot.model_name ? (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-base text-sky-700">
                      {selectedBot.model_name}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="shrink-0 text-base text-amber-500">尚未設定模型</span>
                  </>
                )}
                {!selectedBot.is_active && (
                  <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-base text-gray-400">已停用</span>
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
          </div>

          {/* ── 測試 Chat ── */}
          {rightTab === 'chat' && (
            <AgentChat
              messages={messages}
              onSubmit={handleSendMessage}
              isLoading={isLoading}
              headerTitle=""
              emptyPlaceholder={
                !selectedBot
                  ? '請在左側選擇 Bot 後開始提問。'
                  : !selectedBot.model_name
                  ? `「${selectedBot.name}」尚未設定模型，請先至設定頁完成設定。`
                  : !selectedBot.is_active
                  ? `「${selectedBot.name}」已停用。`
                  : `Bot：${selectedBot.name}\n輸入問題，AI 將從已選知識庫中搜尋相關資料回答。`
              }
              onCopySuccess={() => showToast('已複製到剪貼簿')}
              onCopyError={() => showToast('複製失敗', 'error')}
              showChart={false}
              showPdf={false}
            />
          )}

          {/* ── 設定 ── */}
          {rightTab === 'settings' && (
            <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
              {!selectedBot ? (
                <p className="text-base text-gray-400">請先在左側選擇 Bot</p>
              ) : (
                <>
                  {/* 啟用/停用 */}
                  <div className="flex items-center justify-between rounded-xl border border-gray-200 px-4 py-3">
                    <div>
                      <p className="text-base font-medium text-gray-700">啟用 Bot</p>
                      <p className="text-base text-gray-400">停用後 Widget、API、測試 Chat 全部拒絕服務</p>
                    </div>
                    {canManage ? (
                      <button
                        type="button"
                        onClick={() => setSettingsActive((v) => !v)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          settingsActive ? 'bg-blue-600' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            settingsActive ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-base font-medium ${settingsActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                        {settingsActive ? '啟用中' : '已停用'}
                      </span>
                    )}
                  </div>

                  {/* LLM 模型 */}
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

                  {/* 知識來源 KB */}
                  <div>
                    <label className="mb-1.5 block text-base font-medium text-gray-700">知識來源（KB）</label>
                    <div className="space-y-1.5 rounded-xl border border-gray-200 p-3">
                      {kbs.length === 0 ? (
                        <p className="text-base text-gray-400">尚無知識庫，請先在 CS Agent 建立</p>
                      ) : kbs.map((kb) => {
                        const checked = settingsKbIds.some((item) => item.knowledge_base_id === kb.id)
                        return (
                          <label key={kb.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleKb(kb.id)}
                              disabled={!canManage}
                              className="h-4 w-4 shrink-0 cursor-pointer accent-sky-500"
                            />
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
                      自訂系統提示詞
                      <span className="ml-1 font-normal text-gray-400">（選填，留空使用預設 CS 提示詞）</span>
                    </label>
                    <textarea
                      value={settingsPrompt}
                      onChange={(e) => setSettingsPrompt(e.target.value)}
                      disabled={!canManage}
                      rows={8}
                      placeholder="你是 XX 公司的客服助手，請根據知識庫文件回答問題…"
                      className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-mono text-base text-gray-800 placeholder-amber-300 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-60"
                    />
                  </div>

                  {canManage && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSaveSettings()}
                        disabled={settingsSaving}
                        className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
                      >
                        {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        儲存設定
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
                  {/* Widget */}
                  <div>
                    <p className="mb-1 text-base font-semibold text-gray-700">嵌入式 Widget</p>
                    <p className="mb-3 text-base text-gray-400">產生 Token 後可將 Widget 嵌入到任何網頁</p>
                    {selectedBot.public_token ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            value={`${window.location.origin}/widget/bot/${selectedBot.public_token}`}
                            className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base font-mono text-gray-700 focus:outline-none"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/widget/bot/${selectedBot.public_token}`)
                              showToast('連結已複製')
                            }}
                            className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-700 hover:bg-gray-50"
                          >
                            複製
                          </button>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleRevokeToken()}
                            className="text-base text-red-500 hover:underline"
                          >
                            停用 Widget Token
                          </button>
                        )}
                      </div>
                    ) : (
                      <div>
                        <p className="mb-2 text-base text-gray-400">尚未產生 Widget Token</p>
                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => void handleGenerateToken()}
                            className="rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white hover:bg-sky-700"
                          >
                            產生 Widget Token
                          </button>
                        ) : (
                          <p className="text-base text-gray-400">請聯繫系統管理員開通</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Widget 外觀 */}
                  <div className="border-t border-gray-100 pt-4">
                    <p className="mb-3 text-base font-semibold text-gray-700">Widget 外觀</p>
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1 block text-base font-medium text-gray-700">Widget 顯示名稱</label>
                        <input
                          type="text"
                          value={settingsWidgetTitle}
                          onChange={(e) => setSettingsWidgetTitle(e.target.value)}
                          disabled={!canManage}
                          placeholder={selectedBot.name}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                      </div>
                      <div className="flex gap-3">
                        <div className="flex-1">
                          <label className="mb-1 block text-base font-medium text-gray-700">主色</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="color"
                              value={settingsWidgetColor}
                              onChange={(e) => setSettingsWidgetColor(e.target.value)}
                              disabled={!canManage}
                              className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5 disabled:opacity-60"
                            />
                            <input
                              type="text"
                              value={settingsWidgetColor}
                              onChange={(e) => setSettingsWidgetColor(e.target.value)}
                              disabled={!canManage}
                              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                            />
                          </div>
                        </div>
                        <div className="w-40">
                          <label className="mb-1 block text-base font-medium text-gray-700">語言</label>
                          <select
                            value={settingsWidgetLang}
                            onChange={(e) => setSettingsWidgetLang(e.target.value)}
                            disabled={!canManage}
                            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          >
                            <option value="zh-TW">繁中</option>
                            <option value="zh-CN">簡中</option>
                            <option value="en">English</option>
                            <option value="ja">日本語</option>
                          </select>
                        </div>
                      </div>
                      {canManage && (
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => void handleSaveSettings()}
                            disabled={settingsSaving}
                            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-base font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
                          >
                            {settingsSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                            儲存
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* API 整合 */}
                  <div className="border-t border-gray-100 pt-4">
                    <p className="mb-2 text-base font-semibold text-gray-700">API 整合（內部 Chat）</p>
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                      <pre className="overflow-x-auto whitespace-pre-wrap text-base text-gray-700">{JSON.stringify({
                        agent_id: 'knowledge-bot',
                        bot_id: selectedBot.id,
                        model: selectedBot.model_name ?? '(your-model)',
                        content: '你的問題',
                        messages: [],
                        system_prompt: '', user_prompt: '', data: '',
                      }, null, 2)}</pre>
                    </div>
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
