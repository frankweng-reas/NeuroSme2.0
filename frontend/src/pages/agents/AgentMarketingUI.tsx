/** Marketing Agent UI：品牌設定 + 文案類型表單 + TipTap 編輯器
 *  風格對齊 AgentWritingUI：深色左側面板 + 右側白色編輯器 + amber toolbar
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import {
  ChevronRight,
  ClipboardCopy,
  Megaphone,
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  Sparkles,
  RotateCcw,
  Undo2,
  Pencil,
} from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import ErrorModal from '@/components/ErrorModal'
import { chatCompletionsStream } from '@/api/chat'
import { createChatThread } from '@/api/chatThreads'
import type { Agent } from '@/types'

const HEADER_COLOR = '#1a3a2a'
const ACCENT_COLOR = '#16a34a'
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
  fields: FieldDef[]
}

const DOC_TYPES: DocTypeDef[] = [
  {
    id: 'social_post',
    label: '社群貼文',
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
    fields: [
      { id: 'event_name', label: '活動名稱', placeholder: '例：2025 NeuroSme 新品發表會' },
      { id: 'date_location', label: '時間 / 地點', placeholder: '例：2025/06/15 下午 2:00，台北信義區' },
      { id: 'target_audience', label: '目標對象', placeholder: '例：中小企業主、IT 採購負責人' },
      { id: 'highlights', label: '活動亮點', placeholder: '條列精彩環節，例：\n- AI 功能現場 Demo\n- 限定早鳥優惠\n- Q&A 與專家交流', multiline: true },
      { id: 'cta', label: '報名 / 購票方式', placeholder: '例：掃描 QR Code 立即報名' },
    ],
  },
]

const VOICE_OPTIONS = ['活潑', '專業', '親切', '科技感']

interface BrandProfile {
  company: string
  industry: string
  target: string
  voice: string
}

// ── Prompt 建構 ───────────────────────────────────────────────────────────────

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

function buildRewritePrompt(fullText: string, selectedText: string, instruction: string): string {
  const markedDoc = fullText.replace(selectedText, `[REWRITE_START]\n${selectedText}\n[REWRITE_END]`)
  return `改寫指令：${instruction}\n\n完整文件如下，請只改寫標記範圍內的段落：\n\n${markedDoc}`
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

export default function AgentMarketingUI({ agent }: { agent: Agent }) {
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
  const [rewriteInput, setRewriteInput] = useState('')
  const [showRewriteInput, setShowRewriteInput] = useState(false)
  const [isRewriting, setIsRewriting] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [lastMeta, setLastMeta] = useState<{
    model: string
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  } | null>(null)

  const fullTextRef = useRef('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rewriteRangeRef = useRef<{ from: number; to: number } | null>(null)

  const editor = useEditor({
    extensions: [StarterKit],
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'outline-none min-h-full px-8 py-6 prose prose-gray max-w-none text-base leading-relaxed',
      },
    },
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to } = e.state.selection
      setHasSelection(from !== to)
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

  const handleRewrite = useCallback(async (instruction: string) => {
    if (!editor || isRewriting || isStreaming) return
    const { from, to } = editor.state.selection
    if (from === to) return
    const selectedText = editor.state.doc.textBetween(from, to, '\n')
    const fullText = editor.getText()
    if (!selectedText.trim()) return

    rewriteRangeRef.current = { from, to }
    setIsRewriting(true)
    setShowRewriteInput(false)
    setRewriteInput('')

    const prompt = buildRewritePrompt(fullText, selectedText, instruction)
    let rewrittenText = ''

    try {
      await chatCompletionsStream(
        {
          agent_id: agent.id,
          prompt_type: 'writing_rewrite',
          system_prompt: '',
          user_prompt: '',
          data: '',
          model,
          messages: [],
          content: prompt,
          chat_thread_id: threadId ?? '',
        },
        {
          onDelta: (chunk) => { rewrittenText += chunk },
          onDone: () => {
            if (rewriteRangeRef.current && editor && rewrittenText) {
              const { from: f, to: t } = rewriteRangeRef.current
              editor.chain().setTextSelection({ from: f, to: t }).deleteSelection().insertContent(rewrittenText).run()
            }
            rewriteRangeRef.current = null
            setIsRewriting(false)
          },
          onError: (msg) => {
            rewriteRangeRef.current = null
            setIsRewriting(false)
            setErrorModal({ title: '改寫失敗', message: msg ?? '發生未知錯誤' })
          },
        }
      )
    } catch (e) {
      rewriteRangeRef.current = null
      setIsRewriting(false)
      setErrorModal({ title: '改寫失敗', message: e instanceof Error ? e.message : '發生未知錯誤' })
    }
  }, [agent.id, editor, isRewriting, isStreaming, model, threadId])

  const hasContent = editor && editor.getText().trim().length > 0

  const inputCls = 'w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/30 focus:border-green-400 focus:outline-none focus:ring-1 focus:ring-green-400'
  const selectCls = `${inputCls} [&>option]:bg-[${HEADER_COLOR}] [&>option]:text-white`

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <ErrorModal
        open={errorModal != null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* ── 左側面板 ────────────────────────────────────────────────── */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-96'
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
                title="展開設定"
                aria-label="展開設定"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-white/80" />
                  <h3 className="text-base font-semibold text-white">行銷設定</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                  title="折疊"
                  aria-label="折疊設定"
                >
                  {'<<'}
                </button>
              </>
            )}
          </div>

          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto text-lg">
              <div className="flex-1 space-y-5 px-4 py-4">

                {/* 品牌設定 */}
                <div className="rounded-lg border border-white/20 bg-white/5">
                  <button
                    type="button"
                    onClick={() => setBrandOpen((o) => !o)}
                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-base font-medium text-white/80 transition-colors hover:bg-white/10"
                  >
                    <span className="flex items-center gap-2">
                      <span>🏷️</span>
                      品牌設定
                      {brand.company && (
                        <span className="text-sm text-white/50 font-normal">（已填）</span>
                      )}
                    </span>
                    <span className="text-white/50">{brandOpen ? '▲' : '▼'}</span>
                  </button>
                  {brandOpen && (
                    <div className="space-y-3 px-3 pb-3">
                      <div>
                        <label className="mb-1 block text-base text-white/70">公司 / 品牌名稱</label>
                        <input type="text" value={brand.company} onChange={(e) => persistBrand({ ...brand, company: e.target.value })} placeholder="例：NeuroSme" className={inputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-base text-white/70">產業</label>
                        <input type="text" value={brand.industry} onChange={(e) => persistBrand({ ...brand, industry: e.target.value })} placeholder="例：科技 SaaS、餐飲、零售電商" className={inputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-base text-white/70">目標客群</label>
                        <input type="text" value={brand.target} onChange={(e) => persistBrand({ ...brand, target: e.target.value })} placeholder="例：25-40 歲上班族、中小企業主" className={inputCls} />
                      </div>
                      <div>
                        <label className="mb-1 block text-base text-white/70">品牌語氣</label>
                        <select value={brand.voice} onChange={(e) => persistBrand({ ...brand, voice: e.target.value })} className={inputCls}>
                          <option value="" className="bg-[#1a3a2a] text-white/60">— 未指定 —</option>
                          {VOICE_OPTIONS.map((v) => (
                            <option key={v} value={v} className="bg-[#1a3a2a] text-white">{v}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                {/* 文案類型 */}
                <div>
                  <label className="mb-1.5 block font-medium text-white/70">文案類型</label>
                  <select
                    value={selectedType}
                    onChange={(e) => handleTypeChange(e.target.value as DocTypeId)}
                    className={inputCls}
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t.id} value={t.id} className="bg-[#1a3a2a] text-white">{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* 動態欄位 */}
                <div className="space-y-4">
                  <p className="font-medium text-white/70">填寫資訊</p>
                  {currentDocType.fields.map((field) => (
                    <div key={field.id}>
                      <label className="mb-1 block text-white/80">{field.label}</label>
                      {field.options ? (
                        <select
                          value={fieldValues[field.id] ?? field.options[0]}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          className={inputCls}
                        >
                          {field.options.map((o) => (
                            <option key={o} value={o} className="bg-[#1a3a2a] text-white">{o}</option>
                          ))}
                        </select>
                      ) : field.multiline ? (
                        <textarea
                          rows={4}
                          value={fieldValues[field.id] ?? ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          className={`${inputCls} resize-none`}
                        />
                      ) : (
                        <input
                          type="text"
                          value={fieldValues[field.id] ?? ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          className={inputCls}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 生成按鈕區 */}
              <div className="shrink-0 border-t border-white/20 p-4">
                <div className="mb-3">
                  <label className="mb-1 block text-base text-white/70">對 AI 的額外要求（選填）</label>
                  <textarea
                    rows={3}
                    value={fieldValues['__extra__'] ?? ''}
                    onChange={(e) => handleFieldChange('__extra__', e.target.value)}
                    placeholder="例：字數限 100 字、加表情符號、英文版本"
                    className={`${inputCls} resize-none`}
                  />
                </div>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={handleGenerate}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-lg font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: ACCENT_COLOR }}
                >
                  <Sparkles className="h-5 w-5" />
                  {isStreaming ? '生成中…' : '生成文案'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 右側編輯器 ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* Toolbar 第一排：狀態 + 模型 + 操作 */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2.5">
            <span className="text-base font-medium text-gray-600">
              {isStreaming ? (
                <span className="flex items-center gap-2 text-amber-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  生成中…
                </span>
              ) : isRewriting ? (
                <span className="flex items-center gap-2 text-blue-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                  改寫中…
                </span>
              ) : hasContent ? (
                '文案（可直接編輯）'
              ) : (
                '在左側填寫資訊後點擊「生成文案」'
              )}
            </span>
            <div className="flex items-center gap-2">
              <LLMModelSelect value={model} onChange={persistModel} compact labelPosition="inline" />
              {hasContent && (
                <>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isStreaming}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" />
                    清除
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-600 transition-colors hover:bg-gray-50"
                  >
                    <ClipboardCopy className="h-4 w-4" />
                    {copyFeedback ? '已複製！' : '複製'}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Toolbar 第二排：格式 + AI 改寫（有內容時顯示） */}
          {hasContent && (
            <div className="flex shrink-0 items-center gap-1 border-y border-green-200 bg-gradient-to-b from-green-100 to-green-50 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.08)]">
              {[
                { icon: <Bold className="h-4 w-4" />, title: '粗體', action: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive('bold') },
                { icon: <Italic className="h-4 w-4" />, title: '斜體', action: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive('italic') },
                { icon: <Heading2 className="h-4 w-4" />, title: '標題', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: editor?.isActive('heading', { level: 2 }) },
                { icon: <List className="h-4 w-4" />, title: '條列清單', action: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive('bulletList') },
                { icon: <ListOrdered className="h-4 w-4" />, title: '數字清單', action: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive('orderedList') },
              ].map(({ icon, title, action, active }) => (
                <button
                  key={title}
                  type="button"
                  onClick={action}
                  disabled={isStreaming || isRewriting}
                  title={title}
                  className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${
                    active ? 'bg-white text-green-800 shadow-sm' : 'text-green-600 hover:bg-white/70 hover:text-green-800'
                  }`}
                >
                  {icon}
                </button>
              ))}
              <div className="mx-1 h-4 w-px bg-green-300" />
              <button
                type="button"
                onClick={() => editor?.commands.undo()}
                disabled={!editor?.can().undo()}
                title="復原"
                className="rounded-lg p-2 text-green-600 transition-colors hover:bg-white/70 hover:text-green-800 disabled:opacity-30"
              >
                <Undo2 className="h-4 w-4" />
              </button>

              {hasSelection && !isStreaming && (
                <>
                  <div className="mx-1 h-4 w-px bg-green-300" />
                  {[
                    { label: '重寫', instruction: '重新改寫這段，保持語意但換一種更吸引人的表達方式' },
                    { label: '縮短', instruction: '將這段縮短，保留核心意思' },
                    { label: '活潑化', instruction: '將這段改為更活潑、有感染力的語氣' },
                    { label: '正式化', instruction: '將這段改為更正式專業的語氣' },
                  ].map(({ label, instruction }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleRewrite(instruction)}
                      disabled={isRewriting}
                      className="rounded-lg px-2.5 py-1 text-sm font-medium text-green-700 transition-colors hover:bg-white/70 hover:text-green-900 disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                  <div className="mx-1 h-4 w-px bg-green-300" />
                  {showRewriteInput ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => { e.preventDefault(); if (rewriteInput.trim()) handleRewrite(rewriteInput.trim()) }}
                    >
                      <input
                        autoFocus
                        type="text"
                        value={rewriteInput}
                        onChange={(e) => setRewriteInput(e.target.value)}
                        placeholder="輸入改寫指令…"
                        className="w-40 rounded-lg border border-green-300 bg-white px-2 py-1 text-sm focus:border-green-500 focus:outline-none"
                      />
                      <button type="submit" disabled={!rewriteInput.trim() || isRewriting} className="rounded-lg px-2 py-1 text-sm font-medium text-green-700 hover:bg-white/70 disabled:opacity-40">送出</button>
                      <button type="button" onClick={() => { setShowRewriteInput(false); setRewriteInput('') }} className="rounded-lg px-1.5 py-1 text-sm text-green-500 hover:bg-white/70">✕</button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRewriteInput(true)}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium text-green-700 transition-colors hover:bg-white/70"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      自訂
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* 編輯區 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasContent && !isStreaming ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
                <Megaphone className="h-16 w-16 opacity-30" />
                <p className="text-base">填寫左側表單，AI 將幫你生成文案</p>
              </div>
            ) : (
              <EditorContent editor={editor} className="h-full" />
            )}
          </div>

          {/* 底部 Meta */}
          {lastMeta && (
            <div className="shrink-0 border-t border-green-200 bg-gradient-to-b from-green-100 to-green-50 px-4 py-1.5 text-xs text-green-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.06)]">
              <span className="font-medium text-gray-500">{lastMeta.model}</span>
              {lastMeta.usage && (
                <span> · prompt: {lastMeta.usage.prompt_tokens} · completion: {lastMeta.usage.completion_tokens} · total: {lastMeta.usage.total_tokens}</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
