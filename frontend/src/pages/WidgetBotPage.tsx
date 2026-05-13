/**
 * Bot Widget 公開頁面：/widget/bot/:token
 * - 不需要登入
 * - ?embed=1 → iframe 模式
 * - localStorage 存 session，支援對話記憶
 */
import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { Loader2, MessageCircle, RotateCcw } from 'lucide-react'
import {
  botWidgetChatStream,
  botWidgetTranscribeAudio,
  checkBotWidgetSession,
  createBotWidgetSession,
  getBotWidgetInfo,
  type BotWidgetInfo,
} from '@/api/widget_bot_public'
import widgetI18n from '@/i18n/widgetI18n'
import AgentChat, { type Message } from '@/components/AgentChat'
import VoiceInput from '@/components/VoiceInput'

// ── 型別 ──────────────────────────────────────────────────────────────────────

interface StoredSession {
  sessionId: string
  visitorName: string
  visitorEmail: string
  visitorPhone: string
  messages: Message[]
}

// ── 常數 ──────────────────────────────────────────────────────────────────────

const SESSION_KEY = (token: string) => `bot_widget_session_${token}`

function loadSession(token: string): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY(token))
    return raw ? (JSON.parse(raw) as StoredSession) : null
  } catch {
    return null
  }
}

function saveSession(token: string, data: StoredSession) {
  localStorage.setItem(SESSION_KEY(token), JSON.stringify(data))
}

function clearSession(token: string) {
  localStorage.removeItem(SESSION_KEY(token))
}

function genSessionId() {
  return (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2))
}

// ── 內層元件（需要 i18n context）────────────────────────────────────────────

function WidgetBotInner({ token, isEmbed, langOverride }: { token: string; isEmbed: boolean; langOverride: string }) {
  const { t } = useTranslation('widget')

  const [info, setInfo] = useState<BotWidgetInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [phase, setPhase] = useState<'loading' | 'welcome' | 'chat'>('loading')

  const [visitorName, setVisitorName] = useState('')
  const [visitorEmail, setVisitorEmail] = useState('')
  const [visitorPhone, setVisitorPhone] = useState('')
  const [sessionId, setSessionId] = useState('')

  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const [voiceAutoSendText, setVoiceAutoSendText] = useState('')

  // ── 載入 Bot info ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) { setLoadError('載入失敗，請確認連結是否正確'); return }
    getBotWidgetInfo(token)
      .then(async (data) => {
        setInfo(data)
        const stored = loadSession(token)
        if (stored) {
          try {
            const { valid } = await checkBotWidgetSession(token, stored.sessionId)
            if (!valid) {
              clearSession(token)
              setPhase('welcome')
              return
            }
          } catch {
            // 驗證失敗時保守處理：仍使用本地 session
          }
          setSessionId(stored.sessionId)
          setVisitorName(stored.visitorName)
          setVisitorEmail(stored.visitorEmail)
          setVisitorPhone(stored.visitorPhone)
          setMessages(stored.messages)
          setPhase('chat')
        } else {
          setPhase('welcome')
        }
      })
      .catch((e: unknown) => {
        setLoadError(e instanceof Error ? e.message : '載入失敗，請確認連結是否正確')
        setPhase('loading')
      })
  }, [token])

  // ── 依語言優先序切換 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const lang = langOverride || info?.lang || 'zh-TW'
    widgetI18n.changeLanguage(lang)
  }, [langOverride, info?.lang])

  // ── embed 模式：讓 html/body/root 填滿 iframe ─────────────────────────────
  useEffect(() => {
    if (!isEmbed) return
    const style = document.createElement('style')
    style.textContent = 'html,body,#root{height:100%;margin:0;padding:0;overflow:hidden}'
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [isEmbed])

  // ── 提交訪客資訊 ─────────────────────────────────────────────────────────────
  async function handleStartChat(e: React.FormEvent) {
    e.preventDefault()
    if (!visitorName.trim()) return
    const sid = genSessionId()
    try {
      await createBotWidgetSession(token, {
        session_id: sid,
        visitor_name: visitorName.trim(),
        visitor_email: visitorEmail.trim() || undefined,
        visitor_phone: visitorPhone.trim() || undefined,
      })
      setSessionId(sid)
      const stored: StoredSession = {
        sessionId: sid,
        visitorName: visitorName.trim(),
        visitorEmail: visitorEmail.trim(),
        visitorPhone: visitorPhone.trim(),
        messages: [],
      }
      saveSession(token, stored)
      setPhase('chat')
    } catch (e: unknown) {
      setChatError(e instanceof Error ? e.message : t('welcome.error_create'))
    }
  }

  // ── 送出訊息 ────────────────────────────────────────────────────────────────
  async function handleSend(text: string) {
    if (!text || isLoading) return
    setChatError(null)

    const startIdx = messages.length + 1
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setIsLoading(true)

    let assistantText = ''
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      await botWidgetChatStream(
        token,
        {
          session_id: sessionId,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          content: text,
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
          onDone: (content?) => {
            if (content) assistantText = content
            setMessages((prev) => {
              const next = [...prev]
              if (next[startIdx]) next[startIdx] = { ...next[startIdx], content: assistantText }
              return next
            })
            saveSession(token, {
              sessionId, visitorName, visitorEmail, visitorPhone,
              messages: [...messages, { role: 'user', content: text }, { role: 'assistant', content: assistantText }],
            })
            setIsLoading(false)
          },
          onError: (msg) => {
            setMessages((prev) => prev.slice(0, startIdx))
            setChatError(msg)
            setIsLoading(false)
          },
        }
      )
    } catch {
      setMessages((prev) => prev.slice(0, startIdx))
      setIsLoading(false)
    }
  }

  // ── 清除對話 ─────────────────────────────────────────────────────────────────
  function handleReset() {
    clearSession(token)
    setMessages([])
    setVisitorName('')
    setVisitorEmail('')
    setVisitorPhone('')
    setSessionId('')
    setPhase('welcome')
  }

  const color = info?.color ?? '#1A3A52'

  // ── 錯誤頁 ──────────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="rounded-xl border border-red-200 bg-white px-8 py-10 text-center shadow">
          <p className="text-lg font-medium text-red-600">{t('error.load_failed')}</p>
          <p className="mt-2 text-base text-gray-500">{loadError}</p>
        </div>
      </div>
    )
  }

  // ── 載入中 ──────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div
      className={`flex flex-col bg-gray-50 ${isEmbed ? '' : 'mx-auto max-w-lg shadow-xl'}`}
      style={{
        height: '100dvh',
        minHeight: isEmbed ? '100%' : '100vh',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" style={{ backgroundColor: color }}>
        {info?.logo_url ? (
          <img src={info.logo_url} alt="logo" className="h-8 w-8 rounded-full object-cover" />
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
            <MessageCircle className="h-4 w-4 text-white" />
          </div>
        )}
        <span className="flex-1 text-base font-semibold text-white">
          {info?.title ?? t('welcome.title', { title: '' })}
        </span>
        {phase === 'chat' && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg p-1.5 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            title={t('chat.reset_title')}
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Welcome 階段 */}
      {phase === 'welcome' && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-8">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: color + '20' }}>
            <MessageCircle className="h-7 w-7" style={{ color }} />
          </div>
          <h2 className="mb-1 text-lg font-semibold text-gray-800">
            {t('welcome.title', { title: info?.title ?? '' })}
          </h2>
          <p className="mb-6 text-base text-gray-500">{t('welcome.subtitle')}</p>
          <form onSubmit={handleStartChat} className="w-full max-w-sm space-y-3">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">{t('welcome.name_required')}</label>
              <input
                type="text"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                placeholder={t('welcome.name_placeholder')}
                required
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">{t('welcome.email_label')}</label>
              <input
                type="email"
                value={visitorEmail}
                onChange={(e) => setVisitorEmail(e.target.value)}
                placeholder={t('welcome.email_placeholder')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">{t('welcome.phone_label')}</label>
              <input
                type="tel"
                value={visitorPhone}
                onChange={(e) => setVisitorPhone(e.target.value)}
                placeholder={t('welcome.phone_placeholder')}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
            </div>
            {chatError && <p className="text-base text-red-600">{chatError}</p>}
            <button
              type="submit"
              className="w-full rounded-lg py-2.5 text-base font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: color }}
            >
              {t('welcome.start_button')}
            </button>
          </form>
        </div>
      )}

      {/* Chat 階段 */}
      {phase === 'chat' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {chatError && (
            <div className="mx-4 mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base text-red-600">
              {chatError}
            </div>
          )}
          <AgentChat
            messages={messages}
            onSubmit={handleSend}
            isLoading={isLoading}
            emptyPlaceholder={t('chat.greeting', { name: visitorName })}
            headerTitle=""
            showChart={false}
            showPdf={false}
            compact
            appendAndSendText={voiceAutoSendText}
            composerLeading={info?.voice_enabled ? (
              <VoiceInput
                hideLangSelector
                transcribe={(blob, filename, lang) =>
                  botWidgetTranscribeAudio(token, blob, filename, lang)
                }
                onTranscript={(text, autoSend) => {
                  if (autoSend) {
                    setVoiceAutoSendText(text)
                    setTimeout(() => setVoiceAutoSendText(''), 50)
                  }
                }}
                onError={(msg) => setChatError(msg)}
                disabled={isLoading}
                buttonClassName="flex min-h-[44px] min-w-0 items-center justify-center rounded-xl bg-gray-100 px-3 text-gray-500 transition-colors hover:bg-gray-200 disabled:opacity-40"
              />
            ) : undefined}
          />
        </div>
      )}
    </div>
  )
}

// ── 外層：注入 i18n Provider ──────────────────────────────────────────────────

export default function WidgetBotPage() {
  const { token = '' } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const isEmbed = searchParams.get('embed') === '1'
  const langOverride = searchParams.get('lang') ?? ''

  return (
    <I18nextProvider i18n={widgetI18n}>
      <WidgetBotInner token={token} isEmbed={isEmbed} langOverride={langOverride} />
    </I18nextProvider>
  )
}
