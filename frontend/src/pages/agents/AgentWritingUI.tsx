/** Writing Agent UI：左側引導式表單 + 右側 TipTap 編輯器 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { marked } from 'marked'
import { ChevronRight, ClipboardCopy, FileText, Mail, Bold, Italic, List, ListOrdered, Heading2, Pencil, RotateCcw, Sparkles, Undo2 } from 'lucide-react'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import { chatCompletionsStream } from '@/api/chat'
import { createChatThread } from '@/api/chatThreads'
import type { Agent } from '@/types'

const HEADER_COLOR = '#1C3939'
const STORAGE_KEY = 'agent-writing-ui-model'
const PROFILE_STORAGE_KEY = 'agent-writing-ui-profile'

// ── 文件類型定義 ────────────────────────────────────────────────────────────

type DocTypeId = 'email' | 'proposal' | 'report' | 'meeting' | 'announcement' | 'custom'

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
    id: 'email',
    label: '商業 Email',
    icon: <Mail className="h-4 w-4" />,
    fields: [
      { id: 'recipient', label: '收件對象', placeholder: '例：客戶 Mr. Chen、主管 Sarah' },
      { id: 'purpose', label: '目的', placeholder: '例：跟進上週報價、邀請參加說明會' },
      { id: 'tone', label: '語氣', placeholder: '', options: ['正式', '友善', '強硬'] },
      { id: 'key_facts', label: '關鍵內容', placeholder: '條列說明重點，例：\n- 報價單號 QT-2024-001\n- 詢問是否有疑問\n- 希望本週確認', multiline: true },
    ],
  },
  {
    id: 'proposal',
    label: '提案簡介',
    icon: <FileText className="h-4 w-4" />,
    fields: [
      { id: 'product', label: '公司 / 產品', placeholder: '例：NeuroSme AI 助理平台' },
      { id: 'target', label: '目標客戶', placeholder: '例：中小型製造業、電商賣家' },
      { id: 'pain_point', label: '客戶痛點', placeholder: '例：人工報表耗時、客服人力不足', multiline: true },
      { id: 'advantage', label: '核心優勢', placeholder: '例：導入快速、不需改變現有流程', multiline: true },
    ],
  },
  {
    id: 'report',
    label: '工作報告',
    icon: <Sparkles className="h-4 w-4" />,
    fields: [
      { id: 'topic', label: '報告主題', placeholder: '例：2024 Q4 業績總結' },
      { id: 'period', label: '時間範圍', placeholder: '例：2024/10 – 2024/12' },
      { id: 'findings', label: '主要發現 / 數據', placeholder: '例：\n- 業績達成率 108%\n- 新客戶增加 23 家', multiline: true },
      { id: 'audience', label: '受眾', placeholder: '例：管理階層、董事會' },
    ],
  },
  {
    id: 'meeting',
    label: '會議摘要',
    icon: <FileText className="h-4 w-4" />,
    fields: [
      { id: 'topic', label: '會議主題', placeholder: '例：2025 Q1 產品規劃會議' },
      { id: 'date', label: '日期 / 時間', placeholder: '例：2025/04/18 下午 2:00' },
      { id: 'attendees', label: '與會者', placeholder: '例：Frank（主持）、Sarah、Alan' },
      { id: 'discussion', label: '討論重點', placeholder: '條列主要討論內容', multiline: true },
      { id: 'decisions', label: '決議事項', placeholder: '條列已確認的決定', multiline: true },
      { id: 'actions', label: '行動項目', placeholder: '例：\n- Frank：完成 UI 設計稿（4/25 前）\n- Sarah：準備報價單（4/22 前）', multiline: true },
    ],
  },
  {
    id: 'announcement',
    label: '內部公告',
    icon: <Mail className="h-4 w-4" />,
    fields: [
      { id: 'title', label: '公告標題', placeholder: '例：辦公室搬遷公告' },
      { id: 'audience', label: '公告對象', placeholder: '例：全體同仁、業務部' },
      { id: 'content', label: '公告內容', placeholder: '說明公告事項、原因、注意事項', multiline: true },
      { id: 'effective_date', label: '生效 / 執行日期（選填）', placeholder: '例：2025/05/01 起' },
      { id: 'contact', label: '聯絡窗口（選填）', placeholder: '例：人資部 Sarah，分機 123' },
    ],
  },
  {
    id: 'custom',
    label: '自訂文件',
    icon: <Pencil className="h-4 w-4" />,
    fields: [
      { id: 'doc_type_name', label: '文件類型', placeholder: '例：感謝函、道歉信、合作邀約、聲明稿' },
      { id: 'recipient', label: '對象 / 收件人（選填）', placeholder: '例：客戶 Mr. Chen、全體員工' },
      { id: 'tone', label: '語氣', placeholder: '', options: ['正式', '友善', '強硬'] },
      { id: 'content_desc', label: '內容說明', placeholder: '說明這份文件要表達什麼、重點是什麼，越具體越好', multiline: true },
    ],
  },
]

// ── 範本定義 ────────────────────────────────────────────────────────────────

interface TemplateDef {
  id: string
  label: string
  fields: Record<string, string>
}

const TEMPLATES: Record<DocTypeId, TemplateDef[]> = {
  email: [
    {
      id: 'quote-followup',
      label: '報價跟進',
      fields: {
        recipient: '客戶（對方姓名或稱謂）',
        purpose: '跟進上週寄出的報價單，確認對方是否有疑問，並表達期待合作',
        tone: '友善',
        key_facts: '- 報價單已於上週寄出\n- 詢問是否有需要說明或調整的地方\n- 希望本週內能確認是否進行下一步',
      },
    },
    {
      id: 'meeting-invite',
      label: '會議邀請',
      fields: {
        recipient: '客戶或合作夥伴',
        purpose: '邀請對方參加線上/面對面會議，說明會議目的與時間',
        tone: '正式',
        key_facts: '- 會議主題：產品說明 / 合作討論\n- 時間：請填入具體日期與時段\n- 地點 / 連結：請填入會議室或視訊連結\n- 預計時長：60 分鐘',
      },
    },
    {
      id: 'thank-visit',
      label: '感謝拜訪',
      fields: {
        recipient: '客戶姓名',
        purpose: '感謝對方撥冗會面，簡短回顧會議重點，並說明後續行動',
        tone: '友善',
        key_facts: '- 感謝對方今天的時間\n- 回顧討論的主要議題\n- 說明我方的下一步行動與時程',
      },
    },
  ],
  proposal: [
    {
      id: 'saas-proposal',
      label: 'SaaS 產品提案',
      fields: {
        product: '（填入您的公司名稱）AI 智慧助理平台',
        target: '中小型企業、製造業、服務業',
        pain_point: '- 員工每天花大量時間在重複性工作（報表、回覆、整理資料）\n- 導入 AI 工具技術門檻高，需要工程師維護\n- 雲端 AI 服務有資料外洩疑慮',
        advantage: '- 私有化部署，資料不離開企業\n- 無程式碼操作，員工一天內上手\n- 支援多種 AI 模型，可依需求切換',
      },
    },
    {
      id: 'service-proposal',
      label: '服務導入提案',
      fields: {
        product: '（填入您的服務名稱）',
        target: '（填入目標客戶類型）',
        pain_point: '- 現有流程耗時且容易出錯\n- 缺乏系統化管理工具\n- 人力成本持續上升',
        advantage: '- 快速導入，不影響既有作業\n- 降低人工成本約 30%\n- 提供完整教育訓練與售後支援',
      },
    },
  ],
  report: [
    {
      id: 'monthly-sales',
      label: '月度業績報告',
      fields: {
        topic: '（月份）業績總結報告',
        period: '（填入月份，例：2025/04/01 – 2025/04/30）',
        findings: '- 本月業績目標：（填入）\n- 實際達成：（填入）\n- 達成率：（填入）%\n- 新客戶數：（填入）家\n- 主要成交案件：（條列）\n- 未達標原因分析：（填入）',
        audience: '管理階層 / 業務主管',
      },
    },
    {
      id: 'project-progress',
      label: '專案進度報告',
      fields: {
        topic: '（專案名稱）進度報告',
        period: '（填入報告期間）',
        findings: '- 本期完成項目：（條列）\n- 進行中項目：（條列）\n- 待處理項目：（條列）\n- 目前風險與障礙：（填入）\n- 預計下期完成事項：（條列）',
        audience: '專案負責人 / 客戶',
      },
    },
  ],
  meeting: [
    {
      id: 'weekly-meeting',
      label: '週會摘要',
      fields: {
        topic: '週例會',
        date: '（填入日期，例：2025/04/18 上午 10:00）',
        attendees: '（填入與會者名單）',
        discussion: '1. 本週工作進度回顧\n2. 待解決問題討論\n3. 下週工作計劃',
        decisions: '- （填入本次確認的決議）',
        actions: '- （負責人）：（任務內容）（期限）',
      },
    },
    {
      id: 'kickoff-meeting',
      label: '專案啟動會議',
      fields: {
        topic: '（專案名稱）啟動會議',
        date: '（填入日期與時間）',
        attendees: '（填入與會者，標註各自角色）',
        discussion: '1. 專案背景與目標說明\n2. 範疇與交付物確認\n3. 時程規劃討論\n4. 分工與責任確認\n5. 溝通機制與回報頻率',
        decisions: '- 專案正式啟動\n- 時程與里程碑已確認\n- 各成員分工已確認',
        actions: '- 各成員依分工開始執行\n- 下次進度會議：（填入日期）',
      },
    },
  ],
  announcement: [
    {
      id: 'office-notice',
      label: '辦公室公告',
      fields: {
        title: '辦公室（事項）公告',
        audience: '全體同仁',
        content: '（說明公告事項，例如：場地調整、設備維護、停車規定、訪客管理等）\n\n請各位同仁配合遵守，若有疑問請聯繫相關窗口。',
        effective_date: '即日起 / （填入具體日期）',
        contact: '（填入聯絡人與聯絡方式）',
      },
    },
    {
      id: 'personnel-change',
      label: '人事異動公告',
      fields: {
        title: '人事異動公告',
        audience: '全體同仁',
        content: '敬啟者：\n\n茲通知以下人事異動：\n\n- 姓名：（填入）\n- 原職務：（填入）\n- 新職務：（填入）\n- 生效日期：（填入）\n\n感謝（姓名）對公司的貢獻，並預祝新職務順利。',
        effective_date: '（填入生效日期）',
        contact: '人資部（填入聯絡方式）',
      },
    },
  ],
  custom: [],
}


function buildPrompt(docType: DocTypeDef, values: Record<string, string>, profile: { name: string; company: string }): string {
  const isCustom = docType.id === 'custom'
  const docTypeName = isCustom ? (values['doc_type_name'] ?? '').trim() || '自訂文件' : docType.label
  const lines = [`請撰寫一份${docTypeName}，資訊如下：`, '']
  if (profile.name.trim())    lines.push(`**撰寫人姓名**: ${profile.name.trim()}`)
  if (profile.company.trim()) lines.push(`**公司名稱**: ${profile.company.trim()}`)
  for (const field of docType.fields) {
    if (isCustom && field.id === 'doc_type_name') continue  // 已用於標題，不重複
    // 下拉選單若使用者未動過，fieldValues 無值，改用第一個 option 作為預設
    const val = field.options
      ? (values[field.id] ?? field.options[0])
      : (values[field.id] ?? '').trim()
    if (val) lines.push(`**${field.label}**: ${val}`)
  }
  const extra = (values['__extra__'] ?? '').trim()
  if (extra) lines.push(`\n**額外要求**: ${extra}`)
  lines.push('', '請直接輸出文件本體，不需要前言或後記。不要使用佔位符，若資訊不足請合理推斷或省略。')
  return lines.join('\n')
}

function buildRewritePrompt(fullText: string, selectedText: string, instruction: string): string {
  const markedDoc = fullText.replace(
    selectedText,
    `[REWRITE_START]\n${selectedText}\n[REWRITE_END]`
  )
  return `改寫指令：${instruction}\n\n完整文件如下，請只改寫標記範圍內的段落：\n\n${markedDoc}`
}

function markdownToHtml(text: string): string {
  try {
    const html = marked.parse(text, { async: false }) as string
    return html || '<p></p>'
  } catch {
    // fallback：純換行轉段落
    return text.split('\n\n').map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('') || '<p></p>'
  }
}

// ── 主元件 ───────────────────────────────────────────────────────────────────

interface AgentWritingUIProps {
  agent: Agent
}

export default function AgentWritingUI({ agent }: AgentWritingUIProps) {
  const [model, setModel] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || '' } catch { return '' }
  })
  const [profile, setProfile] = useState<{ name: string; company: string }>(() => {
    try {
      const saved = localStorage.getItem(PROFILE_STORAGE_KEY)
      return saved ? JSON.parse(saved) : { name: '', company: '' }
    } catch { return { name: '', company: '' } }
  })
  const [profileOpen, setProfileOpen] = useState(() => {
    try {
      const saved = localStorage.getItem(PROFILE_STORAGE_KEY)
      if (!saved) return true  // 第一次使用，預設展開提示填寫
      const p = JSON.parse(saved)
      return !p.name && !p.company  // 若已填過則收起
    } catch { return true }
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [selectedType, setSelectedType] = useState<DocTypeId>('email')
  const [selectedTemplate, setSelectedTemplate] = useState('')
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
  const [showHelpModal, setShowHelpModal] = useState(false)

  const fullTextRef = useRef('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // 儲存重寫時的選取範圍，避免串流過程中選取遺失
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

  // 清理 interval
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  // 進頁面時建立 chat thread（用於後端 monitoring）
  useEffect(() => {
    createChatThread({ agent_id: agent.id, title: null })
      .then((t) => setThreadId(t.id))
      .catch(() => {})
  }, [agent.id])

  const persistModel = useCallback((m: string) => {
    setModel(m)
    try { localStorage.setItem(STORAGE_KEY, m) } catch { /* ignore */ }
  }, [])

  const persistProfile = useCallback((updated: { name: string; company: string }) => {
    setProfile(updated)
    try { localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updated)) } catch { /* ignore */ }
  }, [])

  const currentDocType = DOC_TYPES.find((t) => t.id === selectedType)!

  const handleTypeChange = useCallback((id: DocTypeId) => {
    setSelectedType(id)
    setFieldValues({})
    setSelectedTemplate('')
  }, [])

  const handleTemplateChange = useCallback((templateId: string) => {
    setSelectedTemplate(templateId)
    if (!templateId) return
    const tpl = TEMPLATES[selectedType]?.find((t) => t.id === templateId)
    if (tpl) setFieldValues(tpl.fields)
  }, [selectedType])

  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }))
  }, [])

  const stopStreaming = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const handleGenerate = useCallback(async () => {
    if (isStreaming || !editor) return
    const prompt = buildPrompt(currentDocType, fieldValues, profile)

    editor.commands.setContent('<p></p>')
    fullTextRef.current = ''
    setIsStreaming(true)

    // 50ms buffer flush
    intervalRef.current = setInterval(() => {
      if (fullTextRef.current && editor) {
        editor.commands.setContent(markdownToHtml(fullTextRef.current), { emitUpdate: false })
      }
    }, 50)

    try {
      await chatCompletionsStream(
        {
          agent_id: agent.id,
          prompt_type: 'writing',
          system_prompt: '',
          user_prompt: '',
          data: '',
          model,
          messages: [],
          content: prompt,
          chat_thread_id: threadId ?? '',
        },
        {
          onDelta: (chunk) => {
            fullTextRef.current += chunk
          },
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
      const msg = e instanceof Error ? e.message : '發生未知錯誤'
      setErrorModal({ title: '生成失敗', message: msg })
    }
  }, [agent.id, currentDocType, editor, fieldValues, isStreaming, model, profile, stopStreaming, threadId])

  const handleCopy = useCallback(async () => {
    if (!editor) return
    // 自訂走訪：有內容的段落輸出文字 + \n，真正空的段落（使用者手動加的空行）輸出 \n
    const lines: string[] = []
    editor.state.doc.forEach((node) => {
      const text = node.textContent
      lines.push(text)
    })
    // 移除尾端多餘空行後組合，非空行之間用單一 \n，空行節點保留為空字串（產生 \n\n）
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()
    try {
      await navigator.clipboard.writeText(text)
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
          onDelta: (chunk) => {
            rewrittenText += chunk
          },
          onDone: () => {
            if (rewriteRangeRef.current && editor && rewrittenText) {
              const { from: f, to: t } = rewriteRangeRef.current
              editor.chain()
                .setTextSelection({ from: f, to: t })
                .deleteSelection()
                .insertContent(rewrittenText)
                .run()
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
      const msg = e instanceof Error ? e.message : '發生未知錯誤'
      setErrorModal({ title: '改寫失敗', message: msg })
    }
  }, [agent.id, editor, isRewriting, isStreaming, model, threadId])

  const hasContent = editor && editor.getText().trim().length > 0

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <ErrorModal
        open={errorModal != null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-writing-agent.md"
        title="Writing Agent 使用說明"
      />

      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* ── 左側：設定面板 ────────────────────────────────────────────────── */}
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
                  <FileText className="h-4 w-4 text-white/80" />
                  <h3 className="text-base font-semibold text-white">文書設定</h3>
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

                {/* 個人資訊 */}
                <div className="rounded-lg border border-[#5D8AA8]/50 bg-[#011F5B]/50">
                  <button
                    type="button"
                    onClick={() => setProfileOpen((o) => !o)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-base font-medium text-white/80 hover:bg-white/10 rounded-lg transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span>👤</span>
                      個人資訊
                      {(profile.name || profile.company) && (
                        <span className="text-sm text-white/50 font-normal">（已填）</span>
                      )}
                    </span>
                    <span className="text-white/50">{profileOpen ? '▲' : '▼'}</span>
                  </button>
                  {profileOpen && (
                    <div className="space-y-3 px-3 pb-3">
                      <div>
                        <label className="mb-1 block text-base text-white/70">您的姓名</label>
                        <input
                          type="text"
                          value={profile.name}
                          onChange={(e) => persistProfile({ ...profile, name: e.target.value })}
                          placeholder="例：王小明"
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder:text-white/30 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-base text-white/70">公司名稱</label>
                        <input
                          type="text"
                          value={profile.company}
                          onChange={(e) => persistProfile({ ...profile, company: e.target.value })}
                          placeholder="例：NeuroSme 科技"
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder:text-white/30 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* ── 文件設定分隔 ── */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-px flex-1 bg-white/15" />
                  <span className="text-xs font-medium uppercase tracking-widest text-white/35">文件設定</span>
                  <div className="h-px flex-1 bg-white/15" />
                </div>

                {/* 文件類型選擇 */}
                <div>
                  <label className="mb-1.5 block font-medium text-white/70">文件類型</label>
                  <select
                    value={selectedType}
                    onChange={(e) => handleTypeChange(e.target.value as DocTypeId)}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t.id} value={t.id} className="bg-[#1C3939] text-white">
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* 範本選擇 */}
                <div>
                  <label className="mb-1.5 block font-medium text-white/70">套用範本（選填）</label>
                  <select
                    value={selectedTemplate}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                  >
                    <option value="" className="bg-[#1C3939] text-white/60">— 不套用範本 —</option>
                    {TEMPLATES[selectedType]?.map((t) => (
                      <option key={t.id} value={t.id} className="bg-[#1C3939] text-white">
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* ── 填寫資訊分隔 ── */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="h-px flex-1 bg-white/15" />
                  <span className="text-xs font-medium uppercase tracking-widest text-white/35">填寫資訊</span>
                  <div className="h-px flex-1 bg-white/15" />
                </div>

                {/* 動態欄位 */}
                <div className="space-y-4">
                  {currentDocType.fields.map((field) => (
                    <div key={field.id}>
                      <label className="mb-1 block text-white/80">
                        {field.label}
                      </label>
                      {field.options ? (
                        <select
                          value={fieldValues[field.id] ?? field.options[0]}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                        >
                          {field.options.map((o) => (
                            <option key={o} value={o} className="bg-[#1C3939] text-white">
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : field.multiline ? (
                        <textarea
                          rows={4}
                          value={fieldValues[field.id] ?? ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/30 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                        />
                      ) : (
                        <input
                          type="text"
                          value={fieldValues[field.id] ?? ''}
                          onChange={(e) => handleFieldChange(field.id, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white placeholder:text-white/30 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* 生成按鈕 */}
              <div className="shrink-0 border-t border-white/20 p-4">
                {/* 額外要求 */}
                <div className="mb-3">
                  <label className="mb-1 block text-base text-white/70">對 AI 的額外要求（選填）</label>
                  <textarea
                    rows={3}
                    value={fieldValues['__extra__'] ?? ''}
                    onChange={(e) => handleFieldChange('__extra__', e.target.value)}
                    placeholder="例：語氣正式但不冷漠、結尾不要直接要求回覆、字數控制在 200 字內"
                    className="w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder:text-white/30 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                  />
                </div>
                <button
                  type="button"
                  disabled={isStreaming}
                  onClick={handleGenerate}
                  className="flex w-full items-center justify-center gap-2 rounded-lg py-3 text-lg font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: '#AE924C' }}
                >
                  <Sparkles className="h-5 w-5" />
                  {isStreaming ? '生成中…' : '生成草稿'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── 右側：編輯器 ─────────────────────────────────────────────────── */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          {/* 編輯器 Toolbar — 第一排：狀態 + 模型 + 操作 */}
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
                '草稿（可直接編輯）'
              ) : (
                '在左側填寫資訊後點擊「生成草稿」'
              )}
            </span>
            <div className="flex items-center gap-2">
              <LLMModelSelect
                value={model}
                onChange={persistModel}
                compact
                labelPosition="inline"
              />
              {hasContent && (
                <>
                  <button
                    type="button"
                    onClick={handleClear}
                    disabled={isStreaming}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40"
                    title="清除"
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

          {/* 編輯器 Toolbar — 第二排：格式按鈕（有內容時顯示） */}
          {hasContent && (
            <div className="flex shrink-0 items-center gap-1 border-y border-amber-200 bg-gradient-to-b from-amber-100 to-amber-50 px-4 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.06),0_2px_4px_rgba(0,0,0,0.08)]">
              {[
                {
                  icon: <Bold className="h-4 w-4" />,
                  title: '粗體',
                  action: () => editor?.chain().focus().toggleBold().run(),
                  active: editor?.isActive('bold'),
                },
                {
                  icon: <Italic className="h-4 w-4" />,
                  title: '斜體',
                  action: () => editor?.chain().focus().toggleItalic().run(),
                  active: editor?.isActive('italic'),
                },
                {
                  icon: <Heading2 className="h-4 w-4" />,
                  title: '標題',
                  action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
                  active: editor?.isActive('heading', { level: 2 }),
                },
                {
                  icon: <List className="h-4 w-4" />,
                  title: '條列清單',
                  action: () => editor?.chain().focus().toggleBulletList().run(),
                  active: editor?.isActive('bulletList'),
                },
                {
                  icon: <ListOrdered className="h-4 w-4" />,
                  title: '數字清單',
                  action: () => editor?.chain().focus().toggleOrderedList().run(),
                  active: editor?.isActive('orderedList'),
                },
              ].map(({ icon, title, action, active }) => (
                <button
                  key={title}
                  type="button"
                  onClick={action}
                  disabled={isStreaming || isRewriting}
                  title={title}
                  className={`rounded-lg p-2 transition-colors disabled:opacity-30 ${
                    active ? 'bg-white text-amber-800 shadow-sm' : 'text-amber-600 hover:bg-white/70 hover:text-amber-800'
                  }`}
                >
                  {icon}
                </button>
              ))}
              <div className="mx-1 h-4 w-px bg-amber-300" />
              <button
                type="button"
                onClick={() => editor?.commands.undo()}
                disabled={!editor?.can().undo()}
                title="復原"
                className="rounded-lg p-2 text-amber-600 transition-colors hover:bg-white/70 hover:text-amber-800 disabled:opacity-30"
              >
                <Undo2 className="h-4 w-4" />
              </button>

              {/* AI 改寫按鈕：有選取時才顯示 */}
              {hasSelection && !isStreaming && (
                <>
                  <div className="mx-1 h-4 w-px bg-amber-300" />
                  {[
                    { label: '重寫', instruction: '重新改寫這段，保持語意但換一種表達方式' },
                    { label: '縮短', instruction: '將這段縮短，保留核心意思' },
                    { label: '正式化', instruction: '將這段改為更正式的語氣' },
                    { label: '友善化', instruction: '將這段改為更親切友善的語氣' },
                  ].map(({ label, instruction }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => handleRewrite(instruction)}
                      disabled={isRewriting}
                      className="rounded-lg px-2.5 py-1 text-sm font-medium text-amber-700 transition-colors hover:bg-white/70 hover:text-amber-900 disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                  <div className="mx-1 h-4 w-px bg-amber-300" />
                  {showRewriteInput ? (
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (rewriteInput.trim()) handleRewrite(rewriteInput.trim())
                      }}
                    >
                      <input
                        autoFocus
                        type="text"
                        value={rewriteInput}
                        onChange={(e) => setRewriteInput(e.target.value)}
                        placeholder="輸入改寫指令…"
                        className="w-40 rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm focus:border-amber-500 focus:outline-none"
                      />
                      <button
                        type="submit"
                        disabled={!rewriteInput.trim() || isRewriting}
                        className="rounded-lg px-2 py-1 text-sm font-medium text-amber-700 hover:bg-white/70 disabled:opacity-40"
                      >
                        送出
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowRewriteInput(false); setRewriteInput('') }}
                        className="rounded-lg px-1.5 py-1 text-sm text-amber-500 hover:bg-white/70"
                      >
                        ✕
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowRewriteInput(true)}
                      className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-sm font-medium text-amber-700 transition-colors hover:bg-white/70"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      自訂
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* TipTap 編輯器區域 */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasContent && !isStreaming ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-400">
                <FileText className="h-16 w-16 opacity-30" />
                <p className="text-base">填寫左側表單，AI 將幫你生成草稿</p>
              </div>
            ) : (
              <EditorContent editor={editor} className="h-full" />
            )}
          </div>

          {/* 底部 Meta 資訊列 */}
          {lastMeta && (
            <div className="shrink-0 border-t border-amber-200 bg-gradient-to-b from-amber-100 to-amber-50 px-4 py-1.5 text-xs text-amber-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.8),inset_0_-1px_0_rgba(0,0,0,0.06)]">
              <span className="font-medium text-gray-500">{lastMeta.model}</span>
              {lastMeta.usage && (
                <span>
                  {' '}· prompt: {lastMeta.usage.prompt_tokens} · completion: {lastMeta.usage.completion_tokens} · total: {lastMeta.usage.total_tokens}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
