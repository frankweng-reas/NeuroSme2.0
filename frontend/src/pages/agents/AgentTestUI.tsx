/** Test01 Agent 專用 UI：CSV → Schema Mapping → DuckDB */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Loader2 } from 'lucide-react'
import AgentIcon from '@/components/AgentIcon'
import AgentPageLayout from '@/components/AgentPageLayout'
import {
  getBiSalesSchema,
  getMappingTemplate,
  listMappingTemplates,
  saveMappingTemplate,
  suggestMapping,
  syncToDuckdb,
  transformCsv,
  type MappingTemplateItem,
  type SchemaField,
} from '@/api/test01'
import type { Agent } from '@/types'

interface AgentTestUIProps {
  agent: Agent
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

/** 由公式計算的欄位（不需 CSV 對應） */
const COMPUTED_FIELDS = new Set(['gross_amount', 'sales_amount', 'gross_profit'])

const NEW_TEMPLATE_VALUE = '__new__'

function toNum(val: unknown): number {
  if (val == null || val === '') return 0
  if (typeof val === 'number' && !Number.isNaN(val)) return val
  const s = String(val).trim().replace(/,/g, '')
  const n = parseFloat(s)
  return Number.isNaN(n) ? 0 : n
}

/** 依 mapping 與 schema 計算第一筆的衍生欄位值 */
function computeFirstRowDerived(
  csvFirstRow: Record<string, string>,
  mapping: Record<string, string>,
  schema: SchemaField[]
): Record<string, number> {
  const schemaByField = Object.fromEntries(schema.map((f) => [f.field, f]))
  const getVal = (field: string): number => {
    const col = mapping[field]
    const raw = col ? csvFirstRow[col] : (schemaByField[field]?.default ?? 0)
    return toNum(raw)
  }
  const unitPrice = getVal('unit_price')
  const quantity = getVal('quantity') || 1
  const discountAmount = getVal('discount_amount')
  const costAmount = getVal('cost_amount')
  const grossMapped = getVal('gross_amount')
  const salesMapped = getVal('sales_amount')
  const profitMapped = getVal('gross_profit')

  const grossAmount = grossMapped || unitPrice * quantity
  const salesAmount = salesMapped || grossAmount - discountAmount
  const grossProfit = profitMapped || salesAmount - costAmount

  return { gross_amount: grossAmount, sales_amount: salesAmount, gross_profit: grossProfit }
}

function parseCsvHeaders(csv: string): string[] {
  if (!csv?.trim()) return []
  const firstLine = csv.trim().split('\n')[0]
  if (!firstLine) return []
  return firstLine.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
}

/** 解析 CSV 第一筆資料（不含 header） */
function parseCsvFirstRow(csv: string): Record<string, string> {
  const lines = csv?.trim().split('\n').filter(Boolean) ?? []
  if (lines.length < 2) return {}
  const headers = parseCsvHeaders(csv)
  const values = lines[1].split(',').map((v) => v.trim().replace(/^"|"$/g, ''))
  const row: Record<string, string> = {}
  headers.forEach((h, i) => {
    row[h] = values[i] ?? ''
  })
  return row
}

export default function AgentTestUI({ agent }: AgentTestUIProps) {
  const [csvContent, setCsvContent] = useState('')
  const [schema, setSchema] = useState<SchemaField[]>([])
  const [schemaLoading, setSchemaLoading] = useState(true)
  const [schemaError, setSchemaError] = useState<string | null>(null)
  const [templates, setTemplates] = useState<MappingTemplateItem[]>([])
  const [selectedTemplateName, setSelectedTemplateName] = useState<string>('') // '' | template_name | NEW_TEMPLATE_VALUE
  const [newTemplateName, setNewTemplateName] = useState('')
  const [mapping, setMapping] = useState<Record<string, string>>({}) // schema_field -> csv_column
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [saveTemplateLoading, setSaveTemplateLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [suggestLastUsage, setSuggestLastUsage] = useState<{
    model: string
    input_tokens: number
    output_tokens: number
  } | null>(null)

  const csvHeaders = useMemo(() => parseCsvHeaders(csvContent), [csvContent])
  const csvFirstRow = useMemo(() => parseCsvFirstRow(csvContent), [csvContent])

  const loadTemplates = useCallback(() => {
    listMappingTemplates()
      .then(setTemplates)
      .catch(() => setTemplates([]))
  }, [])

  const handleSaveTemplate = async () => {
    const name =
      selectedTemplateName === NEW_TEMPLATE_VALUE ? newTemplateName.trim() : selectedTemplateName
    if (!name) {
      setToast('請輸入或選擇範本名稱')
      return
    }
    if (Object.keys(mapping).length === 0) {
      setToast('請先設定欄位對應（使用自動建議或手動選擇）')
      return
    }
    setSaveTemplateLoading(true)
    try {
      const saved = await saveMappingTemplate({
        template_name: name,
        mapping,
        csv_headers: csvHeaders.length > 0 ? csvHeaders : undefined,
      })
      setToast(`已儲存範本：${name}`)
      setMapping(saved.mapping ?? {})
      loadTemplates()
      if (selectedTemplateName === NEW_TEMPLATE_VALUE) {
        setSelectedTemplateName(name)
        setNewTemplateName('')
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : '儲存失敗')
    } finally {
      setSaveTemplateLoading(false)
    }
  }

  const handleTemplateChange = (value: string) => {
    setSelectedTemplateName(value)
    if (value === NEW_TEMPLATE_VALUE) {
      setNewTemplateName('')
      return
    }
    if (value === '') {
      setMapping({})
      return
    }
    getMappingTemplate(value)
      .then((t) => {
        const m = t.mapping && typeof t.mapping === 'object' ? t.mapping : {}
        setMapping({ ...m })
      })
      .catch(() => {
        setMapping({})
      })
  }

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  const computedValues = useMemo(
    () => computeFirstRowDerived(csvFirstRow, mapping, schema),
    [csvFirstRow, mapping, schema]
  )

  const loadSchema = () => {
    setSchemaError(null)
    setSchemaLoading(true)
    getBiSalesSchema()
      .then(setSchema)
      .catch((err) => {
        setSchema([])
        setSchemaError(err instanceof Error ? err.message : 'Schema 載入失敗')
      })
      .finally(() => setSchemaLoading(false))
  }

  useEffect(() => {
    loadSchema()
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const reverseMapping = useMemo(() => {
    const out: Record<string, string> = {}
    for (const [schemaField, csvCol] of Object.entries(mapping)) {
      if (csvCol) out[csvCol] = schemaField
    }
    return out
  }, [mapping])

  const handleApplySuggestions = async () => {
    if (!csvHeaders.length) return
    setSuggestLoading(true)
    setSuggestLastUsage(null)
    try {
      const res = await suggestMapping({ csv_headers: csvHeaders })
      setMapping((prev) => ({ ...prev, ...res.mapping }))
      setToast(`已建議 ${Object.keys(res.mapping).length} 個欄位對應`)
      if (
        res.model != null &&
        res.input_tokens != null &&
        res.output_tokens != null
      ) {
        setSuggestLastUsage({
          model: res.model,
          input_tokens: res.input_tokens,
          output_tokens: res.output_tokens,
        })
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'LLM 建議失敗')
    } finally {
      setSuggestLoading(false)
    }
  }

  const handlePreview = async () => {
    if (!csvContent.trim()) {
      setToast('請輸入 CSV 內容')
      return
    }
    setPreviewLoading(true)
    setPreviewRows(null)
    try {
      const res = await transformCsv({ csv_content: csvContent, mapping: reverseMapping })
      setPreviewRows(res.rows)
      setToast(`預覽：${res.row_count} 筆`)
    } catch (err) {
      setToast(err instanceof Error ? err.message : '預覽失敗')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleSync = async () => {
    if (!csvContent.trim()) {
      setToast('請輸入 CSV 內容')
      return
    }
    const templateName =
      selectedTemplateName === NEW_TEMPLATE_VALUE ? newTemplateName.trim() : selectedTemplateName
    setSyncLoading(true)
    try {
      const res = await syncToDuckdb({
        csv_content: csvContent,
        mapping: reverseMapping,
        template_name: templateName || undefined,
        csv_headers: csvHeaders.length > 0 ? csvHeaders : undefined,
      })
      setToast(res.message)
      if (res.ok && templateName) {
        loadTemplates()
        if (selectedTemplateName === NEW_TEMPLATE_VALUE) {
          setSelectedTemplateName(templateName)
          setNewTemplateName('')
        }
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : '同步失敗')
    } finally {
      setSyncLoading(false)
    }
  }

  const schemaDisplay = schema.length
    ? schema.map((f) => `- ${f.field} (${f.type})${f.required ? ' *' : ''}`).join('\n')
    : schemaError
      ? `載入失敗：${schemaError}`
      : '載入中...'

  return (
    <AgentPageLayout
      title={agent.agent_name}
      headerIcon={<AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />}
    >
      {toast && (
        <div
          className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-base text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      )}
      <Group orientation="horizontal" className="flex min-h-0 min-w-0 flex-1 gap-1 text-base">
        {/* 左邊容器 */}
        <Panel
          defaultSize={50}
          minSize={20}
          className="flex flex-col rounded-2xl border-2 border-gray-200 bg-white shadow-sm"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <label className="shrink-0 font-medium text-gray-700">CSV</label>
              <textarea
                className="min-h-0 flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 font-mono focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="貼上 CSV 內容（含 header）..."
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <label className="shrink-0 font-medium text-gray-700">Standard Schema</label>
              <textarea
                className="min-h-0 flex-1 resize-none rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                placeholder="Schema 載入中..."
                value={schemaDisplay}
                readOnly
              />
            </div>
          </div>
        </Panel>
        <ResizeHandle />
        {/* 右邊容器：Mapping */}
        <Panel
          defaultSize={50}
          minSize={20}
          className="flex flex-col overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-sm text-lg"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
            <div className="flex shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-gray-800">
                  {previewRows !== null ? '轉換預覽' : '欄位對應'}
                </h3>
                <div className="flex gap-2">
                {previewRows !== null && (
                  <button
                    type="button"
                    onClick={() => setPreviewRows(null)}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    返回
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleApplySuggestions}
                  disabled={suggestLoading || schemaLoading || csvHeaders.length === 0}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  {suggestLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '自動建議 (LLM)'}
                </button>
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewLoading || !csvContent.trim()}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  {previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '預覽'}
                </button>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncLoading || !csvContent.trim()}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {syncLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '匯入 DuckDB'}
                </button>
              </div>
              </div>
              {previewRows === null && (
                <div className="flex items-center gap-2">
                  <label className="shrink-0 text-gray-600">對應模板：</label>
                  <select
                    className="rounded border border-gray-300 px-2 py-1.5 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                    value={selectedTemplateName}
                    onChange={(e) => handleTemplateChange(e.target.value)}
                  >
                    <option value="">— 未選擇 —</option>
                    {templates.map((t) => (
                      <option key={t.template_name} value={t.template_name}>
                        {t.template_name}
                      </option>
                    ))}
                    <option value={NEW_TEMPLATE_VALUE}>建立新範本...</option>
                  </select>
                  {selectedTemplateName === NEW_TEMPLATE_VALUE && (
                    <>
                      <input
                        type="text"
                        placeholder="範本名稱（如：91app銷售報表）"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        className="min-w-[180px] rounded border border-gray-300 px-2 py-1.5 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                      />
                      <button
                        type="button"
                        onClick={handleSaveTemplate}
                        disabled={
                          saveTemplateLoading ||
                          Object.keys(mapping).length === 0 ||
                          !newTemplateName.trim()
                        }
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                      >
                        {saveTemplateLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : '儲存'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {previewRows !== null ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50">
                        {previewRows[0] &&
                          Object.keys(previewRows[0]).map((k) => (
                            <th key={k} className="px-2 py-2 text-left font-medium text-gray-700">
                              {k}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-b border-gray-100">
                          {Object.values(row).map((v, j) => (
                            <td key={j} className="px-2 py-1.5 text-gray-600">
                              {String(v ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previewRows.length > 10 && (
                    <p className="mt-2 text-gray-500">僅顯示前 10 筆，共 {previewRows.length} 筆</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {schemaLoading ? (
                    <p className="text-gray-500">載入 Schema...</p>
                  ) : schemaError ? (
                    <div className="space-y-2">
                      <p className="text-red-600">{schemaError}</p>
                      <button
                        type="button"
                        onClick={loadSchema}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                      >
                        重新載入
                      </button>
                    </div>
                  ) : (
                    <table className="min-w-full table-fixed border-collapse">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="w-2/5 px-2 py-1.5 text-left font-medium text-gray-600">系統欄位</th>
                          <th className="w-1/5 px-2 py-1.5 text-left font-medium text-gray-600">來源欄位</th>
                          <th className="w-2/5 px-2 py-1.5 text-left font-medium text-gray-600">內容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schema.map((f) => {
                          const selectedCol = mapping[f.field] ?? ''
                          const hasMapping = !!selectedCol
                          const isComputed = COMPUTED_FIELDS.has(f.field)
                          const schemaDefault =
                            f.default !== undefined && f.default !== null ? String(f.default) : ''
                          const csvValue = hasMapping ? (csvFirstRow[selectedCol] ?? '') : ''
                          const displayValue =
                            hasMapping && csvValue !== ''
                              ? csvValue
                              : isComputed
                                ? ''
                                : schemaDefault
                          const isDefault = !hasMapping && schemaDefault !== ''
                          const isMappedButEmpty = hasMapping && csvValue === '' && schemaDefault !== ''
                          const isComputedNoMapping = isComputed && !hasMapping
                          const computedVal = isComputed ? computedValues[f.field as keyof typeof computedValues] : undefined
                          const chineseName = f.aliases?.[0] ?? '—'
                          const systemFieldLabel = `${f.field} (${chineseName})`
                          return (
                            <tr key={f.field} className="border-b border-gray-100">
                              <td className="px-2 py-1.5 text-gray-700">
                                {systemFieldLabel}
                                {f.required && <span className="text-red-500">*</span>}
                              </td>
                              <td className="px-2 py-1.5">
                                <select
                                  className="w-full min-w-0 rounded border border-gray-300 px-2 py-1.5 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                                  value={selectedCol}
                                  onChange={(e) =>
                                    setMapping((prev) => {
                                      const next = { ...prev }
                                      if (e.target.value) next[f.field] = e.target.value
                                      else delete next[f.field]
                                      return next
                                    })
                                  }
                                >
                                  <option value="">— 不對應 —</option>
                                  {csvHeaders.map((h) => (
                                    <option key={h} value={h}>
                                      {h}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td
                                className="truncate px-2 py-1.5 text-gray-500"
                                title={
                                  isComputedNoMapping
                                    ? `由公式計算：${computedVal ?? '—'}`
                                    : isDefault || isMappedButEmpty
                                      ? `預設：${displayValue}`
                                      : displayValue
                                }
                              >
                                {isComputedNoMapping ? (
                                  <>
                                    {computedVal != null ? String(computedVal) : '—'}
                                    <span className="ml-1 text-gray-400">(計算)</span>
                                  </>
                                ) : displayValue ? (
                                  <>
                                    {displayValue}
                                    {(isDefault || isMappedButEmpty) && (
                                      <span className="ml-1 text-gray-400">(預設)</span>
                                    )}
                                  </>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 border-t border-gray-200 pt-3">
              {suggestLastUsage ? (
                <div className="flex items-center gap-4 text-gray-500">
                  <span>Model: {suggestLastUsage.model}</span>
                  <span>Input tokens: {suggestLastUsage.input_tokens.toLocaleString()}</span>
                  <span>Output tokens: {suggestLastUsage.output_tokens.toLocaleString()}</span>
                </div>
              ) : (
                <div className="text-gray-400">自動建議後顯示 LLM 用量</div>
              )}
            </div>
          </div>
        </Panel>
      </Group>
    </AgentPageLayout>
  )
}
