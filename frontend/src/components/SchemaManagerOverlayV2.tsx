/** 資料範本管理（v2）- Wizard 式新建 + 側欄卡片列表 */
import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  MoreVertical,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import {
  createBiSchema,
  deleteBiSchema,
  getBiSchema,
  listBiSchemas,
  updateBiSchema,
  type BiSchemaItem,
} from '@/api/biSchemas'

// ─── Types ───────────────────────────────────────────

interface SchemaManagerOverlayV2Props {
  agentId: string
  onClose: () => void
  onSchemaChanged: () => void
}

interface SchemaColumn {
  columnName: string
  dataType: 'str' | 'num' | 'time'
  attr: 'dim' | 'dim_time' | 'val'
  sampleData: string
  aliases: string
  enumValues: string
}

interface DimHierarchyGroup {
  id: string
  label: string
  cols: string[]
}

type ViewState = 'idle' | 'wizard' | 'editing'
type WizardStep = 1 | 2 | 3
type EditTab = 'schema' | 'hierarchy'

interface ToastItem { id: number; message: string; variant: 'success' | 'error' }

// ─── Constants ───────────────────────────────────────

const DATA_TYPE_CYCLE: SchemaColumn['dataType'][] = ['str', 'num', 'time']
const ATTR_CYCLE: SchemaColumn['attr'][] = ['dim', 'val', 'dim_time']
const DATA_TYPE_LABELS: Record<SchemaColumn['dataType'], string> = { str: '文字', num: '數值', time: '時間' }
const DATA_TYPE_CLASSES: Record<SchemaColumn['dataType'], string> = {
  str: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200',
  num: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
  time: 'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
}
const ATTR_LABELS: Record<SchemaColumn['attr'], string> = { dim: '維度', dim_time: '時間維度', val: '指標值' }
const ATTR_CLASSES: Record<SchemaColumn['attr'], string> = {
  dim: 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
  dim_time: 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200',
  val: 'bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-200',
}
const WIZARD_STEPS = ['基本資訊', '欄位定義', '維度層級']

// ─── Helpers ─────────────────────────────────────────

function inferDataType(v: string, col: string): SchemaColumn['dataType'] {
  const val = v.trim(); const c = col.toLowerCase()
  if (!val) return 'str'
  const timeKw = ['日期', '時間', 'timestamp', 'date', '月份', '月', 'month', 'year']
  if (/^\d{4}[-/]?\d{1,2}([-/]\d{1,2})?$|^\d{4}\d{2}\d{2}$/.test(val) || timeKw.some(k => c.includes(k))) return 'time'
  const numKw = ['金額', '數量', '營收', '銷售', 'amount', 'quantity', 'sales', 'count', 'price', 'value', 'profit', '毛利', '成本']
  if (/^-?\d+(\.\d+)?$/.test(val.replace(/,/g, '')) || numKw.some(k => c.includes(k))) return 'num'
  return 'str'
}

function inferAttr(dt: SchemaColumn['dataType']): SchemaColumn['attr'] {
  return dt === 'time' ? 'dim_time' : dt === 'num' ? 'val' : 'dim'
}

function parseCols(sj: Record<string, unknown>): SchemaColumn[] {
  const cols = (sj?.columns as Record<string, { type?: string; attr?: string; aliases?: string[]; sample?: string; sample_data?: string; enum_values?: string[] }>) ?? {}
  return Object.entries(cols).map(([name, m]) => {
    const rawSample = m?.sample ?? m?.sample_data
    const sampleData = typeof rawSample === 'string' ? rawSample : ''
    const enumValues = Array.isArray(m?.enum_values) ? m.enum_values.join(', ') : ''
    return {
      columnName: name,
      dataType: (m?.type as SchemaColumn['dataType']) ?? 'str',
      attr: (m?.attr as SchemaColumn['attr']) ?? 'dim',
      sampleData,
      aliases: Array.isArray(m?.aliases) ? m.aliases.join(', ') : '',
      enumValues,
    }
  })
}

function buildCols(cols: SchemaColumn[]): Record<string, { type: string; attr: string; aliases: string[]; sample?: string; enum_values?: string[] }> {
  const out: Record<string, { type: string; attr: string; aliases: string[]; sample?: string; enum_values?: string[] }> = {}
  cols.forEach((c, i) => {
    const name = c.columnName.trim() || `col_${i}`
    const base: { type: string; attr: string; aliases: string[]; sample?: string; enum_values?: string[] } = {
      type: c.dataType,
      attr: c.attr,
      aliases: c.aliases.split(',').map(a => a.trim()).filter(Boolean),
    }
    const s = c.sampleData.trim()
    if (s) base.sample = s
    if (c.attr === 'dim') {
      const ev = c.enumValues.split(',').map(v => v.trim()).filter(Boolean)
      if (ev.length > 0) base.enum_values = ev
    }
    out[name] = base
  })
  return out
}

function parseHierarchy(sj: Record<string, unknown>): DimHierarchyGroup[] {
  const dh = (sj?.dimension_hierarchy as Record<string, string[]>) ?? {}
  return Object.entries(dh).map(([label, cols], i) => ({
    id: `h${i}-${label}`, label, cols: Array.isArray(cols) ? cols : [],
  }))
}

function buildHierarchy(groups: DimHierarchyGroup[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  groups.forEach(g => {
    const lbl = g.label.trim()
    const cols = g.cols.filter(Boolean)
    if (lbl && cols.length) out[lbl] = cols
  })
  return out
}

function parseCsvRows(file: File, max: number): Promise<string[][]> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result ?? '').trim().split(/\r?\n/).slice(0, max).map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, ''))))
    r.onerror = () => rej(r.error)
    r.readAsText(file, 'UTF-8')
  })
}

let toastId = 0

// ─── Component ───────────────────────────────────────

export default function SchemaManagerOverlayV2({ agentId, onClose, onSchemaChanged }: SchemaManagerOverlayV2Props) {

  // state
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])
  const [view, setView] = useState<ViewState>('idle')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [step, setStep] = useState<WizardStep>(1)
  const [tab, setTab] = useState<EditTab>('schema')

  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [cols, setCols] = useState<SchemaColumn[]>([])
  const [hier, setHier] = useState<DimHierarchyGroup[]>([])

  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvRows, setCsvRows] = useState<string[][]>([])
  const [dragOver, setDragOver] = useState(false)
  const csvRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [toDelete, setToDelete] = useState<BiSchemaItem | null>(null)
  const [dropdownId, setDropdownId] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [helpOpen, setHelpOpen] = useState(false)

  // always-fresh refs — avoids stale closure entirely
  const colsRef = useRef(cols)
  const hierRef = useRef(hier)
  const nameRef = useRef(name)
  const descRef = useRef(desc)
  const selectedIdRef = useRef(selectedId)
  colsRef.current = cols
  hierRef.current = hier
  nameRef.current = name
  descRef.current = desc
  selectedIdRef.current = selectedId

  // toast
  const toast = (msg: string, v: ToastItem['variant'] = 'success') => {
    const id = ++toastId
    setToasts(p => [...p, { id, message: msg, variant: v }])
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000)
  }

  // load
  const loadSchemas = () => listBiSchemas(agentId).then(setSchemas).catch(() => toast('載入失敗', 'error'))
  useEffect(() => { loadSchemas() }, [agentId]) // eslint-disable-line react-hooks/exhaustive-deps

  // close dropdown
  useEffect(() => {
    if (!dropdownId) return
    const h = () => setDropdownId(null)
    document.addEventListener('click', h)
    return () => document.removeEventListener('click', h)
  }, [dropdownId])

  // reset for new wizard
  const startNew = () => {
    setSelectedId(null); setName(''); setDesc(''); setCols([]); setHier([])
    setCsvFile(null); setCsvRows([]); setStep(1); setView('wizard')
  }

  // load existing
  const openEdit = async (id: string) => {
    setSelectedId(id)
    try {
      const d = await getBiSchema(id)
      const sj = (d.schema_json ?? {}) as Record<string, unknown>
      setName(d.name); setDesc(d.desc ?? '')
      setCols(parseCols(sj)); setHier(parseHierarchy(sj))
      setCsvFile(null); setCsvRows([]); setTab('schema'); setView('editing')
    } catch { toast('載入失敗', 'error') }
  }

  // CSV
  const processCsv = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) { toast('僅支援 CSV', 'error'); return }
    setCsvFile(file)
    if (!nameRef.current && view === 'wizard') setName(file.name.replace(/\.csv$/i, ''))
    try {
      const rows = await parseCsvRows(file, 5)
      setCsvRows(rows)
      if (rows.length > 0) {
        const headers = rows[0]!
        const first = rows[1] ?? []
        setCols(headers.map((h, i) => {
          const sample = (first[i] ?? '').trim()
          const dt = inferDataType(sample, h.trim())
          return { columnName: `col_${i + 1}`, dataType: dt, attr: inferAttr(dt), sampleData: sample, aliases: h.trim(), enumValues: '' }
        }))
      }
    } catch { toast('無法讀取 CSV', 'error') }
  }

  // build json — reads from refs, no closure issue
  const buildJson = (id: string): Record<string, unknown> => ({
    id,
    name: nameRef.current.trim(),
    columns: buildCols(colsRef.current),
    dimension_hierarchy: buildHierarchy(hierRef.current),
    aggregation: { default: 'sum' },
    indicators: {},
  })

  // create
  const handleCreate = async () => {
    if (!nameRef.current.trim()) { toast('請填寫名稱', 'error'); return }
    if (colsRef.current.length === 0) { toast('請至少新增一個欄位', 'error'); return }
    const badHier = hierRef.current.find(g => !g.label.trim() || !g.cols.filter(Boolean).length)
    if (badHier) { toast('維度層級需填寫名稱並選擇至少一個欄位', 'error'); return }
    setSaving(true)
    try {
      const res = await createBiSchema({
        name: nameRef.current.trim(),
        desc: descRef.current.trim() || undefined,
        agent_id: agentId,
        schema_json: buildJson('schema'),
      })
      toast('新增成功')
      loadSchemas(); onSchemaChanged()
      setSelectedId(res.id); setTab('schema'); setView('editing')
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      toast(err?.detail ?? err?.message ?? '新增失敗', 'error')
    } finally { setSaving(false) }
  }

  // update
  const handleUpdate = async () => {
    if (!selectedIdRef.current) return
    if (!nameRef.current.trim()) { toast('請填寫名稱', 'error'); return }
    if (colsRef.current.length === 0) { toast('請至少保留一個欄位', 'error'); return }
    const badHier = hierRef.current.find(g => !g.label.trim() || !g.cols.filter(Boolean).length)
    if (badHier) { toast('維度層級需填寫名稱並選擇至少一個欄位', 'error'); return }
    setSaving(true)
    try {
      await updateBiSchema(selectedIdRef.current, {
        name: nameRef.current.trim(),
        desc: descRef.current.trim() || undefined,
        schema_json: buildJson(selectedIdRef.current),
      })
      toast('已儲存')
      loadSchemas(); onSchemaChanged()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      toast(err?.detail ?? err?.message ?? '修改失敗', 'error')
    } finally { setSaving(false) }
  }

  // delete
  const handleDelete = async () => {
    if (!toDelete) return
    setDeleting(true)
    try {
      await deleteBiSchema(toDelete.id)
      toast('已刪除')
      if (selectedIdRef.current === toDelete.id) { setSelectedId(null); setView('idle') }
      loadSchemas(); onSchemaChanged()
      setConfirmOpen(false); setToDelete(null)
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      toast(err?.detail ?? err?.message ?? '刪除失敗', 'error')
    } finally { setDeleting(false) }
  }

  // wizard nav
  const wizNext = () => {
    if (step === 1) { if (!nameRef.current.trim()) { toast('請填寫名稱', 'error'); return }; setStep(2) }
    else if (step === 2) { if (colsRef.current.length === 0) { toast('請至少新增一個欄位', 'error'); return }; setStep(3) }
    else { void handleCreate() }
  }
  const wizPrev = () => { if (step > 1) setStep(s => (s - 1) as WizardStep) }

  // ─── Render: Sidebar ─────────────────────────────────

  const renderSidebar = () => (
    <aside className="flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: '#483C32' }}>
      <div className="flex shrink-0 items-center justify-between border-b border-gray-300/50 pl-5 pr-3 py-2.5">
        <span className="text-base font-medium text-white">資料範本列表</span>
        <button type="button" onClick={startNew}
          className="flex items-center gap-1 rounded-2xl border border-white/30 bg-white/10 px-2.5 py-1 text-base font-medium text-white transition-colors hover:bg-white/20">
          <Plus className="h-3.5 w-3.5" />新增
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {schemas.length === 0
          ? <p className="mt-6 text-center text-base text-[#AE924C]/70">尚無資料範本</p>
          : <ul className="flex flex-col gap-1">
              {schemas.map(s => (
                <li key={s.id} onClick={() => void openEdit(s.id)}
                  className={`group relative cursor-pointer rounded-lg px-3 py-2.5 transition-all ${selectedId === s.id ? 'bg-[#AE924C] font-medium' : 'hover:bg-[#AE924C]/10'}`}>
                  <div className="flex items-start justify-between gap-1">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base text-white">{s.name}</p>
                    </div>
                    <div className="relative shrink-0">
                      <button type="button" onClick={e => { e.stopPropagation(); setDropdownId(dropdownId === s.id ? null : s.id) }}
                        className="rounded p-0.5 text-white/70 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10">
                        <MoreVertical className="h-4 w-4" />
                      </button>
                      {dropdownId === s.id && (
                        <div className="absolute right-0 top-6 z-20 w-28 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
                          <button type="button"
                            onClick={e => { e.stopPropagation(); setToDelete(s); setConfirmOpen(true); setDropdownId(null) }}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-base text-red-600 hover:bg-red-50">
                            <Trash2 className="h-4 w-4" />刪除
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
        }
      </div>
    </aside>
  )

  // ─── Render: Wizard progress ─────────────────────────

  const renderProgress = () => (
    <div className="flex items-center">
      {WIZARD_STEPS.map((label, i) => {
        const n = (i + 1) as WizardStep
        const active = n === step, done = n < step
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center gap-1.5">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-semibold transition-all ${done ? 'text-white' : active ? 'text-white ring-4 ring-white/20' : 'bg-white/20 text-white/50'}`}
                style={done || active ? { backgroundColor: active ? '#AE924C' : '#7a6635' } : {}}>
                {done ? <CheckCircle2 className="h-4 w-4" /> : n}
              </div>
              <span className={`text-sm font-medium text-white ${active ? 'font-semibold' : ''}`}>{label}</span>
            </div>
            {i < WIZARD_STEPS.length - 1 && <div className={`mx-3 mb-5 h-0.5 w-12 rounded-full ${n < step ? 'bg-[#AE924C]/60' : 'bg-white/20'}`} />}
          </div>
        )
      })}
    </div>
  )

  // ─── Render: Step 1 ──────────────────────────────────

  const renderStep1 = () => (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-base font-medium text-gray-700">資料範本名稱 <span className="text-red-500">*</span></label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="例：月銷售報表" />
        </div>
        <div>
          <label className="mb-1.5 block text-base font-medium text-gray-700">描述（選填）</label>
          <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
            placeholder="用途說明…" />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-base font-medium text-gray-700">上傳 CSV <span className="font-normal text-gray-400">（選填，自動帶入欄位）</span></label>
        <input ref={csvRef} type="file" accept=".csv,text/csv" className="hidden"
          onChange={async e => { const f = e.target.files?.[0]; if (f) await processCsv(f); if (e.target) e.target.value = '' }} />
        <div onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
          onDrop={async e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) await processCsv(f) }}
          onClick={() => csvRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-dashed px-6 py-10 transition-colors ${dragOver ? 'border-blue-400 bg-blue-50' : csvFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'}`}>
          {csvFile
            ? <><FileSpreadsheet className="h-9 w-9 text-emerald-500" /><span className="text-base font-medium text-emerald-700">{csvFile.name}</span><span className="text-sm text-gray-400">點擊重新選擇</span></>
            : <><Upload className="h-9 w-9 text-gray-400" /><span className="text-base text-gray-600">拖曳或點擊上傳 CSV</span><span className="text-sm text-gray-400">自動識別欄位名稱、型態與別名</span></>}
        </div>
      </div>
      {csvRows.length > 0 && (
        <div>
          <p className="mb-1.5 text-base font-medium text-gray-700">CSV 預覽（前 5 行）</p>
          <div className="overflow-auto rounded-xl border border-gray-200 shadow-sm">
            <table className="min-w-full text-base"><tbody>
              {csvRows.map((row, i) => (
                <tr key={i} className={i === 0 ? 'bg-gray-100 font-semibold' : 'bg-white'}>
                  {row.map((cell, j) => <td key={j} className="border-b border-gray-100 px-3 py-1.5">{cell}</td>)}
                </tr>
              ))}
            </tbody></table>
          </div>
        </div>
      )}
    </div>
  )

  // ─── Render: Fields table ─────────────────────────────

  const renderFields = () => (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">型態與屬性可直接下拉選擇</p>
        <button type="button" onClick={() => setCols(p => [...p, { columnName: '', dataType: 'str', attr: 'dim', sampleData: '', aliases: '', enumValues: '' }])}
          className="flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 transition-colors hover:bg-gray-50">
          <Plus className="h-4 w-4" />新增欄位
        </button>
      </div>
      {cols.length === 0
        ? <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-14 text-center shadow-sm">
            <p className="text-base text-gray-400">尚無欄位，可上傳 CSV 自動帶入，或手動新增</p>
          </div>
        : <div className="overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-base">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {['欄位名稱', '範例資料', '型態', '屬性', '別名（逗號分隔）', '可選值（逗號分隔）', ''].map((h, i) =>
                    <th key={i} className="border-b border-slate-200 px-3 py-2.5 text-left text-sm font-semibold uppercase tracking-wide text-slate-600">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {cols.map((col, i) => (
                  <tr key={i} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
                    <td className="px-3 py-2">
                      <input type="text" value={col.columnName} placeholder="欄位名稱"
                        onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, columnName: e.target.value }))}
                        className="w-28 rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" value={col.sampleData} placeholder="範例資料"
                        onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, sampleData: e.target.value }))}
                        className="w-full min-w-[6rem] rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                    </td>
                    <td className="px-3 py-2">
                      <select value={col.dataType}
                        onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, dataType: e.target.value as SchemaColumn['dataType'] }))}
                        className={`rounded-full border px-3 py-1 text-base font-medium transition-colors ${DATA_TYPE_CLASSES[col.dataType]}`}>
                        {DATA_TYPE_CYCLE.map(dt => <option key={dt} value={dt}>{DATA_TYPE_LABELS[dt]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={col.attr}
                        onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, attr: e.target.value as SchemaColumn['attr'] }))}
                        className={`rounded-full border px-3 py-1 text-base font-medium transition-colors ${ATTR_CLASSES[col.attr]}`}>
                        {ATTR_CYCLE.map(a => <option key={a} value={a}>{ATTR_LABELS[a]}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="text" value={col.aliases} placeholder="如：營收, 銷售額"
                        onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, aliases: e.target.value }))}
                        className="w-full min-w-[8rem] rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                    </td>
                    <td className="px-3 py-2">
                      {col.attr === 'dim'
                        ? <input type="text" value={col.enumValues} placeholder="如：VIP, 標準, 潛力"
                            onChange={e => setCols(p => p.map((c, j) => j !== i ? c : { ...c, enumValues: e.target.value }))}
                            className="w-full min-w-[8rem] rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                        : <span className="text-gray-300 text-sm">—</span>
                      }
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => setCols(p => p.filter((_, j) => j !== i))}
                        className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      }
    </div>
  )

  // ─── Render: Hierarchy ───────────────────────────────

  const renderHierarchy = () => {
    const colOpts = cols.filter(c => c.columnName.trim())
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm text-gray-500">定義維度上下層關係，讓 AI 理解「大類 → 中類 → 小類」等結構。選填。</p>
          <button type="button" onClick={() => setHier(p => [...p, { id: String(Date.now()), label: '', cols: [''] }])}
            className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-base text-gray-700 transition-colors hover:bg-gray-50">
            <Plus className="h-4 w-4" />新增層級
          </button>
        </div>
        {hier.length === 0
          ? <div className="rounded-xl border-2 border-dashed border-gray-200 bg-white py-14 text-center shadow-sm">
              <p className="text-base text-gray-400">尚無層級定義，可略過</p>
            </div>
          : <div className="flex flex-col gap-3">
              {hier.map((g, gi) => {
                const preview = g.cols.filter(Boolean)
                const incomplete = !g.label.trim() || g.cols.filter(Boolean).length === 0
                return (
                  <div key={g.id} className={`rounded-xl border bg-white p-4 shadow-sm ${incomplete ? 'border-amber-300 bg-amber-50/30' : 'border-gray-200'}`}>
                    <div className="mb-3 flex items-end gap-3">
                      <div className="flex-1">
                        <label className="mb-1 block text-sm font-medium text-gray-600">層級名稱 <span className="text-red-500">*</span></label>
                        <input type="text" value={g.label} placeholder="如：商品分類"
                          onChange={e => setHier(p => p.map((x, i) => i !== gi ? x : { ...x, label: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400" />
                      </div>
                      <button type="button" onClick={() => setHier(p => p.filter((_, i) => i !== gi))}
                        className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {g.cols.map((col, ci) => (
                        <div key={ci} className="flex items-center gap-2">
                          <span className="w-5 shrink-0 text-right text-sm font-medium text-gray-400">{ci + 1}</span>
                          <select value={col}
                            onChange={e => setHier(p => p.map((x, i) => {
                              if (i !== gi) return x
                              const next = [...x.cols]; next[ci] = e.target.value; return { ...x, cols: next }
                            }))}
                            className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400">
                            <option value="">— 選擇欄位 —</option>
                            {colOpts.map((c, j) => {
                              const alias = c.aliases.split(',')[0]?.trim()
                              return <option key={j} value={c.columnName.trim()}>{c.columnName.trim()}{alias ? `（${alias}）` : ''}</option>
                            })}
                          </select>
                          <button type="button" disabled={ci === 0}
                            onClick={() => setHier(p => p.map((x, i) => {
                              if (i !== gi) return x
                              const next = [...x.cols];[next[ci], next[ci - 1]] = [next[ci - 1]!, next[ci]!]; return { ...x, cols: next }
                            }))}
                            className="rounded px-1.5 py-1 text-base text-gray-400 transition-colors hover:bg-gray-200 disabled:opacity-30">↑</button>
                          <button type="button" disabled={ci === g.cols.length - 1}
                            onClick={() => setHier(p => p.map((x, i) => {
                              if (i !== gi) return x
                              const next = [...x.cols];[next[ci], next[ci + 1]] = [next[ci + 1]!, next[ci]!]; return { ...x, cols: next }
                            }))}
                            className="rounded px-1.5 py-1 text-base text-gray-400 transition-colors hover:bg-gray-200 disabled:opacity-30">↓</button>
                          <button type="button" onClick={() => setHier(p => p.map((x, i) => i !== gi ? x : { ...x, cols: x.cols.filter((_, j) => j !== ci) }))}
                            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-red-100 hover:text-red-500">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <button type="button" onClick={() => setHier(p => p.map((x, i) => i !== gi ? x : { ...x, cols: [...x.cols, ''] }))}
                        className="mt-1 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-base text-blue-600 transition-colors hover:bg-blue-50">
                        <Plus className="h-4 w-4" />新增欄位
                      </button>
                    </div>
                    {preview.length > 1 && (
                      <p className="mt-3 rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{preview.join(' → ')}</p>
                    )}
                    {incomplete && <p className="mt-2 text-sm text-amber-600">⚠ 需填寫層級名稱並選擇至少一個欄位</p>}
                  </div>
                )
              })}
            </div>
        }
      </div>
    )
  }

  // ─── Main render ──────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-100 p-4" role="dialog" aria-modal="true" aria-label="資料範本管理">

      {/* Header — 獨立圓角卡片 */}
      <div className="flex shrink-0 items-center justify-between rounded-xl border border-gray-300/50 px-6 py-4 shadow-md" style={{ backgroundColor: '#483C32' }}>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-2xl font-bold text-white">資料範本管理</h2>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            title="使用說明"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/30 bg-white/10 text-base font-semibold leading-none text-white transition-opacity hover:bg-white/20"
            aria-label="使用說明"
          >
            ？
          </button>
        </div>
        <button type="button" onClick={onClose} className="rounded-xl p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white" aria-label="關閉資料範本管理">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body — sidebar + 主內容，各自獨立圓角卡片，中間有 gap */}
      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {renderSidebar()}

        {/* 主內容卡片 */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">

          {/* Idle */}
          {view === 'idle' && (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <div className="mb-4 flex justify-center">
                  <div className="rounded-2xl p-5 shadow-sm" style={{ backgroundColor: '#483C32' }}>
                    <Plus className="h-10 w-10 text-white/80" />
                  </div>
                </div>
                <h3 className="text-lg font-semibold text-gray-800">選擇或建立資料範本</h3>
                <p className="mt-1.5 text-base text-gray-500">從左側選擇已有的資料範本，或新建一個</p>
                <button type="button" onClick={startNew}
                  className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-base font-medium text-white shadow-sm transition-colors hover:bg-blue-700">
                  + 新建資料範本
                </button>
              </div>
            </div>
          )}

          {/* Wizard */}
          {view === 'wizard' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="shrink-0 rounded-t-2xl border-b border-gray-300/50 px-8 py-5" style={{ backgroundColor: '#353839' }}>
                {renderProgress()}
              </div>
              <div className="flex-1 overflow-y-auto px-8 py-6">
                {step === 1 && renderStep1()}
                {step === 2 && renderFields()}
                {step === 3 && renderHierarchy()}
              </div>
              <div className="flex shrink-0 items-center justify-between rounded-b-2xl border-t border-slate-200 bg-gray-50 px-8 py-4">
                <button type="button" onClick={step === 1 ? () => setView('idle') : wizPrev}
                  className="flex items-center gap-1.5 rounded-xl border border-gray-300 bg-white px-4 py-2 text-base text-gray-700 transition-colors hover:bg-gray-50">
                  <ChevronLeft className="h-4 w-4" />{step === 1 ? '取消' : '上一步'}
                </button>
                <button type="button" onClick={wizNext} disabled={saving}
                  className="flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-base font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50">
                  {step === 3 ? (saving ? '建立中…' : '完成建立') : '下一步'}
                  {step < 3 && <ChevronRight className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Edit */}
          {view === 'editing' && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="shrink-0 rounded-t-2xl border-b border-slate-200 bg-slate-100 px-8 pt-5">
                <div className="mb-4 flex items-end gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-600">名稱</label>
                    <input type="text" value={name} onChange={e => setName(e.target.value)}
                      className="w-52 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-slate-600">描述</label>
                    <input type="text" value={desc} onChange={e => setDesc(e.target.value)} placeholder="選填"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-800 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500" />
                  </div>
                  <button type="button" onClick={() => void handleUpdate()} disabled={saving}
                    className="shrink-0 rounded-xl bg-blue-600 px-5 py-2 text-base font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50">
                    {saving ? '儲存中…' : '存檔'}
                  </button>
                </div>
                <div className="flex gap-1">
                  {(['schema', 'hierarchy'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTab(t)}
                      className={`rounded-t-xl px-4 py-2 text-base font-medium transition-colors ${tab === t ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:bg-slate-200/60'}`}>
                      {t === 'schema' ? '欄位定義' : '維度層級'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-8 py-6">
                {tab === 'schema' ? renderFields() : renderHierarchy()}
              </div>
            </div>
          )}

        </div>
      </div>

      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-bi-schema.md" title="資料範本管理說明" />

      {/* Confirm delete */}
      <ConfirmModal open={confirmOpen} title="刪除資料範本"
        message={`確定要刪除「${toDelete?.name ?? ''}」嗎？此操作無法復原。`}
        confirmText={deleting ? '刪除中…' : '刪除'} variant="danger"
        onConfirm={() => { if (!deleting) void handleDelete() }}
        onCancel={() => { if (!deleting) { setConfirmOpen(false); setToDelete(null) } }} />

      {/* Toasts */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col-reverse gap-2">
        {toasts.map(t => (
          <div key={t.id} role="alert"
            className={`pointer-events-auto flex items-center gap-2 rounded-xl px-4 py-3 text-base font-medium text-white shadow-lg ${t.variant === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>
            {t.variant === 'success' && <CheckCircle2 className="h-5 w-5 shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>
    </div>
  )
}
