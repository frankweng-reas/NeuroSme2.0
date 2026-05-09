/** OCR Agent UI：文件欄位抽取 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  Download,
  FileText,
  GripVertical,
  ImageIcon,
  Layers as LayersIcon,
  Loader2,
  Maximize2,
  Pencil,
  Plus,
  Save,
  ScanText,
  Table2,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  createOcrConfig,
  deleteOcrConfig,
  deleteOcrHistoryItem,
  extractOcr,
  listOcrConfigs,
  listOcrHistory,
  listOcrTemplates,
  updateOcrConfig,
  updateOcrHistoryFields,
  type OcrConfig,
  type OcrHistoryItem,
  type OcrOutputField,
  type OcrTemplate,
} from '@/api/ocr'
import { ApiError } from '@/api/client'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent } from '@/types'

const HEADER_COLOR = '#1C3939'
const SIDEBAR_BG = '#1C3939'
const STORAGE_KEY_PREFIX = 'neurosme-ocr-agent'

function storageKey(agentId: string) {
  return `${STORAGE_KEY_PREFIX}-${agentId}`
}

interface AgentOcrUIProps {
  agent: Agent
}

export default function AgentOcrUI({ agent }: AgentOcrUIProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [configs, setConfigs] = useState<OcrConfig[]>([])
  const [templates, setTemplates] = useState<OcrTemplate[]>([])
  const [selectedConfig, setSelectedConfig] = useState<OcrConfig | null>(null)
  const [history, setHistory] = useState<OcrHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  // config form
  const [showConfigForm, setShowConfigForm] = useState(false)
  const [editingConfig, setEditingConfig] = useState<OcrConfig | null>(null)
  const [configForm, setConfigForm] = useState({ name: '', data_type_label: '', model: '' })
  const [fields, setFields] = useState<OcrOutputField[]>([])
  const [savingConfig, setSavingConfig] = useState(false)
  const [showTemplateMenu, setShowTemplateMenu] = useState(false)
  const [deleteConfigTarget, setDeleteConfigTarget] = useState<OcrConfig | null>(null)

  // extraction
  const [extracting, setExtracting] = useState(false)
  const [latestResult, setLatestResult] = useState<OcrHistoryItem | null>(null)
  const [editableFields, setEditableFields] = useState<Record<string, string>>({})
  const [splitPct, setSplitPct] = useState(50)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  function onDividerMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    isDraggingRef.current = true
    const container = splitContainerRef.current
    if (!container) return
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return
      const rect = container.getBoundingClientRect()
      const pct = Math.min(80, Math.max(20, ((ev.clientX - rect.left) / rect.width) * 100))
      setSplitPct(pct)
    }
    const onUp = () => {
      isDraggingRef.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  const [fieldsSaved, setFieldsSaved] = useState(false)
  const [fieldsSaving, setFieldsSaving] = useState(false)
  const [copiedFields, setCopiedFields] = useState(false)
  const [copyWithHeader, setCopyWithHeader] = useState(false)
  const [copiedBatch, setCopiedBatch] = useState(false)
  const [copyBatchWithHeader, setCopyBatchWithHeader] = useState(true)
  // 歷史記錄 modal
  const [historyTab, setHistoryTab] = useState<'timeline' | 'table'>('timeline')
  const [selectedHistIds, setSelectedHistIds] = useState<Set<number>>(new Set())
  const [showPreview, setShowPreview] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [, setFileStatuses] = useState<Record<string, 'pending' | 'processing' | 'done' | 'error'>>({})
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // history
  const [deleteHistTarget, setDeleteHistTarget] = useState<OcrHistoryItem | null>(null)

  const [showHelpModal, setShowHelpModal] = useState(false)

  // Lightbox
  const [showLightbox, setShowLightbox] = useState(false)
  const [lbScale, setLbScale] = useState(1)
  const [lbOffset, setLbOffset] = useState({ x: 0, y: 0 })
  const lbDragRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  function openLightbox() { setShowLightbox(true); setLbScale(1); setLbOffset({ x: 0, y: 0 }) }
  function onLbWheel(e: React.WheelEvent) {
    e.preventDefault()
    setLbScale((s) => Math.min(8, Math.max(0.2, s - e.deltaY * 0.001)))
  }
  function onLbMouseDown(e: React.MouseEvent) {
    lbDragRef.current = { startX: e.clientX, startY: e.clientY, ox: lbOffset.x, oy: lbOffset.y }
  }
  function onLbMouseMove(e: React.MouseEvent) {
    if (!lbDragRef.current) return
    const { startX, startY, ox, oy } = lbDragRef.current
    setLbOffset({ x: ox + e.clientX - startX, y: oy + e.clientY - startY })
  }
  function onLbMouseUp() { lbDragRef.current = null }

  // error
  const [error, setError] = useState<string | null>(null)

  // ── Batch ──────────────────────────────────────────────────────────────────
  interface BatchRow {
    file: File
    status: 'pending' | 'processing' | 'done' | 'error'
    historyId: number | null
    fields: Record<string, string>
    error?: string
  }
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [batchFiles, setBatchFiles] = useState<File[]>([])
  const [batchRows, setBatchRows] = useState<BatchRow[]>([])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchDone, setBatchDone] = useState(false)
  const batchFileInputRef = useRef<HTMLInputElement>(null)

  function openBatchModal() {
    setBatchFiles([])
    setBatchRows([])
    setBatchDone(false)
    setShowBatchModal(true)
  }

  function handleBatchFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (!files.length) return
    setBatchFiles(files)
    setBatchRows(files.map((f) => ({ file: f, status: 'pending' as const, historyId: null, fields: {} })))
    setBatchDone(false)
  }

  async function runBatch(files: File[]) {
    if (!selectedConfig || files.length === 0) return
    setBatchRows(files.map((f) => ({ file: f, status: 'pending' as const, historyId: null, fields: {} })))
    setBatchRunning(true)
    setBatchDone(false)
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'processing' as const } : r))
      try {
        const result = await extractOcr(selectedConfig.id, file)
        const fields: Record<string, string> = {}
        for (const f of selectedConfig.output_fields) {
          const v = result.extracted_fields[f.name]
          fields[f.name] = v !== null && v !== undefined ? String(v) : ''
        }
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'done' as const, historyId: result.id, fields } : r))
      } catch (err) {
        const msg = err instanceof ApiError ? (err.detail ?? err.message) : '辨識失敗'
        setBatchRows((prev) => prev.map((r, idx) => idx === i ? { ...r, status: 'error' as const, error: msg } : r))
      }
    }
    setBatchRunning(false)
    setBatchDone(true)
    void loadHistory(selectedConfig.id)
  }

  function handleCopyFields() {
    if (!selectedConfig) return
    const headers = selectedConfig.output_fields.map((f) => f.name)
    const values = selectedConfig.output_fields.map((f) => editableFields[f.name] ?? '')
    const rows = copyWithHeader ? [headers, values] : [values]

    // text/plain（tab 分隔）
    const plainText = rows.map((r) => r.join('\t')).join('\n') + '\n'

    // text/html（table 格式，確保 Numbers / Excel 正確展開欄位）
    const htmlTable =
      `<table><tbody>${rows.map((r) =>
        `<tr>${r.map((v) => `<td>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`).join('')}</tr>`
      ).join('')}</tbody></table>`

    const write = async () => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
            'text/html': new Blob([htmlTable], { type: 'text/html' }),
          }),
        ])
      } catch {
        // fallback：只寫 plain text
        await navigator.clipboard.writeText(plainText)
      }
      setCopiedFields(true)
      setTimeout(() => setCopiedFields(false), 2000)
    }
    void write()
  }

  function exportSelectedHistoryCsv() {
    if (!selectedConfig || selectedHistIds.size === 0) return
    const cols = selectedConfig.output_fields.map((f) => f.name)
    const header = ['時間', '檔案名稱', ...cols]
    const rows = history
      .filter((h) => selectedHistIds.has(h.id))
      .map((h) => [
        h.created_at ? new Date(h.created_at).toLocaleString('zh-TW') : '',
        h.filename,
        ...cols.map((c) => String(h.extracted_fields?.[c] ?? '')),
      ])
    const csv = [header, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedConfig.name}_選取匯出.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportBatchCsv() {
    if (!selectedConfig) return
    const cols = selectedConfig.output_fields.map((f) => f.name)
    const header = ['檔案名稱', ...cols, '狀態']
    const rowData = batchRows.map((r) => [
      r.file.name,
      ...cols.map((c) => r.fields[c] ?? ''),
      r.status === 'done' ? '完成' : r.status === 'error' ? `失敗: ${r.error ?? ''}` : r.status,
    ])
    const csv = [header, ...rowData]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedConfig.name}_批次結果.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function copyBatchData() {
    if (!selectedConfig) return
    const cols = selectedConfig.output_fields.map((f) => f.name)
    const doneRows = batchRows.filter((r) => r.status === 'done')
    const dataRows = doneRows.map((r) => [...cols.map((c) => r.fields[c] ?? '')])
    const headerRow = [...cols]
    const rows = copyBatchWithHeader ? [headerRow, ...dataRows] : dataRows

    const plainText = rows.map((r) => r.join('\t')).join('\n') + '\n'
    const htmlTable =
      `<table><tbody>${rows.map((r) =>
        `<tr>${r.map((v) => `<td>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</td>`).join('')}</tr>`
      ).join('')}</tbody></table>`

    const write = async () => {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plainText], { type: 'text/plain' }),
            'text/html': new Blob([htmlTable], { type: 'text/html' }),
          }),
        ])
      } catch {
        await navigator.clipboard.writeText(plainText)
      }
      setCopiedBatch(true)
      setTimeout(() => setCopiedBatch(false), 2000)
    }
    void write()
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  const loadConfigs = useCallback(async () => {
    try {
      const [cfgs, tmpls] = await Promise.all([listOcrConfigs(), listOcrTemplates()])
      setConfigs(cfgs)
      setTemplates(tmpls)
      if (!selectedConfig && cfgs.length > 0) {
        // 嘗試從 localStorage 恢復上次選擇的 config
        try {
          const raw = localStorage.getItem(storageKey(agent.id))
          const saved = raw ? JSON.parse(raw) : null
          const restored = saved?.configId ? cfgs.find(c => c.id === saved.configId) : null
          setSelectedConfig(restored ?? cfgs[0])
        } catch {
          setSelectedConfig(cfgs[0])
        }
      } else if (selectedConfig) {
        // 同步更新 selectedConfig，避免編輯後顯示舊資料
        const updated = cfgs.find(c => c.id === selectedConfig.id)
        if (updated) setSelectedConfig(updated)
      }
    } catch {
      /* ignore */
    }
  }, [selectedConfig, agent.id])

  useEffect(() => { void loadConfigs() }, [])

  const loadHistory = useCallback(async (configId: number) => {
    setLoadingHistory(true)
    try {
      const items = await listOcrHistory(configId)
      setHistory(items)
    } catch {
      setHistory([])
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    if (selectedConfig) {
      setLatestResult(null)
      setEditableFields({})
      setShowPreview(false)
      setPreviewUrl(null)
      setPendingFiles([])
      setFileStatuses({})
      void loadHistory(selectedConfig.id)
    }
  }, [selectedConfig, loadHistory])

  // ── Config Form ───────────────────────────────────────────────────────────

  function openCreateConfig() {
    setEditingConfig(null)
    setConfigForm({ name: '', data_type_label: '', model: '' })
    setFields([{ name: '', hint: '' }])
    setShowConfigForm(true)
  }

  function openEditConfig(cfg: OcrConfig) {
    setEditingConfig(cfg)
    setConfigForm({ name: cfg.name, data_type_label: cfg.data_type_label, model: cfg.model })
    setFields(cfg.output_fields.length > 0 ? cfg.output_fields : [{ name: '', hint: '' }])
    setShowConfigForm(true)
  }

  function applyTemplate(tpl: OcrTemplate) {
    setConfigForm((f) => ({ ...f, data_type_label: tpl.data_type_label }))
    setFields(tpl.fields.map((f) => ({ name: f.name, hint: f.hint })))
    setShowTemplateMenu(false)
  }

  function addField() {
    setFields((prev) => [...prev, { name: '', hint: '' }])
  }

  function removeField(idx: number) {
    setFields((prev) => prev.filter((_, i) => i !== idx))
  }

  function moveField(idx: number, dir: -1 | 1) {
    setFields((prev) => {
      const next = [...prev]
      const target = idx + dir
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  function updateField(idx: number, key: keyof OcrOutputField, value: string) {
    setFields((prev) => prev.map((f, i) => i === idx ? { ...f, [key]: value } : f))
  }

  async function handleSaveConfig() {
    if (!configForm.name.trim()) { setError('請填寫設定名稱'); return }
    const validFields = fields.filter((f) => f.name.trim())
    if (validFields.length === 0) { setError('至少需要一個輸出欄位'); return }
    setSavingConfig(true)
    setError(null)
    try {
      const body = {
        name: configForm.name.trim(),
        data_type_label: configForm.data_type_label.trim(),
        model: configForm.model,
        output_fields: validFields,
      }
      if (editingConfig) {
        await updateOcrConfig(editingConfig.id, body)
      } else {
        await createOcrConfig(body)
      }
      setShowConfigForm(false)
      await loadConfigs()
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗')
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleDeleteConfig() {
    if (!deleteConfigTarget) return
    try {
      await deleteOcrConfig(deleteConfigTarget.id)
      if (selectedConfig?.id === deleteConfigTarget.id) setSelectedConfig(null)
      setDeleteConfigTarget(null)
      await loadConfigs()
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : '刪除失敗')
    }
  }

  // ── Extraction ────────────────────────────────────────────────────────────

  function fileKey(f: File) { return `${f.name}__${f.size}` }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    e.target.value = ''
    queueFiles(files)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files ?? [])
    if (!files.length) return
    queueFiles([files[0]])
  }

  function queueFiles(files: File[]) {
    setPendingFiles(files)
    const initStatuses: Record<string, 'pending' | 'processing' | 'done' | 'error'> = {}
    files.forEach((f) => { initStatuses[fileKey(f)] = 'pending' })
    setFileStatuses(initStatuses)
    // 建立第一個檔案的預覽
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    const first = files[0]
    setPreviewUrl(URL.createObjectURL(first))
  }

  async function saveFields() {
    if (!selectedConfig || !latestResult) return
    setFieldsSaving(true)
    setFieldsSaved(false)
    try {
      const payload: Record<string, string | null> = {}
      for (const f of selectedConfig.output_fields) {
        const v = editableFields[f.name]
        payload[f.name] = v !== undefined && v !== '' ? v : null
      }
      await updateOcrHistoryFields(selectedConfig.id, latestResult.id, payload)
      setFieldsSaved(true)
      setTimeout(() => setFieldsSaved(false), 3000)
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗')
    } finally {
      setFieldsSaving(false)
    }
  }

  async function runExtractAll(files: File[]) {
    if (!selectedConfig) return

    setExtracting(true)
    setError(null)

    try {
      for (const file of files) {
        const k = fileKey(file)
        setFileStatuses((prev) => ({ ...prev, [k]: 'processing' }))
        try {
          const result = await extractOcr(selectedConfig.id, file)
          setLatestResult(result)
          const init: Record<string, string> = {}
          for (const f of selectedConfig.output_fields) {
            const v = result.extracted_fields[f.name]
            init[f.name] = v !== null && v !== undefined ? String(v) : ''
          }
          setEditableFields(init)
          setFieldsSaved(false)
          setFileStatuses((prev) => ({ ...prev, [k]: 'done' }))
        } catch (err) {
          setFileStatuses((prev) => ({ ...prev, [k]: 'error' }))
          setError(err instanceof ApiError ? (err.detail ?? err.message) : '辨識失敗')
        }
      }
      await loadHistory(selectedConfig.id)
    } finally {
      setExtracting(false)
    }
  }

  // 「開始辨識」：先關窗，主畫面再跑辨識
  function handleStartExtract() {
    setShowUploadModal(false)
    void runExtractAll(pendingFiles)
  }

  // ── History delete ────────────────────────────────────────────────────────

  async function handleDeleteHist() {
    if (!deleteHistTarget || !selectedConfig) return
    try {
      await deleteOcrHistoryItem(selectedConfig.id, deleteHistTarget.id)
      setDeleteHistTarget(null)
      await loadHistory(selectedConfig.id)
    } catch {
      /* ignore */
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-ocr-agent.md"
        title="OCR / Vision 使用說明"
      />
      <AgentHeader agent={agent} headerBackgroundColor={HEADER_COLOR} onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* ── 左欄：設定管理 ── */}
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${sidebarCollapsed ? 'w-12' : 'w-64'}`}
          style={{ backgroundColor: SIDEBAR_BG }}
        >
          {/* Header */}
          <div className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${sidebarCollapsed ? 'px-2' : 'pl-5 pr-3'}`}>
            {sidebarCollapsed ? (
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10 transition-colors"
                title="展開設定列表"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <>
                <span className="text-base font-semibold text-white/90">OCR 設定</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={openCreateConfig}
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-base font-medium text-white hover:bg-white/20 transition-colors"
                  >
                    <Plus className="h-3.5 w-3.5" /> 新增
                  </button>
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="rounded-2xl px-1.5 py-1 text-white/80 hover:bg-white/10 transition-colors"
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
              {configs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center px-4">
                  <ScanText className="h-8 w-8 text-white/20" />
                  <p className="text-base text-white/50">尚無設定</p>
                  <p className="text-base text-white/30">點擊「新增」建立第一個 OCR 設定</p>
                </div>
              ) : (
                <ul className="min-h-0 flex-1 overflow-y-auto p-2 space-y-1">
                  {configs.map((cfg) => (
                    <li
                      key={cfg.id}
                      onClick={() => {
                        setSelectedConfig(cfg)
                        try { localStorage.setItem(storageKey(agent.id), JSON.stringify({ configId: cfg.id })) } catch { /* ignore */ }
                      }}
                      className={`group flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 transition-colors ${
                        selectedConfig?.id === cfg.id
                          ? 'bg-sky-800 text-white'
                          : 'text-white/75 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-base font-medium">{cfg.name}</p>
                        {cfg.data_type_label && (
                          <p className="truncate text-base text-white/50">{cfg.data_type_label}</p>
                        )}
                        <p className="text-base text-white/30">{cfg.output_fields.length} 個欄位</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEditConfig(cfg) }}
                          className="rounded p-1 text-white/40 hover:text-white hover:bg-white/10"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteConfigTarget(cfg) }}
                          className="rounded p-1 text-white/40 hover:text-red-400 hover:bg-white/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── 右欄：上傳 + 結果 + 歷史 ── */}
        <div className="flex min-h-0 flex-1 flex-col">
          {!selectedConfig ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <ScanText className="h-12 w-12 text-gray-200" />
              <p className="text-gray-400">請從左側選擇或建立一個 OCR 設定</p>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4 pb-4">
              {/* Config info bar */}
              <div className="flex items-center justify-between rounded-xl bg-sky-800 px-5 py-3 shadow-sm">
                <div className="flex items-center gap-3">
                  <ScanText className="h-5 w-5 text-white/70" />
                  <div>
                    <span className="font-semibold text-white">{selectedConfig.name}</span>
                    {selectedConfig.data_type_label && (
                      <span className="ml-2 rounded-full bg-white/20 px-2 py-0.5 text-base text-white">
                        {selectedConfig.data_type_label}
                      </span>
                    )}
                  </div>
                  <span className="text-base text-white/70 font-mono">{selectedConfig.model || '未選擇模型'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowUploadModal(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-base text-white hover:bg-white/25 transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" /> 上傳檔案
                  </button>
                  <button
                    onClick={openBatchModal}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600/80 px-3 py-1.5 text-base text-white hover:bg-emerald-600 transition-colors"
                  >
                    <LayersIcon className="h-3.5 w-3.5" /> 批次辨識
                  </button>
                  <button
                    onClick={() => setShowHistoryModal(true)}
                    className="flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-base text-white hover:bg-white/25 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" /> 歷史紀錄
                    {history.length > 0 && (
                      <span className="rounded-full bg-white/30 px-1.5 text-base">{history.length}</span>
                    )}
                  </button>
                  <button
                    onClick={() => openEditConfig(selectedConfig)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-base text-white/80 hover:bg-white/20 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 編輯設定
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-base text-red-700 flex items-center justify-between">
                  <span>{error}</span>
                  <button onClick={() => setError(null)}><X className="h-4 w-4" /></button>
                </div>
              )}

              {/* 辨識結果區 — 左右兩個獨立容器 */}
              <div ref={splitContainerRef} className="flex min-h-0 flex-1 gap-0">

                {/* 左：原始文字 or 預覽圖 */}
                <div className="flex min-h-0 flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden" style={{ width: `${splitPct}%` }}>
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <span className="text-base font-medium text-gray-600">
                      {showPreview ? '預覽圖片' : '原始文字'}
                    </span>
                    <div className="flex items-center gap-2">
                      {latestResult && (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-base text-emerald-700">
                          {latestResult.filename}
                        </span>
                      )}
                      {latestResult && previewUrl && (
                        <>
                          <button
                            onClick={() => setShowPreview((v) => !v)}
                            title={showPreview ? '顯示原始文字' : '顯示預覽圖片'}
                            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1 text-base transition-colors ${
                              showPreview
                                ? 'border-sky-300 bg-sky-50 text-sky-700'
                                : 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50'
                            }`}
                          >
                            <ImageIcon className="h-3.5 w-3.5" />
                            {showPreview ? '文字' : '圖片'}
                          </button>
                          {showPreview && (
                            <button
                              onClick={openLightbox}
                              title="全螢幕檢視"
                              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-500 hover:bg-gray-50 transition-colors"
                            >
                              <Maximize2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </>
                      )}
                      {extracting && (
                        <span className="flex items-center gap-1.5 text-base text-blue-600">
                          <Loader2 className="h-4 w-4 animate-spin" /> 辨識中...
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col px-4 py-4">
                    {showPreview ? (
                      <div className="flex items-center justify-center rounded-lg border border-gray-100 bg-gray-50" style={{ minHeight: '16rem' }}>
                        <img src={previewUrl!} alt="預覽" className="max-h-[20rem] w-full rounded object-contain" />
                      </div>
                    ) : (
                      <textarea
                        readOnly
                        value={latestResult?.raw_text ?? ''}
                        placeholder={extracting ? '辨識中，請稍候...' : '上傳圖片後，辨識結果將顯示在這裡'}
                        className="h-full w-full resize-none rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-base text-gray-700 placeholder:text-gray-300 focus:outline-none"
                      />
                    )}
                  </div>
                  {latestResult?.usage && (
                    <div className="border-t border-gray-100 px-4 py-2.5 font-mono text-base text-gray-400">
                      model: {selectedConfig.model}
                      {' · '}prompt: {latestResult.usage.prompt_tokens}
                      {' · '}completion: {latestResult.usage.completion_tokens}
                      {' · '}total: {latestResult.usage.total_tokens}
                    </div>
                  )}
                </div>

                {/* 拖拉分隔線 */}
                <div
                  onMouseDown={onDividerMouseDown}
                  className="group relative z-10 flex w-3 shrink-0 cursor-col-resize items-center justify-center"
                >
                  <div className="h-full w-px bg-gray-200 group-hover:bg-sky-400 transition-colors" />
                  <div className="absolute flex h-6 w-3 items-center justify-center rounded-full bg-gray-200 group-hover:bg-sky-400 transition-colors">
                    <div className="h-3 w-0.5 rounded-full bg-white/80" />
                  </div>
                </div>

                {/* 右：指定欄位（可編輯） */}
                <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <span className="text-base font-medium text-gray-600">指定欄位</span>
                    <div className="flex items-center gap-2">
                    {latestResult && selectedConfig.output_fields.length > 0 && (
                      <label className="flex items-center gap-1.5 cursor-pointer select-none text-base text-gray-500">
                        <input
                          type="checkbox"
                          checked={copyWithHeader}
                          onChange={(e) => setCopyWithHeader(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-gray-300 accent-sky-600"
                        />
                        包含名稱
                      </label>
                    )}
                    {latestResult && selectedConfig.output_fields.length > 0 && (
                      <button
                        onClick={handleCopyFields}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 shadow-sm hover:bg-gray-50"
                        title="複製欄位（可貼到 Excel）"
                      >
                        {copiedFields ? (
                          <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Clipboard className="h-3.5 w-3.5" />
                        )}
                        {copiedFields ? '已複製' : '複製'}
                      </button>
                    )}
                    {latestResult && selectedConfig.output_fields.length > 0 && (
                      <button
                        onClick={saveFields}
                        disabled={fieldsSaving}
                        className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-base text-gray-600 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                      >
                        {fieldsSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : fieldsSaved ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        {fieldsSaved ? '已儲存' : '儲存'}
                      </button>
                    )}
                    </div>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
                    {selectedConfig.output_fields.length === 0 ? (
                      <p className="text-base text-gray-300">尚未設定輸出欄位</p>
                    ) : (
                      <div className="space-y-2 pr-1">
                          {selectedConfig.output_fields.map((f) => (
                            <div key={f.name}>
                              <label className="mb-0.5 block text-base font-mono text-gray-500">{f.name}</label>
                              <input
                                type="text"
                                value={editableFields[f.name] ?? ''}
                                onChange={(e) => setEditableFields((prev) => ({ ...prev, [f.name]: e.target.value }))}
                                placeholder={f.hint || '—'}
                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-base text-gray-700 placeholder:text-gray-300 focus:border-blue-300 focus:outline-none focus:ring-1 focus:ring-blue-200"
                              />
                            </div>
                          ))}
                        </div>
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}
        </div>
      </div>

      {/* ── Modal：上傳檔案 ── */}
      {showUploadModal && selectedConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="font-semibold text-gray-800">上傳檔案 — {selectedConfig.name}</h3>
              <button onClick={() => { if (!extracting) setShowUploadModal(false) }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-6 py-2.5">
              <span className="text-sm text-gray-500 shrink-0">已選擇檔案：</span>
              {pendingFiles.length > 0 ? (
                <span className="truncate text-sm font-medium text-gray-800">{pendingFiles[0].name}</span>
              ) : (
                <span className="text-sm text-gray-400">尚未上傳</span>
              )}
            </div>
            <div className="grid grid-cols-2 divide-x divide-gray-100">
              {/* 左：上傳區 + 佇列 */}
              <div className="flex flex-col">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => void handleDrop(e)}
                  onClick={() => !extracting && fileInputRef.current?.click()}
                  className={`flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 transition-colors ${extracting ? 'bg-blue-50 cursor-wait' : 'hover:bg-blue-50/30'}`}
                >
                  {extracting ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                      <p className="text-base text-blue-600 font-medium">辨識中，請稍候...</p>
                    </>
                  ) : (
                    <>
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-gray-200">
                        <Upload className="h-6 w-6 text-gray-300" />
                      </div>
                      <p className="text-base text-gray-500">拖曳或點擊上傳</p>
                      <p className="text-base text-gray-300">支援 JPG、PNG、WebP（上限 20 MB）</p>
                    </>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => void handleFileChange(e)} />
              </div>
              {/* 右：預覽 */}
              <div className="flex items-center justify-center bg-gray-50 p-4" style={{ minHeight: '16rem' }}>
                {previewUrl ? (
                  <img src={previewUrl} alt="預覽" className="max-h-64 w-full rounded object-contain shadow-sm" />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-200">
                    <FileText className="h-12 w-12" />
                    <p className="text-base text-gray-300">尚未選擇檔案</p>
                  </div>
                )}
              </div>
            </div>
            {pendingFiles.length > 0 && !extracting && (
              <div className="flex justify-center border-t border-gray-100 px-6 py-4">
                <button
                  onClick={handleStartExtract}
                  className="rounded-lg bg-sky-800 px-5 py-2 text-base font-medium text-white hover:bg-sky-700 transition-colors"
                >
                  開始辨識
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal：歷史紀錄 ── */}
      {showHistoryModal && selectedConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl" style={{ maxHeight: '80vh' }}>
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="font-semibold text-gray-800">歷史紀錄 — {selectedConfig.name}</h3>
              <button onClick={() => setShowHistoryModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            {/* Tab 切換 */}
            <div className="flex shrink-0 border-b border-gray-100 px-6">
              <button
                onClick={() => setHistoryTab('timeline')}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-base transition-colors ${historyTab === 'timeline' ? 'border-sky-600 font-medium text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <FileText className="h-4 w-4" /> 時間軸
              </button>
              <button
                onClick={() => { setHistoryTab('table'); setSelectedHistIds(new Set()) }}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-base transition-colors ${historyTab === 'table' ? 'border-sky-600 font-medium text-sky-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
              >
                <Table2 className="h-4 w-4" /> 表格 / 匯出
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12 text-gray-400">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" /> 載入中...
                </div>
              ) : history.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-300">
                  <FileText className="h-10 w-10" />
                  <p className="text-base">尚無歷史紀錄</p>
                </div>
              ) : historyTab === 'timeline' ? (
                <ul className="divide-y divide-gray-100">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-start justify-between gap-4 px-6 py-4 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-base font-medium text-gray-800">{h.filename}</p>
                        <p className="mt-0.5 text-base text-gray-400">{h.created_at ? new Date(h.created_at).toLocaleString('zh-TW') : ''}</p>
                        {h.raw_text && (
                          <p className="mt-1 line-clamp-2 text-base text-gray-500 font-mono">{h.raw_text}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => {
                            const initFields: Record<string, string> = {}
                            for (const [k, v] of Object.entries(h.extracted_fields ?? {})) {
                              initFields[k] = v !== null && v !== undefined ? String(v) : ''
                            }
                            setLatestResult(h)
                            setEditableFields(initFields)
                            setShowHistoryModal(false)
                          }}
                          className="rounded-lg border border-gray-200 px-3 py-1 text-base text-gray-600 hover:bg-gray-100 transition-colors"
                        >
                          載入
                        </button>
                        <button
                          onClick={() => setDeleteHistTarget(h)}
                          className="rounded-lg border border-red-100 px-3 py-1 text-base text-red-400 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                /* ── Tab 2：表格式 + 勾選匯出 ── */
                <div className="flex flex-col h-full">
                  <div className="overflow-x-auto">
                    <table className="w-full text-base">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          <th className="w-10 px-4 py-3 text-left">
                            <input
                              type="checkbox"
                              checked={selectedHistIds.size === history.length && history.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedHistIds(new Set(history.map((h) => h.id)))
                                else setSelectedHistIds(new Set())
                              }}
                              className="h-4 w-4 rounded border-gray-300 accent-sky-600"
                            />
                          </th>
                          <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap">時間</th>
                          <th className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap">檔案名稱</th>
                          {selectedConfig.output_fields.map((f) => (
                            <th key={f.name} className="px-3 py-3 text-left font-medium text-gray-500 whitespace-nowrap font-mono">{f.name}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {history.map((h) => (
                          <tr
                            key={h.id}
                            onClick={() => setSelectedHistIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(h.id)) next.delete(h.id); else next.add(h.id)
                              return next
                            })}
                            className={`cursor-pointer transition-colors ${selectedHistIds.has(h.id) ? 'bg-sky-50' : 'hover:bg-gray-50'}`}
                          >
                            <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedHistIds.has(h.id)}
                                onChange={() => setSelectedHistIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(h.id)) next.delete(h.id); else next.add(h.id)
                                  return next
                                })}
                                className="h-4 w-4 rounded border-gray-300 accent-sky-600"
                              />
                            </td>
                            <td className="px-3 py-2.5 text-gray-400 whitespace-nowrap">{h.created_at ? new Date(h.created_at).toLocaleString('zh-TW') : ''}</td>
                            <td className="px-3 py-2.5 text-gray-700 max-w-[160px] truncate">{h.filename}</td>
                            {selectedConfig.output_fields.map((f) => (
                              <td key={f.name} className="px-3 py-2.5 text-gray-700 max-w-[180px] truncate">
                                {String(h.extracted_fields?.[f.name] ?? '—')}
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
            {/* Tab 2 底部操作列 */}
            {historyTab === 'table' && history.length > 0 && (
              <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-3">
                <span className="text-base text-gray-500">
                  已選 {selectedHistIds.size} / {history.length} 筆
                </span>
                <button
                  onClick={exportSelectedHistoryCsv}
                  disabled={selectedHistIds.size === 0}
                  className="flex items-center gap-1.5 rounded-lg bg-sky-800 px-4 py-2 text-base font-medium text-white hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="h-4 w-4" />
                  匯出選取 CSV（{selectedHistIds.size} 筆）
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal：新增/編輯 OCR 設定 ── */}
      {showConfigForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h3 className="font-semibold text-gray-800">
                {editingConfig ? '編輯 OCR 設定' : '新增 OCR 設定'}
              </h3>
              <button onClick={() => setShowConfigForm(false)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-base text-red-700">{error}</div>
              )}

              {/* 設定名稱 */}
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">設定名稱 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={configForm.name}
                  onChange={(e) => setConfigForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="例：發票辨識、名片掃描"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              {/* 資料類型 */}
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">資料類型說明</label>
                <input
                  type="text"
                  value={configForm.data_type_label}
                  onChange={(e) => setConfigForm((f) => ({ ...f, data_type_label: e.target.value }))}
                  placeholder="例：發票、名片、手寫文件"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              {/* 模型選擇 */}
              <div>
                <label className="mb-1.5 block text-base font-medium text-gray-700">Vision 模型 <span className="text-red-500">*</span></label>
                <LLMModelSelect
                  value={configForm.model}
                  onChange={(m) => setConfigForm((f) => ({ ...f, model: m }))}
                />

              </div>

              {/* 輸出欄位 */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-base font-medium text-gray-700">輸出欄位 <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowTemplateMenu((v) => !v)}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-blue-600 hover:bg-blue-50"
                    >
                      套用範本 <ChevronDown className="h-3 w-3" />
                    </button>
                    {showTemplateMenu && (
                      <div className="absolute right-0 top-full z-10 mt-1 w-36 rounded-lg border border-gray-200 bg-white shadow-lg">
                        {templates.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => applyTemplate(tpl)}
                            className="w-full px-3 py-2 text-left text-base text-gray-700 hover:bg-gray-50"
                          >
                            {tpl.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {fields.map((f, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 shrink-0 text-gray-300" />
                      <input
                        type="text"
                        value={f.name}
                        onChange={(e) => updateField(idx, 'name', e.target.value)}
                        placeholder="欄位名稱（英文）"
                        className="w-36 shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                      <input
                        type="text"
                        value={f.hint}
                        onChange={(e) => updateField(idx, 'hint', e.target.value)}
                        placeholder="說明（幫助模型理解）"
                        className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                      />
                      <div className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          onClick={() => moveField(idx, -1)}
                          disabled={idx === 0}
                          className="rounded p-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-20"
                        ><ChevronDown className="h-3 w-3 rotate-180" /></button>
                        <button
                          type="button"
                          onClick={() => moveField(idx, 1)}
                          disabled={idx === fields.length - 1}
                          className="rounded p-0.5 text-gray-500 hover:text-gray-700 disabled:opacity-20"
                        ><ChevronDown className="h-3 w-3" /></button>
                      </div>
                      <button
                        onClick={() => removeField(idx)}
                        disabled={fields.length <= 1}
                        className="shrink-0 rounded p-1 text-gray-500 hover:text-gray-700 disabled:opacity-20"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={addField}
                  className="mt-2 flex items-center gap-1 text-base text-blue-600 hover:underline"
                >
                  <Plus className="h-3 w-3" /> 新增欄位
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button
                onClick={() => setShowConfigForm(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={() => void handleSaveConfig()}
                disabled={savingConfig}
                className="rounded-lg px-4 py-2 text-base font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: HEADER_COLOR }}
              >
                {savingConfig ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm：刪除設定 ── */}
      <ConfirmModal
        open={deleteConfigTarget !== null}
        title="刪除 OCR 設定"
        message={`確定要刪除「${deleteConfigTarget?.name}」？所有相關歷史記錄也會一併刪除。`}
        confirmText="確認刪除"
        variant="danger"
        onConfirm={() => void handleDeleteConfig()}
        onCancel={() => setDeleteConfigTarget(null)}
      />

      {/* ── Confirm：刪除歷史 ── */}
      <ConfirmModal
        open={deleteHistTarget !== null}
        title="刪除歷史記錄"
        message={`確定要刪除「${deleteHistTarget?.filename}」的辨識記錄？`}
        confirmText="確認刪除"
        variant="danger"
        onConfirm={() => void handleDeleteHist()}
        onCancel={() => setDeleteHistTarget(null)}
      />

      {/* ── Modal：批次辨識 ── */}
      {showBatchModal && selectedConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex w-full max-w-5xl flex-col rounded-xl bg-white shadow-2xl" style={{ maxHeight: '90vh' }}>
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <LayersIcon className="h-5 w-5 text-emerald-600" />
                <h3 className="font-semibold text-gray-800">批次辨識 — {selectedConfig.name}</h3>
                {batchFiles.length > 0 && (
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-base text-gray-500">
                    {batchFiles.length} 個檔案
                  </span>
                )}
              </div>
              <button
                onClick={() => { if (!batchRunning) setShowBatchModal(false) }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >×</button>
            </div>

            {/* 上傳區（未開始時顯示） */}
            {!batchRunning && batchRows.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-4 px-6 py-14">
                <div
                  onClick={() => batchFileInputRef.current?.click()}
                  className="flex w-full max-w-md cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-gray-200 py-10 hover:border-emerald-400 hover:bg-emerald-50/30 transition-colors"
                >
                  <Upload className="h-8 w-8 text-gray-300" />
                  <p className="text-base text-gray-500">點擊選擇多個圖片</p>
                  <p className="text-base text-gray-300">JPG、PNG、WebP（每檔上限 20 MB）</p>
                </div>
                <input
                  ref={batchFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleBatchFileChange}
                />
              </div>
            )}

            {/* 檔案列表（已選擇，未開始） */}
            {!batchRunning && !batchDone && batchRows.length > 0 && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  <ul className="space-y-1.5">
                    {batchRows.map((r, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2.5">
                        <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300" />
                        <span className="flex-1 truncate text-base text-gray-700">{r.file.name}</span>
                        <span className="text-base text-gray-400">{(r.file.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
                  <button onClick={() => { setBatchFiles([]); setBatchRows([]) }} className="text-base text-gray-400 hover:text-gray-600">重新選擇</button>
                  <button
                    onClick={() => void runBatch(batchFiles)}
                    className="rounded-lg bg-emerald-600 px-6 py-2 text-base font-medium text-white hover:bg-emerald-500 transition-colors"
                  >開始辨識</button>
                </div>
              </div>
            )}

            {/* 辨識中：進度列表 */}
            {batchRunning && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                  <ul className="space-y-1.5">
                    {batchRows.map((r, i) => (
                      <li key={i} className="flex items-center gap-3 rounded-lg bg-gray-50 px-4 py-2.5">
                        {r.status === 'processing' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />}
                        {r.status === 'done'       && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                        {r.status === 'error'      && <AlertCircle  className="h-4 w-4 shrink-0 text-red-400" />}
                        {r.status === 'pending'    && <div className="h-4 w-4 shrink-0 rounded-full border-2 border-gray-300" />}
                        <span className="flex-1 truncate text-base text-gray-700">{r.file.name}</span>
                        {r.status === 'error' && <span className="text-base text-red-400">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="shrink-0 border-t border-gray-100 px-6 py-4 text-base text-gray-400">
                  辨識中 {batchRows.filter((r) => r.status === 'done' || r.status === 'error').length} / {batchRows.length}...
                </div>
              </div>
            )}

            {/* 完成：結果表格 */}
            {batchDone && batchRows.length > 0 && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
                  <table className="w-full border-collapse text-base">
                    <thead>
                      <tr className="border-b-2 border-gray-200">
                        <th className="py-2 pr-4 text-left font-medium text-gray-500 whitespace-nowrap">狀態</th>
                        <th className="py-2 pr-4 text-left font-medium text-gray-500 whitespace-nowrap">檔案名稱</th>
                        {selectedConfig.output_fields.map((f) => (
                          <th key={f.name} className="py-2 pr-4 text-left font-medium text-gray-500 whitespace-nowrap">{f.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((r, i) => (
                        <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                          <td className="py-2 pr-4">
                            {r.status === 'done'  && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                            {r.status === 'error' && <AlertCircle  className="h-4 w-4 text-red-400" />}
                          </td>
                          <td className="py-2 pr-4 text-gray-600 whitespace-nowrap">{r.file.name}</td>
                          {selectedConfig.output_fields.map((f) => (
                            <td key={f.name} className="py-1.5 pr-4">
                              {r.status === 'error' ? (
                                <span className="text-red-400 text-base">{r.error}</span>
                              ) : (
                                <input
                                  type="text"
                                  value={r.fields[f.name] ?? ''}
                                  onChange={(e) => {
                                    const val = e.target.value
                                    setBatchRows((prev) => prev.map((row, idx) =>
                                      idx === i ? { ...row, fields: { ...row.fields, [f.name]: val } } : row
                                    ))
                                  }}
                                  className={`w-full min-w-[8rem] rounded border px-2 py-1 text-base focus:outline-none focus:ring-1 focus:ring-emerald-300 ${
                                    !r.fields[f.name] ? 'border-amber-200 bg-amber-50 placeholder:text-amber-300' : 'border-gray-200 bg-white'
                                  }`}
                                  placeholder="—"
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex shrink-0 items-center justify-between border-t border-gray-100 px-6 py-4">
                  <div className="text-base text-gray-400">
                    完成 {batchRows.filter((r) => r.status === 'done').length} / {batchRows.length}
                    {batchRows.some((r) => r.status === 'error') && (
                      <span className="ml-2 text-red-400">（{batchRows.filter((r) => r.status === 'error').length} 個失敗）</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-base text-gray-500">
                      <input
                        type="checkbox"
                        checked={copyBatchWithHeader}
                        onChange={(e) => setCopyBatchWithHeader(e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-sky-600"
                      />
                      包含名稱
                    </label>
                    <button
                      onClick={copyBatchData}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-base text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      {copiedBatch ? (
                        <ClipboardCheck className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" />
                      )}
                      {copiedBatch ? '已複製' : '複製'}
                    </button>
                    <button
                      onClick={exportBatchCsv}
                      className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-base text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <Download className="h-3.5 w-3.5" /> 匯出 CSV
                    </button>
                    <button
                      onClick={() => setShowBatchModal(false)}
                      className="rounded-lg bg-gray-100 px-4 py-2 text-base text-gray-600 hover:bg-gray-200 transition-colors"
                    >關閉</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {showLightbox && previewUrl && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-black/90"
          onWheel={onLbWheel}
          onMouseMove={onLbMouseMove}
          onMouseUp={onLbMouseUp}
          onMouseLeave={onLbMouseUp}
        >
          {/* Toolbar */}
          <div className="flex shrink-0 items-center justify-between px-5 py-3">
            <span className="text-base text-white/60">{latestResult?.filename}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLbScale((s) => Math.min(8, s + 0.25))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              ><ZoomIn className="h-4 w-4" /></button>
              <span className="w-14 text-center text-base text-white/70">{Math.round(lbScale * 100)}%</span>
              <button
                onClick={() => setLbScale((s) => Math.max(0.2, s - 0.25))}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              ><ZoomOut className="h-4 w-4" /></button>
              <button
                onClick={() => { setLbScale(1); setLbOffset({ x: 0, y: 0 }) }}
                className="rounded-lg bg-white/10 px-3 py-1 text-base text-white/70 hover:bg-white/20 transition-colors"
              >原始大小</button>
              <button
                onClick={() => setShowLightbox(false)}
                className="ml-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors"
              ><X className="h-4 w-4" /></button>
            </div>
          </div>
          {/* Image area */}
          <div
            className="flex min-h-0 flex-1 cursor-grab items-center justify-center overflow-hidden active:cursor-grabbing"
            onMouseDown={onLbMouseDown}
          >
            <img
              src={previewUrl}
              alt="預覽"
              draggable={false}
              style={{
                transform: `translate(${lbOffset.x}px, ${lbOffset.y}px) scale(${lbScale})`,
                transformOrigin: 'center center',
                maxWidth: 'none',
                transition: lbDragRef.current ? 'none' : 'transform 0.1s',
                userSelect: 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
