/** Marketing Agent UI：品牌設定 + 文案類型表單 + TipTap 編輯器 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import {
  ChevronRight, ClipboardCopy, Megaphone, ShoppingBag, Zap, Mail, CalendarDays,
  Bold, Italic, List, Sparkles, RotateCcw, Settings2,
} from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import ErrorModal from '@/components/ErrorModal'
import { chatCompletionsStream } from '@/api/chat'
import { createChatThread } from '@/api/chatThreads'
import type { Agent } from '@/types'

const HEADER_COLOR = '#1a3a2a'
const STORAGE_KEY = 'agent-marketing-ui-model'
const BRAND_STORAGE_KEY = 'agent-marketing-ui-brand'

// ── 文案類型 ─────────────────────────────────────────────────────────────────

type DocTypeId = 'social_post' | 'product_desc' | 'ad_copy' | 'edm' | 'event_promo'

interface FieldDef {
  id: string
  label: string
  placeholder: string
  multiline?: boolean
  options?: string[]
}

interface DocTypeDef {
  id: DocTypeId
  label: string
  icon: React.ReactNode
  fields: FieldDef[]
}

const DOC_TYPES: DocTypeDef[] = [
  {
    id: 'social_post',
    label: '社群貼文',
    icon: <Megaphone className="h-4 w-4" />,
    fields: [
      { id: 'platform', label: '發布平台', placeholder: '', options: ['Facebook', 'Instagram', 'LinkedIn', 'LINE'] },
      { id: 'product_service', label: '產品 / 服務', placeholder: '例：夏季新品防曬乳液' },
      { id: 'key_message', label: '主打訊息', placeholder: '例：輕薄不黏膩，戶外活動必備', multiline: true },
      { id: 'cta', label: '行動呼籲（選填）', placeholder: '例：立即搶購、點連結了解更多' },
      { id: 'hashtag', label: '加入 Hashtag', placeholder: '', options: ['是', '否'] },
    ],
  },
  {
    id: 'product_desc',
    label: '產品描述',
    icon: <ShoppingBag className="h-4 w-4" />,
    fields: [
      { id: 'product_name', label: '產品名稱', placeholder: '例：NeuroSme AI 助理平台' },
      { id: 'features', label: '功能亮點', placeholder: '條列主要功能，例：\n- 多語言支援\n- 一鍵生成報告\n- 無需IT介入', multiline: true },
      { id: 'target_audience', label: '適合對象', placeholder: '例：中小型電商、服務業老闆' },
      { id: 'use_case', label: '使用場景（選填）', placeholder: '例：日常客服、行銷文案、數據分析' },
      { id: 'length', label: '描述長度', placeholder: '', options: ['短（80字）', '中（150字）', '長（300字）'] },
    ],
  },
  {
    id: 'ad_copy',
    label: '廣告文案',
    icon: <Zap className="h-4 w-4" />,
    fields: [
      { id: 'platform', label: '廣告平台', placeholder: '', options: ['Google Ads', 'Facebook Ads', 'Instagram Ads', 'LINE Ads'] },
      { id: 'product_service', label: '產品 / 服務', placeholder: '例：線上會計軟體' },
      { id: 'pain_point', label: '痛點', placeholder: '例：每個月手動對帳耗費大量時間' },
      { id: 'key_benefit', label: '核心利益', placeholder: '例：自動化對帳，省下 80% 的時間' },
      { id: 'cta_text', label: 'CTA 按鈕文字', placeholder: '例：免費試用、立即了解、搶先預訂' },
    ],
  },
  {
    id: 'edm',
    label: 'EDM 電子報',
    icon: <Mail className="h-4 w-4" />,
    fields: [
      { id: 'subject', label: '信件主旨方向', placeholder: '例：夏季特賣開跑，限時 48 小時' },
      { id: 'campaign', label: '活動 / 促銷主題', placeholder: '例：週年慶全館 8 折' },
      { id: 'offer', label: '主要優惠 / 訊息', placeholder: '例：\n- 滿 1500 折 200\n- 新品上市首購 9 折\n- 免運門檻降至 599', multiline: true },
      { id: 'cta', label: '行動呼籲', placeholder: '例：立即購物、查看活動、領取優惠碼' },
    ],
  },
  {
    id: 'event_promo',
    label: '活動宣傳',
    icon: <CalendarDays className="h-4 w-4" />,
    fields: [
      { id: 'event_name', label: '活動名稱', placeholder: '例：2025 NeuroSme 新品發表會' },
      { id: 'date_location', label: '時間 / 地點', placeholder: '例：2025/06/15 下午 2:00，台北信義區' },
      { id: 'target_audience', label: '目標對象', placeholder: '例：中小企業主、IT 採購負責人' },
      { id: 'highlights', label: '活動亮點', placeholder: '條列精彩環節，例：\n- AI 功能現場 Demo\n- 限定早鳥優惠\n- Q&A 與專家交流', multiline: true },
      { id: 'cta', label: '報名 / 購票方式', placeholder: '例：掃描 QR Code 立即報名' },
    ],
  },
]

// ── 品牌語氣選項 ──────────────────────────────────────────────────────────────

const VOICE_OPTIONS = ['活潑', '專業', '親切', '科技感']

// ── Prompt 建構 ───────────────────────────────────────────────────────────────

interface BrandProfile {
  company: string
  industry: string
  target: string
  voice: string
}

function buildPrompt(docType: DocTypeDef, values: Record<string, string>, brand: BrandProfile): string {
  const lines: string[] = [`請撰寫一份${docType.label}，資訊如下：`, '']

  if (brand.company.trim()) lines.push(`**品牌名稱**: ${brand.company.trim()}`)
  if (brand.industry.trim()) lines.push(`**產業**: ${brand.industry.trim()}`)
  if (brand.target.trim()) lines.push(`**目標客群**: ${brand.target.trim()}`)
  if (brand.voice.trim()) lines.push(`**品牌語氣**: ${brand.voice.trim()}`)
  lines.push('')

  for (const field of docType.fields) {
    const val = (values[field.id] ?? '').trim()
    if (val) lines.push(`**${field.label}**: ${val}`)
  }

  const extra = (values['__extra__'] ?? '').trim()
  if (extra) lines.push(`\n**額外要求**: ${extra}`)

  lines.push('', '請直接輸出文案本體，不要加前言或後記。若資訊不足請合理推斷，不得使用佔位符。')
  return lines.join('\n')
}

function markdownToHtml(text: string): string {
  try {
    const html = marked.parse(text, { async: false }) as string
    return html || '<p></p>'
  } catch {
    return text.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>'
  }
}

// ── 主元件 ────────────────────────────────────────────────────────────────────

interface Props { agent: Agent }

export default function AgentMarketingUI({ agent }: Props) {
  const [model, setModel] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || 'gpt-4o-mini' } catch { return 'gpt-4o-mini' }
  })
  const [brand, setBrand] = useState<BrandProfile>(() => {
    try {
      const saved = localStorage.getItem(BRAND_STORAGE_KEY)
      return saved ? JSON.parse(saved) : { company: '', industry: '', target: '', voice: '' }
    } catch { return { company: '', industry: '', target: '', voice: '' } }
  })
  const [brandOpen, setBrandOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(BRAND_STORAGE_KEY)
      if (!saved) return true
      const p = JSON.parse(saved)
      return !p.company
    } catch { return true }
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedType, setSelectedType] = useState<DocTypeId>('social_post')
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [isStreaming, setIsStreaming] = useState(false)
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [lastMeta, setLastMeta] = useState<{
    model: string
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  } | null>(null)

  const fullTextRef = useRef('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full px-8 py-6 prose prose-gray max-w-none text-base leading-relaxed',
      },
    },
  })

  useEffect(() => {
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  useEffect(() => {
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [agent.id])

  const persistModel = useCallback((m: string) => {
    setModel(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* ignore */ }
  }, [])

  const persistBrand = useCallback((updated: BrandProfile) => {
    setBrand(updated)
    try { localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
  }, [])

  const currentDocType = DOC_TYPES.find((t) => t.id === selectedType)!

  const handleTypeChange = useCallback((id: DocTypeId) => {
    setSelectedType(id)
    setFieldValues({})
  }, [])

  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }))
  }, [])

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (isStreaming || !editor) return
    const prompt = buildPrompt(currentDocType, fieldValues, brand)
    editor.commands.setContent('<p></p>')
    fullTextRef.current = ''
    setIsStreaming(true)

    intervalRef.current = setInterval(() => {
      if (fullTextRef.current && editor) {
        editor.commands.setContent(markdownToHtml(fullTextRef.current), { emitUpdate: false })
      }
    }, 50)

    try {
      await chatCompletionsStream(
        {
          agent_id: agent.id,
          prompt_type: 'marketing',
          system_prompt: '',
          user_prompt: '',
          data: '',
          model,
          messages: [],
          content: prompt,
          chat_thread_id: threadId ?? '',
        },
        {
          onDelta: (chunk) => { fullTextRef.current += chunk },
          onDone: (done) => {
            stopStreaming()
            if (done.content && editor) {
              editor.commands.setContent(markdownToHtml(done.content), { emitUpdate: false })
            }
            setLastMeta({ model: done.model ?? model, usage: done.usage ?? null })
            setIsStreaming(false)
          },
          onError: (msg) => {
            stopStreaming()
            setIsStreaming(false)
            setErrorModal({ title: '生成失敗', message: msg ?? '發生未知錯誤' })
          },
        }
      )
    } catch (e) {
      stopStreaming()
      setIsStreaming(false)
      setErrorModal({ title: '生成失敗', message: e instanceof Error ? e.message : '發生未知錯誤' })
    }
  }, [agent.id, brand, currentDocType, editor, fieldValues, isStreaming, model, stopStreaming, threadId])

  const handleCopy = useCallback(async () => {
    if (!editor) return
    try {
      await navigator.clipboard.writeText(editor.getText())
      setCopyFeedback(true)
      setTimeout(() => setCopyFeedback(false), 2000)
    } catch {
      setErrorModal({ title: '複製失敗', message: '無法複製到剪貼簿，請手動選取文字。' })
    }
  }, [editor])

  const handleClear = useCallback(() => {
    if (!editor || isStreaming) return
    editor.commands.setContent('<p></p>')
    fullTextRef.current = ''
  }, [editor, isStreaming])

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen flex-col" style={{ backgroundColor: '#f0f4f2' }}>
      <AgentHeader agent={agent} headerColor={HEADER_COLOR} />

      <div className="flex min-h-0 flex-1">
        {/* ── 左側面板 ── */}
        {!sidebarCollapsed && (
          <div className="flex w-80 flex-shrink-0 flex-col border-r border-gray-200 bg-white overflow-y-auto">

            {/* Model 選擇 */}
            <div className="border-b border-gray-100 px-4 py-3">
              <LLMModelSelect value={model} onChange={persistModel} />
            </div>

            {/* 品牌設定 */}
            <div className="border-b border-gray-100">
              <button
                type="button"
                onClick={() => setBrandOpen((o) => !o)}
                className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                <span className="flex items-center gap-2">
                  <Settings2 className="h-4 w-4 text-emerald-600" />
                  品牌設定
                  {!brand.company && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">建議填寫</span>
                  )}
                </span>
                <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform ${brandOpen ? 'rotate-90' : ''}`} />
              </button>
              {brandOpen && (
                <div className="space-y-3 px-4 pb-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">公司 / 品牌名稱</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                      placeholder="例：NeuroSme"
                      value={brand.company}
                      onChange={(e) => persistBrand({ ...brand, company: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">產業</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                      placeholder="例：科技 SaaS、餐飲、零售電商"
                      value={brand.industry}
                      onChange={(e) => persistBrand({ ...brand, industry: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">目標客群</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                      placeholder="例：25-40 歲上班族、中小企業主"
                      value={brand.target}
                      onChange={(e) => persistBrand({ ...brand, target: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600">品牌語氣</label>
                    <div className="flex flex-wrap gap-2">
                      {VOICE_OPTIONS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => persistBrand({ ...brand, voice: brand.voice === v ? '' : v })}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            brand.voice === v
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                          }`}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 文案類型 */}
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">文案類型</p>
              <div className="space-y-1">
                {DOC_TYPES.map((dt) => (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => handleTypeChange(dt.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      selectedType === dt.id
                        ? 'bg-emerald-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {dt.icon}
                    {dt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 欄位表單 */}
            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {currentDocType.fields.map((field) => (
                <div key={field.id}>
                  <label className="mb-1 block text-xs font-medium text-gray-600">{field.label}</label>
                  {field.options ? (
                    <div className="flex flex-wrap gap-2">
                      {field.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => handleFieldChange(field.id, fieldValues[field.id] === opt ? '' : opt)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            fieldValues[field.id] === opt
                              ? 'bg-emerald-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-emerald-50 hover:text-emerald-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : field.multiline ? (
                    <textarea
                      rows={4}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                      placeholder={field.placeholder}
                      value={fieldValues[field.id] ?? ''}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                  ) : (
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                      placeholder={field.placeholder}
                      value={fieldValues[field.id] ?? ''}
                      onChange={(e) => handleFieldChange(field.id, e.target.value)}
                    />
                  )}
                </div>
              ))}

              {/* 額外要求 */}
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">額外要求（選填）</label>
                <textarea
                  rows={2}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-200"
                  placeholder="例：字數限 100 字、加入表情符號、英文版本"
                  value={fieldValues['__extra__'] ?? ''}
                  onChange={(e) => handleFieldChange('__extra__', e.target.value)}
                />
              </div>

              {/* 生成按鈕 */}
              <button
                type="button"
                disabled={isStreaming}
                onClick={handleGenerate}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                {isStreaming ? '生成中...' : '生成文案'}
              </button>
            </div>
          </div>
        )}

        {/* ── 收合按鈕 ── */}
        <button
          type="button"
          onClick={() => setSidebarCollapsed((c) => !c)}
          className="flex w-5 flex-shrink-0 items-center justify-center border-r border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors"
          title={sidebarCollapsed ? '展開面板' : '收合面板'}
        >
          <ChevronRight className={`h-3 w-3 text-gray-400 transition-transform ${sidebarCollapsed ? '' : 'rotate-180'}`} />
        </button>

        {/* ── 右側編輯器 ── */}
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          {/* 工具列 */}
          <div className="flex flex-shrink-0 items-center gap-1 border-b border-gray-200 px-4 py-2">
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              className={`rounded p-1.5 transition-colors hover:bg-gray-100 ${editor?.isActive('bold') ? 'bg-gray-200' : ''}`}
              title="粗體"
            >
              <Bold className="h-4 w-4 text-gray-600" />
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              className={`rounded p-1.5 transition-colors hover:bg-gray-100 ${editor?.isActive('italic') ? 'bg-gray-200' : ''}`}
              title="斜體"
            >
              <Italic className="h-4 w-4 text-gray-600" />
            </button>
            <button
              type="button"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              className={`rounded p-1.5 transition-colors hover:bg-gray-100 ${editor?.isActive('bulletList') ? 'bg-gray-200' : ''}`}
              title="清單"
            >
              <List className="h-4 w-4 text-gray-600" />
            </button>

            <div className="mx-2 h-5 w-px bg-gray-200" />

            <button
              type="button"
              onClick={handleClear}
              disabled={isStreaming}
              className="rounded p-1.5 transition-colors hover:bg-gray-100 disabled:opacity-40"
              title="清除"
            >
              <RotateCcw className="h-4 w-4 text-gray-600" />
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 ml-auto"
            >
              <ClipboardCopy className="h-3.5 w-3.5" />
              {copyFeedback ? '已複製！' : '複製文案'}
            </button>
          </div>

          {/* 編輯區 */}
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {isStreaming && (
              <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 shadow-sm">
                <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                生成中
              </div>
            )}
            <EditorContent editor={editor} className="h-full" />
            {!isStreaming && !editor?.getText().trim() && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <Megaphone className="mx-auto mb-3 h-10 w-10 text-gray-200" />
                  <p className="text-sm text-gray-300">填寫左側資料後點擊「生成文案」</p>
                </div>
              </div>
            )}
          </div>

          {/* 底部 meta */}
          {lastMeta && (
            <div className="flex flex-shrink-0 items-center gap-3 border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
              <span>{lastMeta.model}</span>
              {lastMeta.usage && (
                <span>tokens: {lastMeta.usage.total_tokens.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {errorModal && (
        <ErrorModal
          title={errorModal.title}
          message={errorModal.message}
          onClose={() => setErrorModal(null)}
        />
      )}
    </div>
  )
}
