/** agent_id 含 quotation 時使用：報價型 agent 專用 UI（流程型態，多步驟） */
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, FileDown, Loader2, MoreVertical, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import html2pdf from 'html2pdf.js'
import AgentChat, { type Message, type ResponseMeta } from '@/components/AgentChat'
import LLMModelSelect from '@/components/LLMModelSelect'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import QtnOfferingList from '@/components/QtnOfferingList'
import QtnRequirementList from '@/components/QtnRequirementList'
import QuotationStepper from '@/components/QuotationStepper'
import { Group, Panel, PanelImperativeHandle, Separator } from 'react-resizable-panels'
import { chatCompletions } from '@/api/chat'
import { listCompanies } from '@/api/companies'
import { createQtnProject, deleteQtnProject, getNextQuotationNo, listQtnProjects, updateQtnDraft, updateQtnFinal, updateQtnProject, updateQtnStatus, type QtnProjectItem } from '@/api/qtnProjects'
import { ApiError } from '@/api/client'
import type { Agent, Company } from '@/types'

interface AgentQuotationUIProps {
  agent: Agent
}

function ResizeHandle({ className = '' }: { className?: string }) {
  return (
    <Separator
      className={`flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 ${className}`}
    >
      <div
        className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80"
        aria-hidden
      />
    </Separator>
  )
}

/** Step 1 解析結果的單一項目（動態結構，依 LLM 輸出而定） */
type ParsedItem = Record<string, unknown>

const ARRAY_KEYS = ['items', 'data', 'result', 'requirements', 'list']

/** 其他建議選項欄位：grid 顯示 "..."，點擊後以 modal 顯示完整內容 */
const OTHER_SUGGESTIONS_FIELD = 'alternative_candidates'

/** 固定 schema：依 system_prompt_quotation_1_parse.md */
export interface QuotationItem {
  name: string
  qty: number
  unit: string
  unit_price: number
  subtotal: number
  notes: string
}

export interface QuotationDraft {
  items: QuotationItem[]
  tax_rate?: number
  total_amount?: number
  currency?: string
  status?: string
  quotation_no?: string
  quotation_date?: string
  valid_until?: string
  customer_name?: string
  contact_person?: string
  buyer_tax_id?: string
  buyer_address?: string
  buyer_phone?: string
  remarks?: string
  terms?: string
  /** 賣方 */
  seller_company_name?: string
  seller_tax_id?: string
  seller_logo_url?: string
  seller_address?: string
  seller_phone?: string
  seller_email?: string
  seller_contact_person?: string
}

const EMPTY_QUOTATION_ITEM: QuotationItem = {
  name: '',
  qty: 1,
  unit: '',
  unit_price: 0,
  subtotal: 0,
  notes: '',
}

const QUOTATION_ITEM_FIELDS: (keyof QuotationItem)[] = ['name', 'qty', 'unit', 'unit_price', 'subtotal', 'notes']

const FIELD_LABELS: Record<keyof QuotationItem, string> = {
  name: '品項名稱',
  qty: '數量',
  unit: '單位',
  unit_price: '單價',
  subtotal: '小計',
  notes: '備註',
}

/** 數字欄位：右靠對齊 */
const NUMERIC_FIELDS = new Set<keyof QuotationItem>(['qty', 'unit_price', 'subtotal'])

const DRAFT_FIELD_LABELS: Record<string, string> = {
  tax_rate: '稅率',
  currency: '幣別',
  status: '狀態',
  quotation_no: '報價單號',
  quotation_date: '報價日期',
  valid_until: '有效期限',
  customer_name: '客戶名稱',
  contact_person: '聯絡人',
  buyer_tax_id: '統一編號',
  buyer_address: '地址',
  buyer_phone: '電話',
  remarks: '備註',
  terms: '條款說明',
  seller_company_name: '公司全名',
  seller_tax_id: '統一編號',
  seller_logo_url: '公司 Logo',
  seller_address: '公司登記/聯絡地址',
  seller_phone: '公司代表號',
  seller_email: 'Email',
  seller_contact_person: '聯絡人',
}

/** 表格上方顯示的頂層欄位（不含 total_amount） */
const DRAFT_HEADER_KEYS = ['tax_rate', 'currency', 'status'] as const

/** 賣方資訊欄位 */
const SELLER_FIELDS = [
  { key: 'seller_contact_person', label: '聯絡人', type: 'text' as const },
  { key: 'seller_company_name', label: '公司全名', type: 'text' as const },
  { key: 'seller_tax_id', label: '統一編號', type: 'text' as const },
  { key: 'seller_address', label: '地址', type: 'text' as const },
  { key: 'seller_phone', label: '電話', type: 'text' as const },
  { key: 'seller_logo_url', label: '公司 Logo', type: 'text' as const },
  { key: 'quotation_no', label: '報價單號', type: 'text' as const },
  { key: 'quotation_date', label: '報價日期', type: 'date' as const },
  { key: 'valid_until', label: '有效期限', type: 'date' as const },
  { key: 'currency', label: '幣別', type: 'text' as const },
  { key: 'tax_rate', label: '稅率', type: 'number' as const },
] as const

/** 買方資訊欄位 */
const BUYER_FIELDS = [
  { key: 'contact_person', label: '聯絡人', type: 'text' as const },
  { key: 'customer_name', label: '公司全名', type: 'text' as const },
  { key: 'buyer_tax_id', label: '統一編號', type: 'text' as const },
  { key: 'buyer_address', label: '地址', type: 'text' as const },
  { key: 'buyer_phone', label: '電話', type: 'text' as const },
] as const

/** 將任意物件正規化為 QuotationItem */
function toQuotationItem(row: unknown): QuotationItem {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? v : Number(v) || 0)
  const str = (v: unknown) => (v != null ? String(v) : '')
  return {
    name: str(r.name ?? r.品項名稱 ?? r.項目名稱),
    qty: num(r.qty ?? r.quantity ?? r.數量),
    unit: str(r.unit ?? r.單位),
    unit_price: num(r.unit_price ?? r.單價),
    subtotal: num(r.subtotal ?? r.小計),
    notes: str(r.notes ?? r.備註),
  }
}

/** 計算 subtotal = unit_price × qty */
function computeSubtotal(item: QuotationItem): QuotationItem {
  const subtotal = Math.round(item.unit_price * item.qty * 100) / 100
  return { ...item, subtotal }
}

/** 解析 chatbot 回傳：JSON { text, data } 格式 */
function parseChatResponse(content: string): { text: string; data: Record<string, unknown> | null } {
  if (!content?.trim()) return { text: content || '', data: null }
  let raw = content.trim()
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()
  const jsonMatch = raw.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const text = typeof parsed.text === 'string' ? parsed.text : ''
        const data =
          parsed.data != null && typeof parsed.data === 'object' && !Array.isArray(parsed.data)
            ? (parsed.data as Record<string, unknown>)
            : Array.isArray(parsed.data)
              ? { items: parsed.data }
              : null
        return { text, data }
      }
    } catch {
      /* ignore */
    }
  }
  return { text: content.trim(), data: null }
}

/** 解析發送跟進建議回傳：JSON { email, messaging, phone } 格式 */
function parseShareResponse(content: string): { email: string; messaging: string; phone: string } | null {
  if (!content?.trim()) return null
  let raw = content.trim()
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) raw = codeBlock[1].trim()
  const jsonMatch = raw.match(/(\{[\s\S]*\})/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const email = typeof parsed.email === 'string' ? parsed.email : ''
        const messaging = typeof parsed.messaging === 'string' ? parsed.messaging : ''
        const phone = typeof parsed.phone === 'string' ? parsed.phone : ''
        return { email, messaging, phone }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

/** 變更此版本會使舊的 localStorage 資料失效，從頭開始 */
const STORAGE_VERSION = 2

const STORAGE_KEY_PREFIX = `quotation_parse_v${STORAGE_VERSION}_`
const STEP_STORAGE_KEY_PREFIX = `quotation_step_v${STORAGE_VERSION}_`
const PROJECT_STORAGE_KEY_PREFIX = `quotation_project_v${STORAGE_VERSION}_`
const SHARE_STORAGE_KEY_PREFIX = `quotation_share_v${STORAGE_VERSION}_`

function getStorageKey(agentId: string, projectId?: string) {
  return projectId ? `${STORAGE_KEY_PREFIX}${agentId}:${projectId}` : `${STORAGE_KEY_PREFIX}${agentId}`
}

function getStepStorageKey(agentId: string) {
  return `${STEP_STORAGE_KEY_PREFIX}${agentId}`
}

function getProjectStorageKey(agentId: string) {
  return `${PROJECT_STORAGE_KEY_PREFIX}${agentId}`
}

function getShareStorageKey(agentId: string, projectId: string) {
  return `${SHARE_STORAGE_KEY_PREFIX}${agentId}:${projectId}`
}

interface StoredResult {
  parseResult: ParsedItem[] | null
  schema: Record<string, string> | null
  rawContent: string
}

/** 從所有列合併出欄位（以第一列順序為主，其餘列多出的 key 補在後面） */
function getAllKeys(rows: ParsedItem[]): string[] {
  if (rows.length === 0) return []
  const firstKeys = Object.keys(rows[0])
  const otherKeys = new Set<string>()
  for (let i = 1; i < rows.length; i++) {
    Object.keys(rows[i]).forEach((k) => otherKeys.add(k))
  }
  const result = [...firstKeys]
  otherKeys.forEach((k) => {
    if (!result.includes(k)) result.push(k)
  })
  return result
}

/** 將 cell 值轉為顯示字串 */
function formatCellValue(val: unknown): string {
  if (val === undefined || val === null) return '-'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'boolean') return val ? '是' : '否'
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

/** 金額顯示：加上千位符號（僅用於顯示，不影響儲存） */
function formatNumberDisplay(val: unknown): string {
  if (val === undefined || val === null) return '-'
  const n = typeof val === 'number' ? val : Number(val)
  if (Number.isNaN(n)) return '-'
  return n.toLocaleString('zh-TW', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Step 3 / Step 4 共用的正式報價單預覽內容 */
function QuotationPreviewContent({
  draft,
  innerRef,
}: {
  draft: QuotationDraft
  innerRef?: React.Ref<HTMLDivElement>
}) {
  const items = draft.items ?? []
  const totalSubtotal = items.reduce((sum, r) => sum + (r.subtotal ?? 0), 0)
  const taxRate = draft.tax_rate ?? 0
  const taxAmount = Math.round(totalSubtotal * taxRate * 100) / 100
  const totalAmount = totalSubtotal + taxAmount
  const v = (k: keyof QuotationDraft) => formatCellValue(draft[k])
  return (
    <div
      ref={innerRef}
      className="mx-auto max-w-3xl rounded-lg border border-gray-200 bg-white p-8 shadow-sm print:shadow-none"
    >
      <div className="relative mb-6 flex w-full items-center justify-center">
        {draft.seller_logo_url && (
          <img
            src={draft.seller_logo_url}
            alt=""
            className="absolute right-0 top-1/2 h-10 w-auto -translate-y-1/2 object-contain"
          />
        )}
        <h1 className="text-3xl font-normal text-teal-700">報價單</h1>
      </div>
      <div className="mb-6">
        <div className="mb-4 flex flex-col gap-2 text-base font-normal text-gray-800">
          <div className="flex items-baseline gap-2">
            <span className="shrink-0">報價單號：</span>
            <span className="min-w-[8rem]">{v('quotation_no')}</span>
          </div>
          <div className="flex flex-nowrap items-baseline gap-x-4">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0">報價日期：</span>
              <span className="min-w-[8rem]">{v('quotation_date')}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0">有效期限：</span>
              <span className="min-w-[8rem]">{v('valid_until')}</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="shrink-0">幣別：</span>
              <span className="min-w-[6rem]">{v('currency') || '—'}</span>
            </div>
          </div>
        </div>
        <div className="mb-4 border-b border-gray-200" />
        <div className="grid grid-cols-2 gap-6 text-base font-normal text-gray-800">
          <div className="space-y-1">
            <p>聯絡人：{v('seller_contact_person')}</p>
            <p>{v('seller_company_name')}</p>
            <p>統一編號：{v('seller_tax_id')}</p>
            <p>地址：{v('seller_address')}</p>
            <p>電話：{v('seller_phone')}</p>
          </div>
          <div className="space-y-1">
            <p>聯絡人：{v('contact_person')}</p>
            <p>{v('customer_name')}</p>
            <p>統一編號：{v('buyer_tax_id')}</p>
            <p>地址：{v('buyer_address')}</p>
            <p>電話：{v('buyer_phone')}</p>
          </div>
        </div>
      </div>
      <div className="mb-4 overflow-hidden rounded border border-gray-200">
        <table className="w-full text-base font-normal">
          <thead>
            <tr className="bg-teal-600 text-white">
              <th className="px-3 py-2 text-right font-normal">數量</th>
              <th className="px-3 py-2 text-left font-normal">品項描述</th>
              <th className="px-3 py-2 text-right font-normal">單價</th>
              <th className="px-3 py-2 text-right font-normal">小計</th>
            </tr>
          </thead>
          <tbody>
                                {items.length > 0 ? (
                                  items.map((row, i) => (
                                    <tr key={i} className="border-t border-gray-200">
                                      <td className="px-3 py-2 text-right">{formatCellValue(row.qty)}</td>
                                      <td className="px-3 py-2">{formatCellValue(row.name)}</td>
                                      <td className="px-3 py-2 text-right">{formatNumberDisplay(row.unit_price)}</td>
                                      <td className="px-3 py-2 text-right">{formatNumberDisplay(row.subtotal)}</td>
                                    </tr>
                                  ))
            ) : (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="px-3 py-2 text-right"></td>
                  <td className="px-3 py-2"></td>
                  <td className="px-3 py-2 text-right"></td>
                  <td className="px-3 py-2 text-right"></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="mb-6 flex justify-end">
                          <div className="w-64 rounded border border-gray-200">
                            <div className="flex justify-between border-b border-gray-200 px-3 py-2 text-base font-normal">
                              <span className="text-gray-600">小計</span>
                              <span>{formatNumberDisplay(totalSubtotal)}</span>
                            </div>
                            <div className="flex justify-between border-b border-gray-200 px-3 py-2 text-base font-normal">
                              <span className="text-gray-600">稅率 {formatCellValue(taxRate)}</span>
                              <span>{formatNumberDisplay(taxAmount)}</span>
                            </div>
                            <div className="flex justify-between bg-teal-600 px-3 py-2 text-base font-normal text-white">
                              <span>總金額</span>
                              <span>{formatNumberDisplay(totalAmount)}</span>
                            </div>
                          </div>
      </div>
      {v('terms') && (
        <div className="mb-4 text-base font-normal text-gray-800">
          <p className="mb-1 font-medium text-gray-700">條款說明：</p>
          <p className="whitespace-pre-wrap">{v('terms')}</p>
        </div>
      )}
      {draft.remarks && String(draft.remarks).trim() && (
        <div className="mb-4 text-base font-normal text-gray-800">
          <p>備註：{v('remarks')}</p>
        </div>
      )}
      <p className="text-center text-base font-normal text-teal-700">感謝您的惠顧</p>
    </div>
  )
}

/** 將 alternative_candidates 單一項目轉為可讀文字 */
function formatAlternativeAsText(alt: Record<string, unknown>): string {
  const name = alt.catalog_item_name != null ? String(alt.catalog_item_name) : ''
  const id = alt.catalog_item_id != null ? String(alt.catalog_item_id) : ''
  const price = alt.unit_price != null ? Number(alt.unit_price) : 0
  const unit = alt.unit != null ? String(alt.unit) : ''
  const parts: string[] = []
  if (name) parts.push(name)
  if (id) parts.push(`ID: ${id}`)
  parts.push(`單價: ${price}`)
  if (unit) parts.push(`單位: ${unit}`)
  return parts.join('、')
}

type StepNum = 1 | 2 | 3 | 4

export default function AgentQuotationUI({ agent }: AgentQuotationUIProps) {
  const [currentStep, setCurrentStep] = useState<StepNum>(1)
  const [parseResult, setParseResult] = useState<ParsedItem[] | null>(null)
  const [schema, setSchema] = useState<Record<string, string> | null>(null)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ row: number; field: string } | null>(null)
  const [previewRowModal, setPreviewRowModal] = useState<
    { mode: 'add' | 'edit'; rowIndex?: number; formData: QuotationItem } | null
  >(null)
  const [otherSuggestionsModal, setOtherSuggestionsModal] = useState<{
    rowIndex: number
    items: Record<string, unknown>[]
  } | null>(null)

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDesc, setNewProjectDesc] = useState('')
  const [newProjectSubmitting, setNewProjectSubmitting] = useState(false)
  const [newProjectError, setNewProjectError] = useState<string | null>(null)

  const [projects, setProjects] = useState<QtnProjectItem[]>([])
  const [projectsLoading, setProjectsLoading] = useState(true)
  const [selectedProject, setSelectedProject] = useState<QtnProjectItem | null>(null)
  const [projectPanelCollapsed, setProjectPanelCollapsed] = useState(false)
  const [projectMenuOpen, setProjectMenuOpen] = useState<string | null>(null)
  const [clearProjectConfirm, setClearProjectConfirm] = useState<string | null>(null)
  const [clearProjectLoading, setClearProjectLoading] = useState(false)
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState<string | null>(null)
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false)
  const [editProject, setEditProject] = useState<QtnProjectItem | null>(null)
  const [editProjectName, setEditProjectName] = useState('')
  const [editProjectDesc, setEditProjectDesc] = useState('')
  const [editProjectSubmitting, setEditProjectSubmitting] = useState(false)
  const [editProjectError, setEditProjectError] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<Message[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [chatPreviewData, setChatPreviewData] = useState<Record<string, unknown> | null>(null)
  const [chatClearConfirmOpen, setChatClearConfirmOpen] = useState(false)
  const [deleteRowConfirm, setDeleteRowConfirm] = useState<{ source: 'preview' | 'parse'; rowIndex: number } | null>(null)
  const [model, setModel] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [companiesLoading, setCompaniesLoading] = useState(false)
  const [pdfExporting, setPdfExporting] = useState(false)
  const [shareLoading, setShareLoading] = useState(false)
  const [shareSuggestions, setShareSuggestions] = useState<{
    email: string
    messaging: string
    phone: string
  } | null>(null)
  const [shareError, setShareError] = useState<string | null>(null)
  const [step3ValidationError, setStep3ValidationError] = useState<string | null>(null)
  const [step3FormSeed, setStep3FormSeed] = useState(0)
  const quotationPdfRef = useRef<HTMLDivElement>(null)
  const leftPanelRef = useRef<PanelImperativeHandle>(null)
  /** Step 2 grid 單一資料來源：編輯時直接更新此 state，完成時直接使用 */
  const [step2Draft, setStep2Draft] = useState<QuotationDraft | null>(null)

  useEffect(() => {
    if (!projectMenuOpen) return
    const close = () => setProjectMenuOpen(null)
    const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', close)
    }
  }, [projectMenuOpen])

  useEffect(() => {
    const pid = selectedProject?.project_id
    if (!pid) {
      setParseResult(null)
      setSchema(null)
      setRawContent(null)
      setChatPreviewData(null)
      setStep2Draft(null)
      return
    }
    setChatPreviewData(null)
    setStep2Draft(null)
    try {
      const key = getStorageKey(agent.id, pid)
      const raw = localStorage.getItem(key)
      if (raw) {
        const stored: StoredResult = JSON.parse(raw)
        setParseResult(stored.parseResult)
        setSchema(stored.schema ?? null)
        setRawContent(stored.rawContent ?? '')
      } else {
        setParseResult(null)
        setSchema(null)
        setRawContent(null)
      }
    } catch {
      setParseResult(null)
      setSchema(null)
      setRawContent(null)
    }
  }, [agent.id, selectedProject?.project_id])

  /** 從 localStorage 載入發送跟進建議（依專案） */
  useEffect(() => {
    const pid = selectedProject?.project_id
    if (!pid) {
      setShareSuggestions(null)
      setShareError(null)
      return
    }
    try {
      const key = getShareStorageKey(agent.id, pid)
      const raw = localStorage.getItem(key)
      if (raw) {
        const stored = JSON.parse(raw) as { email: string; messaging: string; phone: string }
        if (stored && typeof stored.email === 'string' && typeof stored.messaging === 'string' && typeof stored.phone === 'string') {
          setShareSuggestions(stored)
        } else {
          setShareSuggestions(null)
        }
      } else {
        setShareSuggestions(null)
      }
      setShareError(null)
    } catch {
      setShareSuggestions(null)
    }
  }, [agent.id, selectedProject?.project_id])

  /** 依 selectedProject.status 判斷 currentStep（STEP1→1, STEP2→2, STEP3→3, STEP4→4） */
  useEffect(() => {
    const status = selectedProject?.status
    const stepMap: Record<string, StepNum> = { STEP1: 1, STEP2: 2, STEP3: 3, STEP4: 4 }
    const mapped = status ? stepMap[status] : undefined
    const step: StepNum = (mapped === 1 || mapped === 2 || mapped === 3 || mapped === 4) ? mapped : 1
    setCurrentStep(step)
  }, [selectedProject?.project_id, selectedProject?.status])

  useEffect(() => {
    if (currentStep === 3) {
      setCompaniesLoading(true)
      listCompanies()
        .then(setCompanies)
        .catch(() => setCompanies([]))
        .finally(() => setCompaniesLoading(false))
    } else {
      setStep3ValidationError(null)
      setStep3FormSeed(0)
    }
  }, [currentStep])

  /** Step 2：進入時從 qtn_draft 初始化 grid 資料來源 */
  useEffect(() => {
    if (currentStep !== 2 || !selectedProject?.qtn_draft) return
    const raw = selectedProject.qtn_draft as Record<string, unknown>
    const arr = Array.isArray(raw.items) ? raw.items : []
    setStep2Draft({ ...raw, items: arr.map(toQuotationItem) } as QuotationDraft)
  }, [currentStep, selectedProject?.project_id, selectedProject?.qtn_draft])

  useEffect(() => {
    setProjectsLoading(true)
    listQtnProjects(agent.id)
      .then((list) => {
        setProjects(list)
        setSelectedProject((prev) => {
          if (list.length === 0) return null
          try {
            const saved = localStorage.getItem(getProjectStorageKey(agent.id))
            if (saved) {
              const found = list.find((p) => p.project_id === saved)
              if (found) return found
            }
          } catch {
            // 忽略
          }
          if (prev && list.some((p) => p.project_id === prev.project_id)) return prev
          return list[0]
        })
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false))
  }, [agent.id])

  const persistStep = (step: StepNum) => {
    try {
      localStorage.setItem(getStepStorageKey(agent.id), String(step))
    } catch {
      // 忽略
    }
  }

  /** 清空專案：保留 Step 1（parseResult、schema、rawContent），清空 Step 2–4（qtn_draft、qtn_final、status、發送建議） */
  async function handleClearProject(projectId: string) {
    setClearProjectLoading(true)
    try {
      await updateQtnDraft(agent.id, projectId, null)
      await updateQtnFinal(agent.id, projectId, null)
      await updateQtnStatus(agent.id, projectId, 'STEP1')
      try {
        localStorage.removeItem(getShareStorageKey(agent.id, projectId))
      } catch {
        // 忽略
      }
      setProjects((prev) =>
        prev.map((p) => (p.project_id === projectId ? { ...p, qtn_draft: null, qtn_final: null, status: 'STEP1' } : p))
      )
      if (selectedProject?.project_id === projectId) {
        setSelectedProject((prev) => (prev?.project_id === projectId ? { ...prev, qtn_draft: null, qtn_final: null, status: 'STEP1' } : prev))
        setShareSuggestions(null)
        persistStep(1)
      }
    } catch {
      // 忽略錯誤，可考慮加 toast
    } finally {
      setClearProjectLoading(false)
      setClearProjectConfirm(null)
      setProjectMenuOpen(null)
    }
  }

  /** 刪除專案：DB 刪除 qtn_project（qtn_sources CASCADE）、localStorage 移除、state 更新 */
  async function handleDeleteProject(projectId: string) {
    setDeleteProjectLoading(true)
    try {
      await deleteQtnProject(agent.id, projectId)
      try {
        localStorage.removeItem(getStorageKey(agent.id, projectId))
        localStorage.removeItem(getShareStorageKey(agent.id, projectId))
      } catch {
        // 忽略
      }
      const wasSelected = selectedProject?.project_id === projectId
      if (wasSelected) {
        try {
          localStorage.removeItem(getProjectStorageKey(agent.id))
        } catch {
          // 忽略
        }
        setSelectedProject(null)
        setParseResult(null)
        setSchema(null)
        setRawContent(null)
        setChatMessages([])
        setChatPreviewData(null)
        setShareSuggestions(null)
      }
      setProjects((prev) => prev.filter((p) => p.project_id !== projectId))
    } catch {
      // 忽略錯誤，可考慮加 toast
    } finally {
      setDeleteProjectLoading(false)
      setDeleteProjectConfirm(null)
      setProjectMenuOpen(null)
    }
  }

  const step2PreviewData = selectedProject?.qtn_draft ?? null
  const step3FinalData = selectedProject?.qtn_final ?? null
  const status = selectedProject?.status
  /** 依 qtn_project.status 判斷 completed steps：STEP1→無, STEP2→[1], STEP3→[1,2], STEP4→[1,2,3,4] */
  const completedSteps: number[] = []
  if (status === 'STEP2' || status === 'STEP3' || status === 'STEP4') completedSteps.push(1)
  if (status === 'STEP3' || status === 'STEP4') completedSteps.push(2)
  if (status === 'STEP4') completedSteps.push(3)
  if (status === 'STEP4') completedSteps.push(4)

  const saveToStorage = (
    result: ParsedItem[] | null,
    content: string,
    schemaVal?: Record<string, string> | null
  ) => {
    const pid = selectedProject?.project_id
    if (!pid) return
    try {
      localStorage.setItem(
        getStorageKey(agent.id, pid),
        JSON.stringify({
          parseResult: result,
          schema: schemaVal ?? schema,
          rawContent: content,
        } satisfies StoredResult)
      )
    } catch {
      // 忽略 localStorage 寫入錯誤
    }
  }

  const updateField = (rowIndex: number, field: string, value: string | number) => {
    if (!parseResult) return
    const currentVal = parseResult[rowIndex]?.[field]
    const isNumeric = typeof currentVal === 'number'
    const parsed = isNumeric ? (typeof value === 'number' ? value : Number(value) || 0) : value
    const next = parseResult.map((row, i) =>
      i === rowIndex ? { ...row, [field]: parsed } : row
    )
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
  }

  const handleAddRow = () => {
    const newItem: ParsedItem = {}
    const next = parseResult ? [...parseResult, newItem] : [newItem]
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (!parseResult) return
    const next = parseResult.filter((_, i) => i !== rowIndex)
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setEditingCell(null)
    setDeleteRowConfirm(null)
  }

  function rawToDraft(raw: Record<string, unknown> | null): QuotationDraft | null {
    if (!raw || typeof raw !== 'object') return null
    const arr = Array.isArray(raw.items) ? raw.items : []
    return { ...raw, items: arr.map(toQuotationItem) } as QuotationDraft
  }

  /** 報價預覽資料來源：Step 1 用 chatPreviewData；Step 2 用 step2Draft（grid 單一來源）；Step 3/4 只讀 qtn_final */
  function getPreviewData(): QuotationDraft | null {
    if (currentStep === 1) return rawToDraft(chatPreviewData as Record<string, unknown> | null)
    if (currentStep === 3 || currentStep === 4) return rawToDraft(step3FinalData as Record<string, unknown> | null)
    return step2Draft ?? rawToDraft(step2PreviewData as Record<string, unknown> | null)
  }

  /** 報價預覽 items（固定 schema） */
  function getPreviewItems(): QuotationItem[] {
    const draft = getPreviewData()
    return draft?.items ?? []
  }

  async function updatePreviewItems(newItems: QuotationItem[]) {
    const draft = getPreviewData()
    const computed = newItems.map(computeSubtotal)
    const next: QuotationDraft = draft ? { ...draft, items: computed } : { items: computed }
    if (currentStep === 3 && selectedProject) {
      const updated = await updateQtnFinal(agent.id, selectedProject.project_id, next as unknown as Record<string, unknown>)
      setProjects((prev) =>
        prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_final: updated.qtn_final } : p))
      )
      setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_final: updated.qtn_final } : prev))
    } else if (currentStep === 2 && selectedProject) {
      setStep2Draft(next)
      const updated = await updateQtnDraft(agent.id, selectedProject.project_id, next as unknown as Record<string, unknown>)
      setProjects((prev) =>
        prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_draft: updated.qtn_draft, status: updated.status } : p))
      )
      setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_draft: updated.qtn_draft, status: updated.status } : prev))
    } else {
      setChatPreviewData(next as unknown as Record<string, unknown>)
    }
  }

  /** Step 3：報價單號自動產生（進入時若為空則取得 QN{year}-{seq}） */
  const step3QuotationNoSetRef = useRef(false)
  useEffect(() => {
    if (currentStep !== 3 || !selectedProject) {
      step3QuotationNoSetRef.current = false
      return
    }
    const draft = getPreviewData()
    if (!draft || step3QuotationNoSetRef.current) return
    const qn = draft.quotation_no
    if (qn != null && String(qn).trim() !== '') return
    step3QuotationNoSetRef.current = true
    getNextQuotationNo(agent.id)
      .then((res) => updateDraftHeader({ quotation_no: res.quotation_no }))
      .catch(() => { step3QuotationNoSetRef.current = false })
  }, [currentStep, selectedProject?.project_id, agent.id])

  /** Step 3：報價日期預設今天（進入時若為空則寫入） */
  const step3QuotationDateSetRef = useRef(false)
  useEffect(() => {
    if (currentStep !== 3 || !selectedProject) {
      step3QuotationDateSetRef.current = false
      return
    }
    const draft = getPreviewData()
    if (!draft || step3QuotationDateSetRef.current) return
    const qd = draft.quotation_date
    if (qd != null && String(qd).trim() !== '') return
    step3QuotationDateSetRef.current = true
    const today = new Date().toISOString().slice(0, 10)
    updateDraftHeader({ quotation_date: today })
  }, [currentStep, selectedProject?.project_id])

  /** Step 3 完成前驗證：所有必填欄位與報價項目（seller_logo_url 為 display-only，選填） */
  function validateStep3Draft(draft: QuotationDraft): { valid: boolean; missing: string[] } {
    const missing: string[] = []
    const allFields = [...SELLER_FIELDS, ...BUYER_FIELDS].filter((f) => f.key !== 'seller_logo_url')
    for (const f of allFields) {
      const val = draft[f.key as keyof QuotationDraft]
      if (f.type === 'number') {
        if (val === undefined || val === null || (typeof val === 'number' && Number.isNaN(val)))
          missing.push(DRAFT_FIELD_LABELS[f.key] ?? f.label)
      } else {
        const s = val != null ? String(val).trim() : ''
        if (!s) missing.push(DRAFT_FIELD_LABELS[f.key] ?? f.label)
      }
    }
    const terms = (draft.terms ?? '').trim()
    if (!terms) missing.push('條款說明')
    const items = draft.items ?? []
    if (items.length === 0) missing.push('報價項目（至少一筆）')
    return { valid: missing.length === 0, missing }
  }

  const updateDraftHeader = async (updates: Partial<QuotationDraft>) => {
    const draft = getPreviewData()
    if (!draft) return
    const next = { ...draft, ...updates } as QuotationDraft
    if (currentStep === 3 && selectedProject) {
      const updated = await updateQtnFinal(agent.id, selectedProject.project_id, next as unknown as Record<string, unknown>)
      setProjects((prev) =>
        prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_final: updated.qtn_final } : p))
      )
      setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_final: updated.qtn_final } : prev))
    } else if (currentStep === 2 && selectedProject) {
      setStep2Draft(next)
      const updated = await updateQtnDraft(agent.id, selectedProject.project_id, next as unknown as Record<string, unknown>)
      setProjects((prev) =>
        prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_draft: updated.qtn_draft, status: updated.status } : p))
      )
      setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_draft: updated.qtn_draft, status: updated.status } : prev))
    } else {
      setChatPreviewData(next as unknown as Record<string, unknown>)
    }
  }

  const handleOpenAddPreviewModal = () => {
    setPreviewRowModal({ mode: 'add', formData: { ...EMPTY_QUOTATION_ITEM } })
  }

  const handleOpenEditPreviewModal = (rowIndex: number) => {
    const items = getPreviewItems()
    const row = items[rowIndex]
    if (!row) return
    setPreviewRowModal({ mode: 'edit', rowIndex, formData: { ...row } })
  }

  const handleSavePreviewRow = async () => {
    if (!previewRowModal) return
    const items = getPreviewItems()
    const { mode, rowIndex, formData } = previewRowModal
    const item: QuotationItem = {
      name: String(formData.name ?? '').trim(),
      qty: Number(formData.qty) || 0,
      unit: String(formData.unit ?? '').trim(),
      unit_price: Number(formData.unit_price) || 0,
      subtotal: 0,
      notes: String(formData.notes ?? '').trim(),
    }
    const withSubtotal = computeSubtotal(item)
    if (mode === 'add') {
      await updatePreviewItems([...items, withSubtotal])
    } else if (rowIndex !== undefined) {
      const next = items.map((r, i) => (i === rowIndex ? withSubtotal : r))
      await updatePreviewItems(next)
    }
    setPreviewRowModal(null)
  }

  const handleDeletePreviewRow = async (rowIndex: number) => {
    const items = getPreviewItems()
    await updatePreviewItems(items.filter((_, i) => i !== rowIndex))
    setPreviewRowModal(null)
    setDeleteRowConfirm(null)
  }

  const handleConfirmDeleteRow = async () => {
    if (!deleteRowConfirm) return
    if (deleteRowConfirm.source === 'preview') {
      await handleDeletePreviewRow(deleteRowConfirm.rowIndex)
    } else {
      handleDeleteRow(deleteRowConfirm.rowIndex)
    }
  }

  /** 從其他建議選項選取後，將該項帶回 grid 對應列 */
  const handleApplyAlternative = (rowIndex: number, alt: Record<string, unknown>) => {
    if (!parseResult) return
    const row = parseResult[rowIndex]
    if (!row) return
    const quantity = typeof row.quantity === 'number' ? row.quantity : 1
    const unitPrice = typeof alt.unit_price === 'number' ? alt.unit_price : 0
    const subtotal = quantity * unitPrice
    const next = parseResult.map((r, i) =>
      i === rowIndex
        ? {
            ...r,
            catalog_item_name: alt.catalog_item_name ?? r.catalog_item_name,
            catalog_item_id: alt.catalog_item_id ?? r.catalog_item_id,
            unit_price: unitPrice,
            unit: alt.unit ?? r.unit,
            subtotal,
          }
        : r
    )
    setParseResult(next)
    saveToStorage(next, rawContent ?? '')
    setOtherSuggestionsModal(null)
  }

  const handleChatSubmit = async (text: string) => {
    if (!text.trim() || chatLoading) return
    if (!selectedProject) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '請先選擇專案後再進行對話。左側報價專案區可選擇或建立專案。' },
      ])
      return
    }
    const userMsg = { role: 'user' as const, content: text }
    const ROUNDS = 5
    const recentMessages = chatMessages.slice(-ROUNDS * 2)
    const messagesForApi = [...recentMessages.map((m) => ({ role: m.role, content: m.content })), userMsg]
    setChatMessages((prev) => [...prev, userMsg])
    setChatLoading(true)
    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        project_id: selectedProject.project_id,
        prompt_type: 'quotation_parse',
        system_prompt: '',
        user_prompt: '',
        data: '',
        model,
        messages: messagesForApi,
        content: text,
      })
      const { text: replyText, data } = parseChatResponse(res.content ?? '')
      const meta: ResponseMeta | undefined =
        res.usage != null
          ? {
              model: res.model,
              usage: res.usage,
              finish_reason: res.finish_reason,
            }
          : undefined
      setChatMessages((prev) => [...prev, { role: 'assistant', content: replyText, meta }])
      if (data) {
        const d = data as Record<string, unknown>
        const arr = ARRAY_KEYS.map((k) => d[k]).find(Array.isArray) as unknown[] | undefined
        const items = (arr ?? []).map(toQuotationItem).map(computeSubtotal)
        const draft: QuotationDraft = {
          items,
          tax_rate: typeof d.tax_rate === 'number' ? d.tax_rate : undefined,
          total_amount: typeof d.total_amount === 'number' ? d.total_amount : undefined,
          currency: typeof d.currency === 'string' ? d.currency : undefined,
          status: typeof d.status === 'string' ? d.status : undefined,
        }
        setChatPreviewData(draft as unknown as Record<string, unknown>)
      }
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '發生錯誤，請稍後再試'
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `錯誤：${msg}` }])
    } finally {
      setChatLoading(false)
    }
  }

  const handleStepClick = (step: number) => {
    if (step >= 1 && step <= 4 && completedSteps.includes(step)) {
      setCurrentStep(step as StepNum)
      persistStep(step as StepNum)
    }
  }

  const handleExportPdf = async () => {
    const el = quotationPdfRef.current
    if (!el || pdfExporting) return
    setPdfExporting(true)
    try {
      const opt = {
        margin: 10,
        filename: `報價單_${getPreviewData()?.quotation_no ?? 'export'}.pdf`,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
      }
      await html2pdf().set(opt).from(el).save()
    } catch {
      // 匯出失敗時可考慮顯示 toast
    } finally {
      setPdfExporting(false)
    }
  }

  const handleGenerateShare = async () => {
    if (!selectedProject || shareLoading) return
    setShareLoading(true)
    setShareSuggestions(null)
    setShareError(null)
    try {
      const res = await chatCompletions({
        agent_id: agent.id,
        project_id: selectedProject.project_id,
        prompt_type: 'quotation_share',
        system_prompt: '',
        user_prompt: '',
        data: '',
        model,
        messages: [],
        content: '請根據上述報價單生成 Email、通訊軟體、電話三種管道的發送跟進建議。',
      })
      const parsed = parseShareResponse(res.content ?? '')
      if (parsed) {
        setShareSuggestions(parsed)
        try {
          localStorage.setItem(getShareStorageKey(agent.id, selectedProject.project_id), JSON.stringify(parsed))
        } catch {
          // 忽略
        }
      } else setShareError('無法解析 LLM 回傳格式')
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '生成失敗，請稍後再試'
      setShareError(msg)
    } finally {
      setShareLoading(false)
    }
  }

  const handleOpenNewProject = () => {
    setNewProjectName('')
    setNewProjectDesc('')
    setNewProjectError(null)
    setNewProjectOpen(true)
  }

  const handleCloseNewProject = () => {
    setNewProjectOpen(false)
    setNewProjectError(null)
  }

  const handleSubmitNewProject = async () => {
    const name = newProjectName.trim()
    if (!name) {
      setNewProjectError('請輸入專案名稱')
      return
    }
    setNewProjectSubmitting(true)
    setNewProjectError(null)
    try {
      const created = await createQtnProject({
        agent_id: agent.id,
        project_name: name,
        project_desc: newProjectDesc.trim() || null,
      })
      setProjects((prev) => [created, ...prev])
      setSelectedProject(created)
      try {
        localStorage.setItem(getProjectStorageKey(agent.id), created.project_id)
      } catch {
        // 忽略
      }
      handleCloseNewProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '建立失敗，請稍後再試'
      setNewProjectError(msg)
    } finally {
      setNewProjectSubmitting(false)
    }
  }

  const handleOpenEditProject = (p: QtnProjectItem) => {
    setEditProject(p)
    setEditProjectName(p.project_name)
    setEditProjectDesc(p.project_desc ?? '')
    setEditProjectError(null)
    setProjectMenuOpen(null)
  }

  const handleCloseEditProject = () => {
    setEditProject(null)
    setEditProjectError(null)
  }

  const handleSubmitEditProject = async () => {
    const name = editProjectName.trim()
    if (!name) {
      setEditProjectError('請輸入專案名稱')
      return
    }
    if (!editProject) return
    setEditProjectSubmitting(true)
    setEditProjectError(null)
    try {
      const updated = await updateQtnProject(agent.id, editProject.project_id, {
        project_name: name,
        project_desc: editProjectDesc.trim() || null,
      })
      setProjects((prev) =>
        prev.map((p) => (p.project_id === editProject.project_id ? { ...p, project_name: updated.project_name, project_desc: updated.project_desc } : p))
      )
      if (selectedProject?.project_id === editProject.project_id) {
        setSelectedProject((prev) => (prev?.project_id === editProject.project_id ? { ...prev, project_name: updated.project_name, project_desc: updated.project_desc } : prev))
      }
      handleCloseEditProject()
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.detail ?? err.message : err instanceof Error ? err.message : '更新失敗，請稍後再試'
      setEditProjectError(msg)
    } finally {
      setEditProjectSubmitting(false)
    }
  }

  return (
    <div className="flex h-full flex-col p-4">
      {/* 其他建議選項 modal */}
      {otherSuggestionsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setOtherSuggestionsModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label="其他建議選項"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 max-h-[80vh] min-w-[320px] max-w-[90vw] overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 bg-amber-50 px-4 py-3">
              <h3 className="text-base font-medium text-gray-800">其他建議選項</h3>
              <button
                type="button"
                onClick={() => setOtherSuggestionsModal(null)}
                className="rounded-2xl px-2 py-1 text-gray-600 hover:bg-gray-200"
              >
                關閉
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              <ul className="space-y-3">
                {otherSuggestionsModal.items.map((alt, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-4 rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-base text-gray-700">
                      {formatAlternativeAsText(alt)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        handleApplyAlternative(otherSuggestionsModal.rowIndex, alt)
                      }
                      className="shrink-0 rounded-2xl bg-gray-700 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800"
                    >
                      選取
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 報價預覽：新增/編輯列 modal（動態欄位） */}
      {previewRowModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setPreviewRowModal(null)}
          role="dialog"
          aria-modal="true"
          aria-label={previewRowModal.mode === 'add' ? '新增報價項目' : '編輯報價項目'}
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
              <h3 className="text-lg font-semibold text-gray-800">
                {previewRowModal.mode === 'add' ? '新增報價項目' : '編輯報價項目'}
              </h3>
              <button
                type="button"
                onClick={() => setPreviewRowModal(null)}
                className="rounded-2xl p-2 text-gray-500 hover:bg-gray-100"
                aria-label="關閉"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {QUOTATION_ITEM_FIELDS.filter((f) => f !== 'subtotal').map((field) => {
                  const val = previewRowModal.formData[field]
                  const isNum = typeof val === 'number'
                  const displayVal = val === undefined || val === null ? '' : String(val)
                  const label = FIELD_LABELS[field]
                  return (
                    <div key={field} className="flex flex-col gap-1">
                      <label className="text-sm font-medium text-gray-700">{label}</label>
                      <input
                        type={isNum ? 'number' : 'text'}
                        step={isNum ? (field === 'unit_price' ? '0.01' : '1') : undefined}
                        value={displayVal}
                        onChange={(e) => {
                          const v = e.target.value
                          setPreviewRowModal((prev) =>
                            prev ? { ...prev, formData: { ...prev.formData, [field]: isNum ? Number(v) || 0 : v } } : prev
                          )
                        }}
                        className="rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                      />
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setPreviewRowModal(null)}
                className="rounded-2xl border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSavePreviewRow}
                className="rounded-2xl bg-gray-700 px-4 py-2 text-base font-medium text-white hover:bg-gray-800"
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={chatClearConfirmOpen}
        title="清除對話"
        message="確定要清除所有對話嗎？"
        confirmText="清除"
        variant="danger"
        onConfirm={() => {
          setChatClearConfirmOpen(false)
          setChatMessages([])
          setChatPreviewData(null)
        }}
        onCancel={() => setChatClearConfirmOpen(false)}
      />
      <ConfirmModal
        open={deleteRowConfirm !== null}
        title="確認刪除"
        message="確定要刪除此項目嗎？"
        confirmText="刪除"
        variant="danger"
        onConfirm={handleConfirmDeleteRow}
        onCancel={() => setDeleteRowConfirm(null)}
      />
      <ConfirmModal
        open={clearProjectConfirm !== null}
        title="清空專案"
        message="確定要清空此專案嗎？將保留 Step 1 需求解析，清空 Step 2–4 的品項與報價內容。"
        confirmText={clearProjectLoading ? '處理中…' : '清空'}
        variant="danger"
        onConfirm={() => {
          if (!clearProjectLoading && clearProjectConfirm) handleClearProject(clearProjectConfirm)
        }}
        onCancel={() => !clearProjectLoading && setClearProjectConfirm(null)}
      />
      <ConfirmModal
        open={deleteProjectConfirm !== null}
        title="刪除專案"
        message="確定要刪除此專案嗎？專案與相關資料將無法復原。"
        confirmText={deleteProjectLoading ? '處理中…' : '刪除'}
        variant="danger"
        onConfirm={() => {
          if (!deleteProjectLoading && deleteProjectConfirm) handleDeleteProject(deleteProjectConfirm)
        }}
        onCancel={() => !deleteProjectLoading && setDeleteProjectConfirm(null)}
      />
      {step3ValidationError && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setStep3ValidationError(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="step3-validation-title"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 min-w-[320px] max-w-md rounded-2xl border-2 border-amber-200 bg-amber-50 p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="step3-validation-title" className="mb-4 font-semibold text-amber-800">
              請填寫完整
            </h2>
            <p className="mb-6 text-amber-900">{step3ValidationError}</p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setStep3ValidationError(null)}
                className="rounded-2xl bg-amber-600 px-4 py-2 text-white hover:bg-amber-700"
              >
                確定
              </button>
            </div>
          </div>
        </div>
      )}
      <AgentHeader agent={agent} showManagerTools />

      <div className="mt-2 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* 左側：報價專案資訊容器（可折疊） */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            projectPanelCollapsed ? 'w-12' : 'w-64'
          }`}
          style={{ backgroundColor: '#4b5563' }}
        >
          <div
              className={`flex shrink-0 items-center justify-between border-b border-gray-300/50 py-2.5 ${
                projectPanelCollapsed ? 'px-2' : 'pl-6 pr-3'
              }`}
            >
            {projectPanelCollapsed ? (
              <button
                type="button"
                onClick={() => setProjectPanelCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開報價專案"
                aria-label="展開報價專案"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <h3 className="text-base font-medium text-white">專案</h3>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setProjectPanelCollapsed(true)}
                    className="rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                    title="折疊報價專案"
                    aria-label="折疊報價專案"
                  >
                    {'<<'}
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenNewProject}
                    className="flex items-center gap-1 rounded-2xl border border-white/30 bg-white/10 px-2.5 py-1 text-base font-medium text-white transition-colors hover:bg-white/20"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    New
                  </button>
                </div>
              </>
            )}
          </div>
          {!projectPanelCollapsed && (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {projects.length === 0 ? (
                <p className="text-base text-white/70">尚無專案，點擊 +New 建立</p>
              ) : (
                <ul className="space-y-2">
                  {projects.map((p) => (
                    <li
                      key={p.project_id}
                      className={`group relative flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-base transition-colors ${
                        selectedProject?.project_id === p.project_id
                          ? 'bg-white/20 font-medium text-white'
                          : 'text-white/90 hover:bg-white/10'
                      }`}
                      onClick={() => {
                        setSelectedProject(p)
                        try {
                          localStorage.setItem(getProjectStorageKey(agent.id), p.project_id)
                        } catch {
                          // 忽略
                        }
                      }}
                    >
                      <span className="flex shrink-0 items-center gap-0.5" aria-label={`進度 ${p.status ?? 'STEP1'}`}>
                        {(() => {
                          const stepMap: Record<string, number> = { STEP1: 1, STEP2: 2, STEP3: 3, STEP4: 4 }
                          const completedCount = stepMap[p.status ?? 'STEP1'] ?? 1
                          const isAllDone = (p.status ?? 'STEP1') === 'STEP4'
                          return [1, 2, 3, 4].map((i) => (
                            <span
                              key={i}
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                i <= completedCount ? (isAllDone ? 'bg-emerald-400' : 'bg-amber-400') : 'bg-white/30'
                              }`}
                            />
                          ))
                        })()}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{p.project_name}</span>
                      {p.project_name && (
                        <span className="pointer-events-none absolute left-0 right-10 top-full z-[100] mt-1 hidden max-w-full whitespace-normal rounded-md bg-gray-900 px-2 py-1.5 text-xs text-white shadow-lg group-hover:block">
                          {p.project_name}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setProjectMenuOpen((prev) => (prev === p.project_id ? null : p.project_id))
                        }}
                        className="shrink-0 rounded-2xl p-1 text-white/70 hover:bg-white/10 hover:text-white"
                        aria-label="專案選單"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {projectMenuOpen === p.project_id && (
                        <div
                          className="absolute right-0 top-full z-10 mt-1 min-w-[7rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => handleOpenEditProject(p)}
                          >
                            修改
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => {
                              setProjectMenuOpen(null)
                              setDeleteProjectConfirm(p.project_id)
                            }}
                          >
                            刪除
                          </button>
                          <button
                            type="button"
                            className="w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                            onClick={() => {
                              setProjectMenuOpen(null)
                              setClearProjectConfirm(p.project_id)
                            }}
                          >
                            清空
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

        {/* 修改專案 Modal */}
        <InputModal
          open={editProject !== null}
          title="修改專案"
          submitLabel="儲存"
          loading={editProjectSubmitting}
          onSubmit={handleSubmitEditProject}
          onClose={handleCloseEditProject}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案 ID</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-500">
                {editProject?.project_id ?? ''}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
              <input
                type="text"
                value={editProjectName}
                onChange={(e) => setEditProjectName(e.target.value)}
                placeholder="請輸入專案名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
              <textarea
                value={editProjectDesc}
                onChange={(e) => setEditProjectDesc(e.target.value)}
                placeholder="請輸入專案描述（選填）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            {editProjectError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{editProjectError}</div>
            )}
          </div>
        </InputModal>

        {/* 新增專案 Modal */}
        <InputModal
          open={newProjectOpen}
          title="新增報價專案"
          submitLabel="建立"
          loading={newProjectSubmitting}
          onSubmit={handleSubmitNewProject}
          onClose={handleCloseNewProject}
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案 ID</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-base text-gray-500">
                （建立後產生）
              </div>
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">專案名稱</label>
              <input
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="請輸入專案名稱"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">描述</label>
              <textarea
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                placeholder="請輸入專案描述（選填）"
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            {newProjectError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{newProjectError}</div>
            )}
          </div>
        </InputModal>

        {/* 右側：Stepper + 內容 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          {/* Stepper + 模型選擇 */}
          <div className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="min-w-0 flex-1">
                <QuotationStepper
                  currentStep={currentStep}
                  completedSteps={completedSteps}
                  onStepClick={handleStepClick}
                />
              </div>
              <div className="h-6 w-px shrink-0 bg-gray-200" aria-hidden />
              <LLMModelSelect
                value={model}
                onChange={setModel}
                selectClassName="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
          </div>

          {/* 內容區：依 currentStep 顯示 */}
          <div className="mt-1 flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            {currentStep === 1 && (
              <Group
                orientation="horizontal"
                className="flex min-h-0 flex-1 gap-1 overflow-hidden rounded-2xl border-2 border-gray-200 bg-gradient-to-b from-stone-300 to-stone-400 p-4 shadow-sm"
              >
                {/* 左：需求描述 + 產品或服務清單 */}
                <Panel
                  panelRef={leftPanelRef}
                  collapsible
                  collapsedSize={48}
                  defaultSize={33}
                  minSize={48}
                  className="flex min-h-0 flex-col overflow-hidden"
                >
                  <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
                    <QtnRequirementList
                      projectId={selectedProject?.project_id ?? null}
                      collapsible={true}
                      onCollapseLeft={() => leftPanelRef.current?.collapse()}
                    />
                    <QtnOfferingList
                      projectId={selectedProject?.project_id ?? null}
                      collapsible={true}
                    />
                  </div>
                </Panel>
                <ResizeHandle />
                {/* 中：Chatbot */}
                <Panel defaultSize={34} minSize={20} className="flex min-h-0 flex-col overflow-hidden">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <AgentChat
                      messages={chatMessages}
                      onSubmit={handleChatSubmit}
                      isLoading={chatLoading}
                      emptyPlaceholder={
                        selectedProject
                          ? '輸入訊息開始對話...（參考左側產品清單與需求描述）'
                          : '請先選擇專案後再進行對話'
                      }
                      headerTitle="對話"
                      headerActions={
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => chatMessages.length > 0 && setChatClearConfirmOpen(true)}
                            disabled={chatLoading || chatMessages.length === 0}
                            className="rounded-2xl border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                            aria-label="清除對話"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </button>
                        </div>
                      }
                    />
                  </div>
                </Panel>
                <ResizeHandle />
                {/* 右：報價單預覽 */}
                <Panel defaultSize={33} minSize={20} className="flex min-h-0 flex-col overflow-hidden">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-yellow-50 px-4 py-3">
                      <h3 className="text-base font-medium text-gray-700">報價單預覽</h3>
                      <button
                        type="button"
                        onClick={async () => {
                          const draft = getPreviewData()
                          if (!draft || !selectedProject) return
                          try {
                            const updated = await updateQtnDraft(agent.id, selectedProject.project_id, draft as unknown as Record<string, unknown>)
                            setProjects((prev) =>
                              prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_draft: updated.qtn_draft, status: updated.status } : p))
                            )
                            setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_draft: updated.qtn_draft, status: updated.status } : prev))
                            setCurrentStep(2)
                            persistStep(2)
                          } catch {
                            // 儲存失敗時仍可進入 step 2（qtn_draft 可能為空，會顯示解析結果或提示回到 Step 1）
                            setCurrentStep(2)
                            persistStep(2)
                          }
                        }}
                        disabled={
                          !getPreviewData() ||
                          !selectedProject ||
                          (status === 'STEP2' || status === 'STEP3' || status === 'STEP4')
                        }
                        className="rounded-2xl bg-gray-700 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-700"
                      >
                        完成
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                      {(() => {
                        const draft = getPreviewData()
                        if (!draft) return <p className="text-base text-gray-500">與 AI 對話後，報價數據將顯示於此</p>
                        const items = draft.items
                        const otherKeys = DRAFT_HEADER_KEYS.filter(
                          (k) => draft[k] !== undefined && draft[k] !== null
                        )
                        return (
                          <div className="space-y-4">
                            {otherKeys.length > 0 && (
                              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-base">
                                  {otherKeys.map((k) => (
                                    <span key={k} className="text-gray-700">
                                      <span className="font-medium text-gray-600">{DRAFT_FIELD_LABELS[k] ?? k}:</span>{' '}
                                      {formatCellValue(draft[k])}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {items.length > 0 ? (
                              <table className="min-w-full text-base">
                                <thead>
                                  <tr className="border-b border-gray-200 text-left text-gray-600">
                                    <th className="whitespace-nowrap px-2 py-1.5">#</th>
                                    {QUOTATION_ITEM_FIELDS.map((f) => (
                                      <th key={f} className={`whitespace-nowrap px-2 py-1.5 ${NUMERIC_FIELDS.has(f) ? 'text-right' : ''}`}>
                                        {FIELD_LABELS[f]}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                    {items.map((row, i) => (
                                      <tr key={i} className="border-b border-gray-100">
                                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{i + 1}</td>
                                        {QUOTATION_ITEM_FIELDS.map((field) => (
                                          <td key={field} className={`px-2 py-1.5 ${NUMERIC_FIELDS.has(field) ? 'text-right' : ''}`}>
                                            {field === 'unit_price' || field === 'subtotal'
                                              ? formatNumberDisplay(row[field])
                                              : formatCellValue(row[field])}
                                          </td>
                                        ))}
                                      </tr>
                                    ))}
                                </tbody>
                              </table>
                            ) : (
                              <pre className="whitespace-pre-wrap break-words text-base text-gray-600">
                                {JSON.stringify(draft, null, 2)}
                              </pre>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                </Panel>
              </Group>
            )}

            {currentStep === 2 && (
              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden rounded-2xl border-2 border-gray-200 bg-gradient-to-b from-stone-200 to-stone-300 shadow-sm">
                {(step2Draft ?? step2PreviewData) ? (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-yellow-50 px-4 py-3">
                      <h3 className="font-medium text-gray-800">報價單預覽</h3>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleOpenAddPreviewModal}
                          className="flex items-center gap-1 rounded-2xl border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          <Plus className="h-4 w-4" />
                          新增
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!selectedProject) return
                            const draft = getPreviewData()
                            try {
                              await updateQtnStatus(agent.id, selectedProject.project_id, 'STEP3')
                              if (draft) {
                                const existing = step3FinalData as Record<string, unknown> | null
                                const merged = {
                                  ...(existing ?? {}),
                                  ...(draft as unknown as Record<string, unknown>),
                                  items: (draft as unknown as Record<string, unknown>).items,
                                }
                                const fin = await updateQtnFinal(agent.id, selectedProject.project_id, merged)
                                setProjects((prev) =>
                                  prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, qtn_final: fin.qtn_final, status: 'STEP3' } : p))
                                )
                                setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, qtn_final: fin.qtn_final, status: 'STEP3' } : prev))
                              } else {
                                setProjects((prev) =>
                                  prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, status: 'STEP3' } : p))
                                )
                                setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, status: 'STEP3' } : prev))
                              }
                              setCurrentStep(3)
                              persistStep(3)
                            } catch {
                              setCurrentStep(3)
                              persistStep(3)
                            }
                          }}
                          disabled={!getPreviewData() || !selectedProject}
                          className="rounded-2xl bg-gray-700 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 disabled:hover:bg-gray-700"
                        >
                          完成
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                      {(() => {
                        const draft = getPreviewData()
                        if (!draft) return null
                        const items = getPreviewItems()
                        const totalSubtotal = items.reduce((sum, r) => sum + r.subtotal, 0)
                        const filteredOtherKeys = DRAFT_HEADER_KEYS.filter(
                          (k) => draft[k] !== undefined && draft[k] !== null
                        )
                        return (
                          <div className="space-y-4">
                            {filteredOtherKeys.length > 0 && (
                              <div className="rounded-lg border border-gray-200 bg-gray-50/80 p-3">
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-base">
                                  {filteredOtherKeys.map((k) => (
                                    <span key={k} className="text-gray-700">
                                      <span className="font-medium text-gray-600">{DRAFT_FIELD_LABELS[k] ?? k}:</span>{' '}
                                      {formatCellValue(draft[k])}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {items.length > 0 ? (
                              <div className="overflow-x-auto">
                                <table className="min-w-full text-base">
                                  <thead>
                                    <tr className="border-b border-gray-200 text-left text-gray-600">
                                      <th className="whitespace-nowrap px-2 py-1.5">#</th>
                                      {QUOTATION_ITEM_FIELDS.map((f) => (
                                        <th key={f} className={`whitespace-nowrap px-2 py-1.5 ${NUMERIC_FIELDS.has(f) ? 'text-right' : ''}`}>
                                          {FIELD_LABELS[f]}
                                        </th>
                                      ))}
                                      <th className="w-24 px-2 py-1.5 text-right"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((row, i) => (
                                      <tr key={i} className="border-b border-gray-100">
                                        <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">{i + 1}</td>
                                        {QUOTATION_ITEM_FIELDS.map((field) => (
                                          <td key={field} className={`max-w-[200px] truncate px-2 py-1.5 ${NUMERIC_FIELDS.has(field) ? 'text-right' : ''}`} title={field === 'unit_price' || field === 'subtotal' ? formatNumberDisplay(row[field]) : formatCellValue(row[field])}>
                                            {field === 'unit_price' || field === 'subtotal'
                                              ? formatNumberDisplay(row[field])
                                              : formatCellValue(row[field])}
                                          </td>
                                        ))}
                                        <td className="px-2 py-1.5 text-right">
                                          <div className="flex justify-end gap-1">
                                            <button
                                              type="button"
                                              onClick={() => handleOpenEditPreviewModal(i)}
                                              className="rounded-2xl p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                              aria-label="編輯"
                                            >
                                              <Pencil className="h-4 w-4" />
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => setDeleteRowConfirm({ source: 'preview', rowIndex: i })}
                                              className="rounded-2xl p-1 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                                              aria-label="刪除"
                                            >
                                              <Trash2 className="h-4 w-4" />
                                            </button>
                                          </div>
                                        </td>
                                      </tr>
                                    ))}
                                    <tr className="border-t-2 border-gray-300 bg-gray-50 font-medium">
                                      <td className="px-2 py-1.5 text-gray-600">合計</td>
                                      {QUOTATION_ITEM_FIELDS.map((field) => (
                                        <td key={field} className={`px-2 py-1.5 ${NUMERIC_FIELDS.has(field) ? 'text-right' : ''}`}>
                                          {field === 'subtotal' ? formatNumberDisplay(totalSubtotal) : ''}
                                        </td>
                                      ))}
                                      <td className="px-2 py-1.5 text-right"></td>
                                    </tr>
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center gap-4">
                                <p className="text-base text-gray-500">尚無報價項目，點擊右上角「新增」新增一筆</p>
                                <button
                                  type="button"
                                  onClick={handleOpenAddPreviewModal}
                                  className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 hover:bg-gray-50"
                                >
                                  <Plus className="h-4 w-4" />
                                  新增
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  </div>
                ) : projectsLoading ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8">
                    <p className="text-gray-600">載入中…</p>
                  </div>
                ) : parseResult === null && rawContent === null ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-8">
                    <p className="text-gray-600">請先完成 Step 1：與 AI 對話取得報價單預覽後，點擊「完成」進入此步驟</p>
                    <button
                      type="button"
                      onClick={() => {
                        setCurrentStep(1)
                        persistStep(1)
                      }}
                      className="rounded-2xl bg-gray-700 px-4 py-2 text-white hover:bg-gray-800"
                    >
                      回到 Step 1
                    </button>
                  </div>
                ) : (
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                    <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
                      <div>
                        <h3 className="font-medium text-gray-800">解析結果：需求清單</h3>
                        <p className="mt-0.5 text-base text-gray-500">請確認或編輯需求項目，至少需有一筆才能進入下一步</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={handleAddRow}
                          className="flex items-center gap-1 rounded-2xl border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          <Plus className="h-4 w-4" />
                          新增
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                      {parseResult !== null ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-base">
                            <thead>
                              <tr className="border-b border-gray-200 text-left text-gray-600">
                                <th className="whitespace-nowrap px-2 py-1.5">#</th>
                                {getAllKeys(parseResult)
                                  .filter((f) => f !== 'id')
                                  .map((field) => {
                                    const firstVal = parseResult[0]?.[field]
                                    const isNumCol = typeof firstVal === 'number'
                                    return (
                                      <th key={field} className={`whitespace-nowrap px-2 py-1.5 ${isNumCol ? 'text-right' : ''}`}>
                                        {schema?.[field] ?? field}
                                      </th>
                                    )
                                  })}
                                <th className="w-10 px-2 py-1.5"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {parseResult.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={
                                      getAllKeys(parseResult).filter((f) => f !== 'id').length + 2
                                    }
                                    className="px-2 py-6 text-center text-gray-500"
                                  >
                                    尚無需求項目，請點擊「新增」或回到 Step 1
                                  </td>
                                </tr>
                              ) : (
                                parseResult.map((row, i) => {
                                  const fields = getAllKeys(parseResult).filter((f) => f !== 'id')
                                  return (
                                    <tr key={i} className="border-b border-gray-100">
                                      <td className="whitespace-nowrap px-2 py-1.5 text-gray-600">
                                        {i + 1}
                                      </td>
                                      {fields.map((field) => {
                                        const isOtherSuggestions = field === OTHER_SUGGESTIONS_FIELD
                                        const isEditing =
                                          !isOtherSuggestions &&
                                          editingCell?.row === i &&
                                          editingCell?.field === field
                                        const val = row[field]
                                        const display = formatCellValue(val)
                                        const isNum = typeof val === 'number'
                                        const hasOtherSuggestions =
                                          isOtherSuggestions &&
                                          val != null &&
                                          (Array.isArray(val) ? val.length > 0 : true)
                                        return (
                                          <td
                                            key={field}
                                            className={`max-w-[200px] px-2 py-1.5 ${isNum ? 'text-right' : ''}`}
                                          >
                                            {isOtherSuggestions ? (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="block min-h-[1.5em] cursor-pointer rounded px-0.5 hover:bg-gray-100"
                                                onClick={() => {
                                                  if (hasOtherSuggestions) {
                                                    const items = Array.isArray(val)
                                                      ? val.filter(
                                                          (x): x is Record<string, unknown> =>
                                                            x != null && typeof x === 'object'
                                                        )
                                                      : []
                                                    setOtherSuggestionsModal({ rowIndex: i, items })
                                                  }
                                                }}
                                                onKeyDown={(e) => {
                                                  if (
                                                    (e.key === 'Enter' || e.key === ' ') &&
                                                    hasOtherSuggestions
                                                  ) {
                                                    e.preventDefault()
                                                    const items = Array.isArray(val)
                                                      ? val.filter(
                                                          (x): x is Record<string, unknown> =>
                                                            x != null && typeof x === 'object'
                                                        )
                                                      : []
                                                    setOtherSuggestionsModal({ rowIndex: i, items })
                                                  }
                                                }}
                                              >
                                                {hasOtherSuggestions ? '...' : '-'}
                                              </span>
                                            ) : isEditing ? (
                                              <input
                                                type={isNum ? 'number' : 'text'}
                                                step={isNum ? (field === 'unit_price' ? '0.01' : '1') : undefined}
                                                defaultValue={display === '-' ? '' : display}
                                                autoFocus
                                                className="min-w-[60px] max-w-full rounded border border-gray-300 px-1.5 py-0.5 text-base"
                                                onBlur={(e) => {
                                                  const v = e.target.value
                                                  updateField(i, field, isNum ? Number(v) : v)
                                                }}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter') {
                                                    const v = e.currentTarget.value
                                                    updateField(i, field, isNum ? Number(v) : v)
                                                  }
                                                  if (e.key === 'Escape') setEditingCell(null)
                                                }}
                                              />
                                            ) : (
                                              <span
                                                role="button"
                                                tabIndex={0}
                                                className="block min-h-[1.5em] cursor-pointer truncate rounded px-0.5 hover:bg-gray-100"
                                                title={display}
                                                onClick={() => setEditingCell({ row: i, field })}
                                                onKeyDown={(e) => {
                                                  if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault()
                                                    setEditingCell({ row: i, field })
                                                  }
                                                }}
                                              >
                                                {display}
                                              </span>
                                            )}
                                          </td>
                                        )
                                      })}
                                      <td className="w-10 px-2 py-1.5">
                                        <button
                                          type="button"
                                          onClick={() => setDeleteRowConfirm({ source: 'parse', rowIndex: i })}
                                          className="rounded-2xl p-1 text-gray-500 transition-colors hover:bg-red-50 hover:text-red-600"
                                          aria-label="刪除此列"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </td>
                                    </tr>
                                  )
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words text-base text-gray-700">
                          {rawContent || 'LLM 回傳為空'}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentStep === 3 && (
              <div className="flex min-h-0 flex-1 gap-4 overflow-hidden rounded-2xl border-2 border-gray-200 bg-gradient-to-b from-stone-200 to-stone-300 shadow-sm">
                {/* 左側：三分之一，報價單 header 編輯 */}
                <div className="flex w-1/3 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="flex min-h-[60px] shrink-0 items-center justify-between border-b border-sky-200 bg-sky-50 px-4 py-3">
                    <h3 className="text-lg font-medium text-sky-800">報價單資訊</h3>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                    {(() => {
                      const draft = getPreviewData()
                      if (!draft) return <p className="text-base text-gray-500">尚無報價資料</p>
                      const formKey = `header-${selectedProject?.project_id ?? 'none'}-${step3FormSeed}`
                      const applyCompany = (c: Company) => {
                        updateDraftHeader({
                          seller_company_name: c.legal_name ?? '',
                          seller_tax_id: c.tax_id ?? '',
                          seller_logo_url: c.logo_url ?? '',
                          seller_address: c.address ?? '',
                          seller_phone: c.phone ?? '',
                          seller_email: c.email ?? '',
                          terms: c.quotation_terms ?? '',
                        })
                        setStep3FormSeed((s) => s + 1)
                      }
                      const renderField = (f: { key: string; label: string; type: 'text' | 'number' | 'date' }) => {
                        if (f.key === 'seller_logo_url') {
                          return (
                            <div key={f.key} className="flex flex-col gap-1">
                              <label className="text-base font-medium text-gray-700">{f.label}</label>
                              <div className="flex h-12 items-center rounded-lg border border-gray-200 bg-gray-50 px-3">
                                {draft.seller_logo_url ? (
                                  <img
                                    src={draft.seller_logo_url}
                                    alt="公司 Logo"
                                    className="h-10 w-auto max-w-[200px] object-contain"
                                  />
                                ) : (
                                  <span className="text-sm text-gray-500">（選擇公司後顯示）</span>
                                )}
                              </div>
                            </div>
                          )
                        }
                        const val = draft[f.key as keyof QuotationDraft]
                        let displayVal = val === undefined || val === null ? '' : String(val)
                        if (f.key === 'quotation_date' && !displayVal.trim()) {
                          displayVal = new Date().toISOString().slice(0, 10)
                        }
                        return (
                          <div key={f.key} className="flex flex-col gap-1">
                            <label className="text-base font-medium text-gray-700">{f.label}</label>
                            <input
                              type={f.type}
                              defaultValue={displayVal}
                              onBlur={(e) => {
                                const v = e.target.value
                                const parsed = f.type === 'number' ? (Number(v) || 0) : v
                                updateDraftHeader({ [f.key]: parsed })
                              }}
                              className="rounded-lg border border-gray-300 px-3 py-2 text-lg focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            />
                          </div>
                        )
                      }
                      return (
                        <div key={formKey} className="flex flex-col gap-4">
                          <div className="space-y-3 rounded-lg bg-sky-50 p-4 ring-1 ring-sky-100">
                            <div className="flex items-center justify-between gap-2">
                              <h4 className="text-lg font-semibold text-gray-800">賣方資訊</h4>
                              <select
                                value=""
                                onChange={(e) => {
                                  const id = e.target.value
                                  if (!id) return
                                  const c = companies.find((x) => x.id === id)
                                  if (c) applyCompany(c)
                                  e.target.value = ''
                                }}
                                disabled={companiesLoading || companies.length === 0}
                                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
                                title={companies.length === 0 ? '尚無公司資料' : '選擇公司帶入'}
                              >
                                <option value="">
                                  {companiesLoading ? '載入中…' : companies.length === 0 ? '尚無公司' : '選擇公司…'}
                                </option>
                                {companies.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.legal_name ?? '(未命名)'}
                                  </option>
                                ))}
                              </select>
                            </div>
                            {SELLER_FIELDS.map(renderField)}
                          </div>
                          <div className="border-t border-gray-200" />
                          <div className="space-y-3 rounded-lg bg-amber-50 p-4 ring-1 ring-amber-100">
                            <h4 className="text-lg font-semibold text-gray-800">買方資訊</h4>
                            {BUYER_FIELDS.map(renderField)}
                          </div>
                          <div className="border-t border-gray-200" />
                          <div className="space-y-3 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
                            <h4 className="text-sm font-semibold text-gray-800">條款說明</h4>
                            <textarea
                              defaultValue={draft.terms ?? ''}
                              onBlur={(e) => updateDraftHeader({ terms: e.target.value })}
                              rows={6}
                              placeholder="請輸入條款說明..."
                              className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                            />
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {/* 右側：正式報價單預覽 */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="flex shrink-0 items-center justify-between border-b border-yellow-200 bg-yellow-50 px-4 py-3">
                    <h3 className="text-lg font-medium text-gray-800">報價單預覽</h3>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          const draft = getPreviewData()
                          if (!draft) {
                            setStep3ValidationError('尚無報價資料')
                            return
                          }
                          const { valid, missing } = validateStep3Draft(draft)
                          if (!valid) {
                            setStep3ValidationError(`請填寫以下欄位：${missing.join('、')}`)
                            return
                          }
                          setStep3ValidationError(null)
                          if (selectedProject) {
                            try {
                              const updated = await updateQtnStatus(agent.id, selectedProject.project_id, 'STEP4')
                              setProjects((prev) =>
                                prev.map((p) => (p.project_id === selectedProject.project_id ? { ...p, status: updated.status } : p))
                              )
                              setSelectedProject((prev) => (prev?.project_id === selectedProject.project_id ? { ...prev, status: updated.status } : prev))
                            } catch {
                              // 忽略
                            }
                          }
                          setCurrentStep(4)
                          persistStep(4)
                        }}
                        className="rounded-2xl bg-gray-700 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800"
                      >
                        完成
                      </button>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-6">
                    {(() => {
                      const draft = getPreviewData()
                      if (!draft) return <p className="text-base text-gray-500">尚無報價資料</p>
                      return <QuotationPreviewContent draft={draft} />
                    })()}
                  </div>
                </div>
              </div>
            )}

            {currentStep === 4 && (
              <div className="flex min-h-0 flex-1 gap-4 overflow-hidden rounded-2xl border-2 border-gray-200 bg-gradient-to-b from-stone-200 to-stone-300 shadow-sm">
                {/* 左側：正式報價單（寬度適中，不佔滿） */}
                <div className="flex min-h-0 max-w-3xl flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="flex shrink-0 items-center justify-between border-b border-teal-200 bg-teal-50 px-4 py-3">
                    <h3 className="text-lg font-medium text-teal-800">報價單</h3>
                    <button
                      type="button"
                      onClick={handleExportPdf}
                      disabled={!getPreviewData() || pdfExporting}
                      className="flex items-center gap-1.5 rounded-2xl border border-gray-300 bg-white px-3 py-1.5 text-base font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <FileDown className="h-4 w-4" />
                      {pdfExporting ? '輸出中…' : '輸出 PDF'}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-6">
                    {(() => {
                      const draft = getPreviewData()
                      if (!draft) return <p className="text-base text-gray-500">尚無報價資料</p>
                      return <QuotationPreviewContent draft={draft} innerRef={quotationPdfRef} />
                    })()}
                  </div>
                </div>

                {/* 右側：發送跟進建議 */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
                  <div className="flex shrink-0 items-center justify-between border-b border-indigo-200 bg-indigo-50 px-4 py-3">
                    <h3 className="text-lg font-medium text-indigo-800">發送跟進建議</h3>
                    <button
                      type="button"
                      onClick={handleGenerateShare}
                      disabled={!selectedProject || !getPreviewData() || shareLoading}
                      className="flex items-center gap-1.5 rounded-2xl bg-gray-700 px-3 py-1.5 text-base font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {shareLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {shareLoading ? '生成中…' : '生成'}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto bg-white p-4">
                    {shareError && (
                      <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                        {shareError}
                      </div>
                    )}
                    <div className="flex flex-col gap-4">
                      {/* 1. Email 內容建議 */}
                      <section className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-gray-700">1. Email 內容建議</h4>
                        <div className="min-h-[80px] rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                          {shareSuggestions?.email ?? '（點擊「生成」由 AI 產生建議）'}
                        </div>
                      </section>
                      {/* 2. 通訊軟體內容建議 */}
                      <section className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-gray-700">2. 通訊軟體內容建議</h4>
                        <div className="min-h-[80px] rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                          {shareSuggestions?.messaging ?? '（待填入）'}
                        </div>
                      </section>
                      {/* 3. 電話內容建議 */}
                      <section className="flex flex-col gap-2">
                        <h4 className="text-sm font-semibold text-gray-700">3. 電話內容建議</h4>
                        <div className="min-h-[80px] rounded-lg border border-gray-200 bg-gray-50/50 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                          {shareSuggestions?.phone ?? '（待填入）'}
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}
