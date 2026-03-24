/** Test02 Agent 專用 UI */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import AgentIcon from '@/components/AgentIcon'
import AgentPageLayout from '@/components/AgentPageLayout'
import ConfirmModal from '@/components/ConfirmModal'
import {
  listBiSchemas,
  getBiSchema,
  createBiSchema,
  updateBiSchema,
  deleteBiSchema,
  type BiSchemaItem,
} from '@/api/biSchemas'
import type { Agent } from '@/types'

interface AgentTest02UIProps {
  agent: Agent
}

/** Schema 欄位定義 */
interface SchemaColumn {
  columnName: string
  dataType: 'str' | 'num' | 'time'
  attr: 'dim' | 'dim_time' | 'val'
  sampleData: string
  aliases: string
}

const DATA_TYPES = ['str', 'num', 'time'] as const
const ATTR_OPTIONS = [
  { value: 'dim', label: '維度' },
  { value: 'dim_time', label: '時間維度' },
  { value: 'val', label: '數值' },
] as const

/** 從範例值與欄位名稱推斷資料型態 */
function inferDataType(sampleValue: string, columnName: string): SchemaColumn['dataType'] {
  const v = sampleValue.trim()
  const col = columnName.toLowerCase()
  if (!v) return 'str'
  // 時間：日期格式或欄位名含日期關鍵字
  const datePattern = /^\d{4}[-/]?\d{1,2}([-/]\d{1,2})?$|^\d{4}\d{2}\d{2}$/
  const timeKeywords = ['日期', '時間', 'timestamp', 'date', '月份', '月', 'month', 'year']
  if (datePattern.test(v) || timeKeywords.some((k) => col.includes(k))) {
    return 'time'
  }
  // 數值：可解析為數字，或欄位名含數值關鍵字
  const numVal = v.replace(/,/g, '')
  const numKeywords = ['金額', '數量', '營收', '銷售', 'amount', 'quantity', 'sales', 'count', 'price', 'value', 'profit', '毛利', '成本']
  if (/^-?\d+(\.\d+)?$/.test(numVal) || numKeywords.some((k) => col.includes(k))) {
    return 'num'
  }
  return 'str'
}

/** 依資料型態推斷屬性 */
function inferAttr(dataType: SchemaColumn['dataType']): SchemaColumn['attr'] {
  if (dataType === 'time') return 'dim_time'
  if (dataType === 'num') return 'val'
  return 'dim'
}

/** 將 schema_json columns 轉為 SchemaColumn[] */
function parseColumnsFromSchema(sj: Record<string, unknown>): SchemaColumn[] {
  const cols = (sj?.columns as Record<string, { type?: string; attr?: string; aliases?: string[] }>) ?? {}
  return Object.entries(cols).map(([colName, meta]) => ({
    columnName: colName,
    dataType: (meta?.type as SchemaColumn['dataType']) ?? 'str',
    attr: (meta?.attr as SchemaColumn['attr']) ?? 'dim',
    sampleData: '',
    aliases: Array.isArray(meta?.aliases) ? meta.aliases.join(', ') : '',
  }))
}

/** 將 SchemaColumn[] 轉為 schema_json 的 columns 格式 */
function buildColumnsToSchema(cols: SchemaColumn[]): Record<string, { type: string; attr: string; aliases: string[] }> {
  const out: Record<string, { type: string; attr: string; aliases: string[] }> = {}
  for (const c of cols) {
    const name = (c.columnName || '').trim() || `col_${cols.indexOf(c)}`
    const aliases = (c.aliases || '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean)
    out[name] = { type: c.dataType, attr: c.attr, aliases }
  }
  return out
}

/** 指標定義（對應 schema_json.indicators，僅 ratio：分子／分母） */
interface IndicatorRow {
  key: string
  displayLabel: string
  valueComponents: [string, string]
  asPercent: boolean
}

/** 舊資料 compare_period 載入為 ratio，分母欄可再補 */
function normalizeIndicatorRowParts(raw: string[], wasComparePeriod: boolean): [string, string] {
  const t = raw.map((s) => String(s).trim())
  if (wasComparePeriod) {
    return [t[0] ?? '', '']
  }
  return [t[0] ?? '', t[1] ?? '']
}

function parseIndicatorsFromSchema(sj: Record<string, unknown>): IndicatorRow[] {
  const ind = (sj?.indicators as Record<string, Record<string, unknown>>) ?? {}
  return Object.entries(ind).map(([key, meta]) => {
    const wasComparePeriod = meta?.type === 'compare_period'
    const raw = Array.isArray(meta?.value_components)
      ? (meta.value_components as unknown[]).map((x) => String(x).trim())
      : []
    return {
      key,
      displayLabel: String(meta?.display_label ?? ''),
      valueComponents: normalizeIndicatorRowParts(raw, wasComparePeriod),
      asPercent: Boolean(meta?.as_percent),
    }
  })
}

function buildIndicatorsToSchema(rows: IndicatorRow[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const r of rows) {
    const k = (r.key || '').trim()
    if (!k) continue
    const parts = [(r.valueComponents[0] ?? '').trim(), (r.valueComponents[1] ?? '').trim()]
    out[k] = {
      type: 'ratio',
      display_label: (r.displayLabel || '').trim() || k,
      value_components: parts,
      as_percent: r.asPercent,
    }
  }
  return out
}

/** 下拉選單顯示：欄位名 + 第一個別名 */
function columnSelectLabel(c: SchemaColumn): string {
  const name = (c.columnName || '').trim()
  const alias = (c.aliases || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)[0]
  if (name && alias && alias !== name) return `${name}（${alias}）`
  return name || '—'
}

/** Indicator 分子／分母下拉；與同列 input 同高，於 flex 列內均分剩餘寬度 */
const indicatorFieldSelectCompactClass =
  'min-w-[10rem] flex-1 basis-0 rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500'

/** 表頭是否含中文（CJK 統一漢字區） */
function headerHasChinese(header: string): boolean {
  return /[\u4e00-\u9fff]/.test(header.trim())
}

/** 從 CSV 預覽行推導初始 schema；表頭為中文時欄位名稱使用 col_1、col_2…，原始表頭寫入別名 */
function deriveSchemaFromCsv(rows: string[][]): SchemaColumn[] {
  if (rows.length < 1) return []
  const headers = rows[0]
  const firstDataRow = rows[1] ?? []
  return headers.map((col, i) => {
    const sample = (firstDataRow[i] ?? '').trim()
    const rawHeader = col.trim()
    const chinese = headerHasChinese(rawHeader)
    const columnName = chinese ? `col_${i + 1}` : rawHeader
    // 型別推斷仍用原始表頭，以辨識「日期」「金額」等中文關鍵字
    const dataType = inferDataType(sample, rawHeader)
    return {
      columnName,
      dataType,
      attr: inferAttr(dataType),
      sampleData: sample,
      aliases: chinese ? rawHeader : '',
    }
  })
}

/** 解析 CSV 前 N 行，回傳二維陣列 */
function parseCsvRows(file: File, maxRows: number): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      const lines = text.trim().split(/\r?\n/).slice(0, maxRows)
      const rows: string[][] = lines.map((line) =>
        line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
      )
      resolve(rows)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsText(file, 'UTF-8')
  })
}

function ResizeHandle() {
  return (
    <Separator
      className="flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-transparent outline-none ring-0 transition-colors hover:bg-gray-200/60 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0"
    >
      <div className="pointer-events-none h-12 w-1 shrink-0 rounded-full bg-gray-300/80" aria-hidden />
    </Separator>
  )
}

const NEW_SCHEMA_ID = '__new__'

export default function AgentTest02UI({ agent }: AgentTest02UIProps) {
  const [toast, setToast] = useState<string | null>(null)
  const [schemas, setSchemas] = useState<BiSchemaItem[]>([])
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>(NEW_SCHEMA_ID)
  const [leftCsvFile, setLeftCsvFile] = useState<File | null>(null)
  const [leftCsvPreviewRows, setLeftCsvPreviewRows] = useState<string[][]>([])
  const [schemaColumns, setSchemaColumns] = useState<SchemaColumn[]>([])
  const [schemaId, setSchemaId] = useState('')
  const [schemaName, setSchemaName] = useState('')
  const [schemaDesc, setSchemaDesc] = useState('')
  const [indicatorRows, setIndicatorRows] = useState<IndicatorRow[]>([])
  const [editorTab, setEditorTab] = useState<'schema' | 'indicator'>('schema')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteSchemaConfirmOpen, setDeleteSchemaConfirmOpen] = useState(false)

  const schemaFieldOptions = useMemo(
    () => schemaColumns.filter((c) => (c.columnName || '').trim() !== ''),
    [schemaColumns]
  )

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  useEffect(() => {
    setDeleteSchemaConfirmOpen(false)
  }, [selectedSchemaId])

  const loadSchemas = useCallback(() => {
    listBiSchemas()
      .then(setSchemas)
      .catch(() => setSchemas([]))
  }, [])

  useEffect(() => {
    loadSchemas()
  }, [loadSchemas])

  useEffect(() => {
    if (selectedSchemaId === NEW_SCHEMA_ID) {
      setSchemaId('')
      setSchemaName('')
      setSchemaDesc('')
      setIndicatorRows([])
      setSchemaColumns(leftCsvPreviewRows.length > 0 ? deriveSchemaFromCsv(leftCsvPreviewRows) : [])
    } else {
      getBiSchema(selectedSchemaId)
        .then((d) => {
          const sj = (d.schema_json ?? {}) as Record<string, unknown>
          setSchemaId(d.id)
          setSchemaName(d.name)
          setSchemaDesc(d.desc ?? '')
          setSchemaColumns(parseColumnsFromSchema(sj))
          setIndicatorRows(parseIndicatorsFromSchema(sj))
        })
        .catch(() => setToast('載入 Schema 失敗'))
    }
  }, [selectedSchemaId])

  useEffect(() => {
    if (leftCsvPreviewRows.length > 0 && selectedSchemaId === NEW_SCHEMA_ID) {
      setSchemaColumns(deriveSchemaFromCsv(leftCsvPreviewRows))
    }
  }, [leftCsvPreviewRows, selectedSchemaId])

  useEffect(() => {
    if (leftCsvFile && !schemaName && selectedSchemaId === NEW_SCHEMA_ID) {
      const base = leftCsvFile.name.replace(/\.csv$/i, '')
      setSchemaName(base)
    }
  }, [leftCsvFile, schemaName, selectedSchemaId])

  const updateSchemaColumn = useCallback((index: number, field: keyof SchemaColumn, value: string | SchemaColumn['dataType'] | SchemaColumn['attr']) => {
    setSchemaColumns((prev) =>
      prev.map((col, i) => (i === index ? { ...col, [field]: value } : col))
    )
  }, [])

  const addColumn = useCallback(() => {
    setSchemaColumns((prev) => [
      ...prev,
      { columnName: '', dataType: 'str', attr: 'dim', sampleData: '', aliases: '' },
    ])
  }, [])

  const removeColumn = useCallback((index: number) => {
    setSchemaColumns((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const buildSchemaJson = useCallback(
    (): Record<string, unknown> => ({
      id: schemaId || 'schema',
      name: schemaName || 'Schema',
      columns: buildColumnsToSchema(schemaColumns),
      dimension_hierarchy: {},
      aggregation: { default: 'sum' },
      indicators: buildIndicatorsToSchema(indicatorRows),
    }),
    [schemaId, schemaName, schemaColumns, indicatorRows]
  )

  const updateIndicatorRow = useCallback(
    (index: number, field: keyof IndicatorRow, value: string | boolean | [string, string]) => {
      setIndicatorRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
    },
    []
  )

  const patchIndicatorValueSlot = useCallback((rowIndex: number, slot: 0 | 1, col: string) => {
    setIndicatorRows((prev) =>
      prev.map((row, i) => {
        if (i !== rowIndex) return row
        const next: [string, string] = [row.valueComponents[0] ?? '', row.valueComponents[1] ?? '']
        next[slot] = col
        return { ...row, valueComponents: next }
      })
    )
  }, [])

  const addIndicatorRow = useCallback(() => {
    setIndicatorRows((prev) => [
      ...prev,
      { key: '', displayLabel: '', valueComponents: ['', ''], asPercent: false },
    ])
  }, [])

  const removeIndicatorRow = useCallback((index: number) => {
    setIndicatorRows((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleCreate = useCallback(async () => {
    if (!schemaName.trim()) {
      setToast('請填寫名稱')
      return
    }
    if (schemaColumns.length === 0) {
      setToast('請至少新增一個欄位')
      return
    }
    setSaving(true)
    try {
      const res = await createBiSchema({
        name: schemaName.trim(),
        desc: schemaDesc.trim() || undefined,
        schema_json: buildSchemaJson(),
      })
      setToast('新增成功')
      loadSchemas()
      setSelectedSchemaId(res.id)
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      setToast(err?.detail ?? err?.message ?? '新增失敗')
    } finally {
      setSaving(false)
    }
  }, [schemaName, schemaDesc, schemaColumns, buildSchemaJson, loadSchemas])

  const handleUpdate = useCallback(async () => {
    if (!selectedSchemaId || selectedSchemaId === NEW_SCHEMA_ID) return
    if (!schemaName.trim()) {
      setToast('請填寫名稱')
      return
    }
    if (schemaColumns.length === 0) {
      setToast('請至少保留一個欄位')
      return
    }
    setSaving(true)
    try {
      const sj = buildSchemaJson()
      sj.id = selectedSchemaId
      sj.name = schemaName.trim()
      await updateBiSchema(selectedSchemaId, {
        name: schemaName.trim(),
        desc: schemaDesc.trim() || undefined,
        schema_json: sj,
      })
      setToast('修改成功')
      loadSchemas()
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      setToast(err?.detail ?? err?.message ?? '修改失敗')
    } finally {
      setSaving(false)
    }
  }, [selectedSchemaId, schemaName, schemaDesc, schemaColumns, buildSchemaJson, loadSchemas])

  /** 統一存檔：新建 → createBiSchema；既有 → updateBiSchema（含 Schema 欄位與 Indicator） */
  const handleSave = useCallback(async () => {
    if (selectedSchemaId === NEW_SCHEMA_ID) {
      await handleCreate()
    } else {
      await handleUpdate()
    }
  }, [selectedSchemaId, handleCreate, handleUpdate])

  const handleConfirmDeleteSchema = useCallback(async () => {
    if (!selectedSchemaId || selectedSchemaId === NEW_SCHEMA_ID) {
      setDeleteSchemaConfirmOpen(false)
      return
    }
    setDeleting(true)
    try {
      await deleteBiSchema(selectedSchemaId)
      setToast('刪除成功')
      loadSchemas()
      setSelectedSchemaId(NEW_SCHEMA_ID)
      setSchemaColumns([])
      setSchemaId('')
      setSchemaName('')
      setSchemaDesc('')
      setDeleteSchemaConfirmOpen(false)
    } catch (e: unknown) {
      const err = e as { detail?: string; message?: string }
      setToast(err?.detail ?? err?.message ?? '刪除失敗')
    } finally {
      setDeleting(false)
    }
  }, [selectedSchemaId, loadSchemas])

  const leftCsvInputRef = useRef<HTMLInputElement>(null)
  const handleLeftCsvChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ext = file.name.toLowerCase().split('.').pop()
    if (ext !== 'csv') {
      setToast('僅支援 CSV 檔案')
      if (e.target) e.target.value = ''
      return
    }
    setLeftCsvFile(file)
    try {
      const rows = await parseCsvRows(file, 5)
      setLeftCsvPreviewRows(rows)
    } catch {
      setLeftCsvPreviewRows([])
      setToast('無法讀取 CSV')
    }
    if (e.target) e.target.value = ''
  }, [])

  return (
    <AgentPageLayout
      title={agent.agent_name}
      headerIcon={<AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />}
    >
      <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1 text-lg">
        {/* 左側：CSV 上傳與預覽 */}
        <Panel
          defaultSize={20}
          minSize={15}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
            <div>
              <label className="mb-1 block text-base font-medium text-gray-700">Schema</label>
              <select
                value={selectedSchemaId}
                onChange={(e) => setSelectedSchemaId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-base focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value={NEW_SCHEMA_ID}>— 新建 —</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.id})
                  </option>
                ))}
              </select>
            </div>
            <label className="text-base font-medium text-gray-700">上傳 CSV</label>
            <input
              ref={leftCsvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleLeftCsvChange}
            />
            <button
              type="button"
              onClick={() => leftCsvInputRef.current?.click()}
              className="rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-base text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-100"
            >
              {leftCsvFile ? leftCsvFile.name : '選擇 CSV 檔案'}
            </button>
            {leftCsvPreviewRows.length > 0 && (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                <span className="shrink-0 text-base font-medium text-gray-700">前 5 行預覽</span>
                <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-gray-200">
                  <table className="min-w-full border-collapse text-sm">
                    <tbody>
                      {leftCsvPreviewRows.map((row, i) => (
                        <tr key={i} className={i === 0 ? 'bg-gray-100 font-medium' : ''}>
                          {row.map((cell, j) => (
                            <td key={j} className="border-b border-gray-200 px-2 py-1.5 text-left">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Panel>
        <ResizeHandle />
        <Panel
          defaultSize={80}
          minSize={20}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <div className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-gray-200 pb-0">
              <div
                className="flex gap-1"
                role="tablist"
                aria-label="Schema 與 Indicator 編輯"
              >
                <button
                  type="button"
                  role="tab"
                  id="editor-tab-schema"
                  aria-selected={editorTab === 'schema'}
                  aria-controls="editor-panel-schema"
                  tabIndex={editorTab === 'schema' ? 0 : -1}
                  onClick={() => setEditorTab('schema')}
                  className={`relative -mb-px rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                    editorTab === 'schema'
                      ? 'border border-b-0 border-gray-200 bg-white text-blue-700'
                      : 'border border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  Schema
                </button>
                <button
                  type="button"
                  role="tab"
                  id="editor-tab-indicator"
                  aria-selected={editorTab === 'indicator'}
                  aria-controls="editor-panel-indicator"
                  tabIndex={editorTab === 'indicator' ? 0 : -1}
                  onClick={() => setEditorTab('indicator')}
                  className={`relative -mb-px rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
                    editorTab === 'indicator'
                      ? 'border border-b-0 border-gray-200 bg-white text-blue-700'
                      : 'border border-transparent text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`}
                >
                  Indicator
                </button>
              </div>
              <div className="mb-px flex shrink-0 items-center gap-2">
                {selectedSchemaId !== NEW_SCHEMA_ID && (
                  <button
                    type="button"
                    onClick={() => setDeleteSchemaConfirmOpen(true)}
                    disabled={deleting}
                    className="rounded-2xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                  >
                    刪除 Schema
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="rounded-2xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '儲存中…' : '存檔'}
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden rounded-b-xl border border-t-0 border-gray-200 bg-white shadow-sm">
            {editorTab === 'schema' ? (
            <section
              id="editor-panel-schema"
              role="tabpanel"
              aria-labelledby="editor-tab-schema"
              className="flex h-full min-h-0 flex-col overflow-hidden p-4"
            >
              <div className="shrink-0 space-y-4">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">名稱</label>
                    <input
                      type="text"
                      value={schemaName}
                      onChange={(e) => setSchemaName(e.target.value)}
                      className="w-48 rounded border border-gray-300 px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Schema 名稱"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
                    <input
                      type="text"
                      value={schemaDesc}
                      onChange={(e) => setSchemaDesc(e.target.value)}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Schema 描述（選填）"
                    />
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto pt-3">
                {schemaColumns.length === 0 ? (
                  <p className="py-8 text-center text-gray-500">請先在左側上傳 CSV，將自動帶入欄位定義</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={addColumn}
                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        + 新增欄位
                      </button>
                    </div>
                    <div className="overflow-auto rounded-lg border border-gray-200">
                      <table className="min-w-full border-collapse text-sm">
                        <thead className="sticky top-0 z-10 bg-gray-100">
                          <tr>
                            <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">欄位名稱</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">資料型態</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">屬性</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">範例資料</th>
                            <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">別名</th>
                            <th className="w-10 border-b border-gray-200 px-2 py-2" />
                          </tr>
                        </thead>
                        <tbody>
                          {schemaColumns.map((col, i) => (
                            <tr key={i} className="border-b border-gray-100 hover:bg-gray-50/80">
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={col.columnName}
                                  onChange={(e) => updateSchemaColumn(i, 'columnName', e.target.value)}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="欄位名稱"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={col.dataType}
                                  onChange={(e) => updateSchemaColumn(i, 'dataType', e.target.value as SchemaColumn['dataType'])}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  {DATA_TYPES.map((t) => (
                                    <option key={t} value={t}>{t}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={col.attr}
                                  onChange={(e) => updateSchemaColumn(i, 'attr', e.target.value as SchemaColumn['attr'])}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                >
                                  {ATTR_OPTIONS.map(({ value, label }) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={col.sampleData}
                                  onChange={(e) => updateSchemaColumn(i, 'sampleData', e.target.value)}
                                  className="w-full min-w-[8rem] rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="範例資料"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  type="text"
                                  value={col.aliases}
                                  onChange={(e) => updateSchemaColumn(i, 'aliases', e.target.value)}
                                  className="w-full min-w-[8rem] rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="以逗號分隔，如：營收, 銷售額"
                                />
                              </td>
                              <td className="px-2 py-2">
                                <button
                                  type="button"
                                  onClick={() => removeColumn(i)}
                                  className="rounded p-1 text-lg leading-none text-gray-500 hover:bg-red-100 hover:text-red-600"
                                  aria-label={`刪除欄位 ${col.columnName || i}`}
                                >
                                  ×
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </section>
            ) : (
            <section
              id="editor-panel-indicator"
              role="tabpanel"
              aria-labelledby="editor-tab-indicator"
              className="flex h-full min-h-0 flex-col overflow-hidden p-4"
            >
              <div className="mb-3 flex shrink-0 justify-end">
                <button
                  type="button"
                  onClick={addIndicatorRow}
                  className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  + 新增指標
                </button>
              </div>
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-auto">
                {indicatorRows.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-500">尚無指標，可點「新增指標」或載入既有 Schema</p>
                ) : (
                  <div className="overflow-auto rounded-lg border border-gray-200">
                    <table className="min-w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-10 bg-gray-100">
                        <tr>
                          <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">
                            指標 key
                          </th>
                          <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700">顯示名稱</th>
                          <th className="border-b border-gray-200 px-3 py-2 text-left font-medium text-gray-700 min-w-[22rem] w-[min(100%,40rem)]">
                            欄位（value_components）
                          </th>
                          <th className="border-b border-gray-200 px-3 py-2 text-center font-medium text-gray-700">
                            百分比
                          </th>
                          <th className="w-12 border-b border-gray-200 px-2 py-2 text-center font-medium text-gray-700">
                            刪除
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {indicatorRows.map((row, i) => (
                          <tr key={`indicator-${i}`} className="border-b border-gray-100 hover:bg-gray-50/80">
                            <td className="px-3 py-2 align-middle">
                              <input
                                type="text"
                                value={row.key}
                                onChange={(e) => updateIndicatorRow(i, 'key', e.target.value)}
                                className="w-full min-w-[5rem] rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="如 margin_rate"
                              />
                            </td>
                            <td className="px-3 py-2 align-middle">
                              <input
                                type="text"
                                value={row.displayLabel}
                                onChange={(e) => updateIndicatorRow(i, 'displayLabel', e.target.value)}
                                className="w-full min-w-[5rem] rounded border border-gray-300 px-2 py-1.5 text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                placeholder="顯示標籤"
                              />
                            </td>
                            <td className="min-w-0 px-3 py-2 align-middle">
                              {schemaFieldOptions.length === 0 ? (
                                <span className="text-xs text-amber-700">請先定義 Schema 欄位</span>
                              ) : (
                                <div className="w-full min-w-0 max-w-full">
                                  <div className="flex w-full min-w-[20rem] flex-nowrap items-center gap-x-2">
                                  <select
                                    value={row.valueComponents[0] ?? ''}
                                    onChange={(e) => patchIndicatorValueSlot(i, 0, e.target.value)}
                                    className={indicatorFieldSelectCompactClass}
                                    title="分子"
                                    aria-label="分子欄位"
                                  >
                                    <option value="">—</option>
                                    {schemaFieldOptions.map((col, j) => {
                                      const v = col.columnName.trim()
                                      return (
                                        <option key={`${v}-${j}`} value={v}>
                                          {columnSelectLabel(col)}
                                        </option>
                                      )
                                    })}
                                    {(row.valueComponents[0] ?? '').trim() &&
                                      !schemaFieldOptions.some(
                                        (c) => c.columnName.trim() === (row.valueComponents[0] ?? '').trim()
                                      ) && (
                                        <option value={(row.valueComponents[0] ?? '').trim()}>
                                          {(row.valueComponents[0] ?? '').trim()}（未列於 Schema）
                                        </option>
                                      )}
                                  </select>
                                  <span className="shrink-0 select-none text-sm text-gray-400" aria-hidden>
                                    /
                                  </span>
                                  <select
                                    value={row.valueComponents[1] ?? ''}
                                    onChange={(e) => patchIndicatorValueSlot(i, 1, e.target.value)}
                                    className={indicatorFieldSelectCompactClass}
                                    title="分母"
                                    aria-label="分母欄位"
                                  >
                                    <option value="">—</option>
                                    {schemaFieldOptions.map((col, j) => {
                                      const v = col.columnName.trim()
                                      return (
                                        <option key={`d-${v}-${j}`} value={v}>
                                          {columnSelectLabel(col)}
                                        </option>
                                      )
                                    })}
                                    {(row.valueComponents[1] ?? '').trim() &&
                                      !schemaFieldOptions.some(
                                        (c) => c.columnName.trim() === (row.valueComponents[1] ?? '').trim()
                                      ) && (
                                        <option value={(row.valueComponents[1] ?? '').trim()}>
                                          {(row.valueComponents[1] ?? '').trim()}（未列於 Schema）
                                        </option>
                                      )}
                                  </select>
                                  </div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-center align-middle">
                              <input
                                type="checkbox"
                                checked={row.asPercent}
                                onChange={(e) => updateIndicatorRow(i, 'asPercent', e.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                title="as_percent（百分比顯示）"
                              />
                            </td>
                            <td className="px-2 py-2 text-center align-middle">
                              <button
                                type="button"
                                onClick={() => removeIndicatorRow(i)}
                                className="rounded p-1 text-lg leading-none text-gray-500 hover:bg-red-100 hover:text-red-600"
                                aria-label={`刪除指標 ${row.key || i}`}
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                </div>
                <div className="mt-3 shrink-0 border-t border-gray-100 pt-3">
                  <p className="text-xs leading-relaxed text-gray-500">
                    <span className="font-medium text-gray-600">無須在此設定：</span>
                    動態佔比、YoY 成長率，以及與去年同期之對比，皆由分析引擎依查詢意圖與數值欄位自動計算；上表僅維護須明確定義分子／分母之指標（如毛利率、ROI）。
                  </p>
                </div>
              </div>
            </section>
            )}
            </div>
          </div>
        </Panel>
      </Group>
      <ConfirmModal
        open={deleteSchemaConfirmOpen}
        title="刪除 Schema"
        message={`確定要刪除 Schema「${schemaName || selectedSchemaId}」嗎？此操作無法復原。`}
        confirmText={deleting ? '刪除中…' : '刪除'}
        variant="danger"
        onConfirm={() => {
          if (!deleting) void handleConfirmDeleteSchema()
        }}
        onCancel={() => {
          if (!deleting) setDeleteSchemaConfirmOpen(false)
        }}
      />
      {toast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 max-w-[90vw] rounded-lg bg-red-600 px-4 py-2 text-lg text-white shadow-lg"
          role="alert"
        >
          {toast}
        </div>
      )}
    </AgentPageLayout>
  )
}
