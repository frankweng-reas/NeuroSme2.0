/**
 * Doc Refiner Agent UI（agent_id = doc-refiner）
 * 三階段：上傳設定 → 左右分割比對編輯 → 下載 PDF
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  processDocumentStream,
  exportDocument,
  exportTxt,
  listKBs,
  importToKB,
  type StreamEvent,
  type TokenUsage,
  type QAItem,
  type KBOption,
} from '@/api/docRefiner'
import AgentHeader from '@/components/AgentHeader'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent } from '@/types'

interface Props { agent: Agent }

type Stage = 'upload' | 'edit' | 'done'

const HEADER_COLOR = '#1A3A52'

export default function AgentDocRefinerUI({ agent }: Props) {
  // ── 階段 ──
  const [stage, setStage] = useState<Stage>('upload')

  // ── 上傳設定 ──
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState('')
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 整理結果（可編輯）──
  const [items, setItems] = useState<QAItem[]>([])
  const [title, setTitle] = useState('')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  // SSE 進度
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null)
  // 完成後的 usage / model（用於 footer）
  const [doneInfo, setDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  // abort controller
  const abortRef = useRef<AbortController | null>(null)

  // ── 匯出 ──
  const [exporting, setExporting] = useState(false)
  const [exportingTxt, setExportingTxt] = useState(false)

  // ── 匯入至 KB ──
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState<{ kbName: string; count: number } | null>(null)

  // ── 錯誤 ──
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  // ── 使用說明 ──
  const [helpOpen, setHelpOpen] = useState(false)

  // ────────────────────────────────────────────────
  // 檔案選擇
  // ────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setErrorModal({ title: '格式錯誤', message: '目前僅支援 PDF 格式' })
      return
    }
    setFile(f)
    // 建立預覽 URL
    setPdfUrl(URL.createObjectURL(f))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      setErrorModal({ title: '格式錯誤', message: '目前僅支援 PDF 格式' })
      return
    }
    setFile(f)
    setPdfUrl(URL.createObjectURL(f))
  }

  // ────────────────────────────────────────────────
  // 開始整理
  // ────────────────────────────────────────────────

  const handleProcess = async () => {
    if (!file) return

    // 取消上次未完成的 stream
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setProcessing(true)
    setItems([])
    setDoneInfo(null)
    setChunkProgress(null)
    setTitle(file.name.replace(/\.pdf$/i, ''))
    setStage('edit')  // 立即切到 EditStage，讓用戶看到結果逐漸出現

    try {
      for await (const event of processDocumentStream(
        file, model || undefined, abortRef.current.signal,
      )) {
        if (event.type === 'meta') {
          setChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setItems((prev) => [...prev, ...event.items])
          setChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setDoneInfo({ usage: event.usage, model: event.model })
          setChunkProgress(null)
          setProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setProcessing(false)
          setStage('upload')
        } else if (event.type === 'chunk_error') {
          // 某段失敗但繼續，不跳錯誤 modal，只 log
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
        setStage('upload')
      }
      setProcessing(false)
    }
  }

  // ────────────────────────────────────────────────
  // 卡片編輯
  // ────────────────────────────────────────────────

  const updateItem = (id: number, patch: Partial<QAItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const deleteItem = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addItem = () => {
    const newId = Math.max(0, ...items.map((it) => it.id)) + 1
    setItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  // ────────────────────────────────────────────────
  // 匯入至知識庫
  // ────────────────────────────────────────────────

  const handleImport = async (kbId: number | undefined, newKbName: string | undefined) => {
    setImporting(true)
    try {
      const res = await importToKB({
        title,
        items,
        kb_id: kbId,
        new_kb_name: newKbName,
      })
      setImportSuccess({ kbName: res.kb_name, count: res.imported_count })
      setImportModalOpen(false)
    } catch (err) {
      setErrorModal({
        title: '匯入失敗',
        message: err instanceof Error ? err.message : '匯入失敗，請重試',
      })
    } finally {
      setImporting(false)
    }
  }

  // ────────────────────────────────────────────────
  // 匯出 PDF
  // ────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportDocument({ title, items })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || 'document'}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({
        title: '匯出失敗',
        message: err instanceof Error ? err.message : '匯出 PDF 失敗',
      })
    } finally {
      setExporting(false)
    }
  }

  const handleExportTxt = async () => {
    setExportingTxt(true)
    try {
      const blob = await exportTxt({ title, items })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title || 'qa'}.txt`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({
        title: '匯出失敗',
        message: err instanceof Error ? err.message : '匯出 TXT 失敗',
      })
    } finally {
      setExportingTxt(false)
    }
  }

  // ────────────────────────────────────────────────
  // 重新上傳
  // ────────────────────────────────────────────────

  const handleReset = () => {
    abortRef.current?.abort()
    setStage('upload')
    setFile(null)
    setPdfUrl(null)
    setItems([])
    setTitle('')
    setDoneInfo(null)
    setChunkProgress(null)
    setProcessing(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ────────────────────────────────────────────────
  // Render
  // ────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} url="/help-doc-refiner.md" title="Doc Refiner 使用說明" />
      <ErrorModal
        open={errorModal !== null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />
      <AgentHeader
        agent={agent}
        headerBackgroundColor={HEADER_COLOR}
        onOnlineHelpClick={() => setHelpOpen(true)}
      />

      {importModalOpen && (
        <ImportToKBModal
          onConfirm={handleImport}
          onClose={() => setImportModalOpen(false)}
          importing={importing}
        />
      )}

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {stage === 'upload' ? (
          <UploadStage
            file={file}
            model={model}
            processing={processing}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            onDrop={handleDrop}
            onModelChange={setModel}
            onProcess={handleProcess}
          />
        ) : (
          <EditStage
            pdfUrl={pdfUrl}
            title={title}
            items={items}
            processing={processing}
            chunkProgress={chunkProgress}
            doneInfo={doneInfo}
            exporting={exporting}
            exportingTxt={exportingTxt}
            importing={importing}
            importSuccess={importSuccess}
            onUpdateItem={updateItem}
            onDeleteItem={deleteItem}
            onAddItem={addItem}
            onExport={handleExport}
            onExportTxt={handleExportTxt}
            onImportClick={() => { setImportSuccess(null); setImportModalOpen(true) }}
            onReset={handleReset}
          />
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Stage 1：上傳
// ══════════════════════════════════════════════════

interface UploadStageProps {
  file: File | null
  model: string
  processing: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onModelChange: (m: string) => void
  onProcess: () => void
}

function UploadStage({
  file, model, processing, fileInputRef,
  onFileChange, onDrop, onModelChange, onProcess,
}: UploadStageProps) {
  const CARD_BG = '#1A3A52'
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-full max-w-xl rounded-2xl border border-white/20 p-8 shadow-xl" style={{ backgroundColor: CARD_BG }}>

        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-400/20">
            <FileText className="h-5 w-5 text-sky-300" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">智慧文件整理</h2>
            <p className="text-sm text-white/50">上傳 PDF，AI 自動萃取 Q&A 知識條目</p>
          </div>
        </div>

        {/* 拖曳上傳區 */}
        <div
          className={`mb-5 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-colors ${
            file ? 'border-sky-400/60 bg-sky-900/20' : 'border-white/20 hover:border-white/40 hover:bg-white/5'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <>
              <FileText className="h-8 w-8 text-sky-400" />
              <div className="text-center">
                <p className="font-medium text-white">{file.name}</p>
                <p className="text-sm text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-xs text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-white/40" />
              <p className="text-sm text-white/60">拖曳 PDF 至此，或點擊選擇</p>
              <p className="text-xs text-white/30">最大 20 MB</p>
            </>
          )}
        </div>

        {/* 模型選擇 */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-white/70">使用模型（選填）</label>
          <LLMModelSelect
            value={model}
            onChange={onModelChange}
            label=""
            className="w-full"
          />
        </div>

        {/* 開始按鈕 */}
        <button
          type="button"
          onClick={onProcess}
          disabled={!file || processing}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-base font-semibold text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          style={{ backgroundColor: '#0e7490' }}
        >
          {processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              AI 整理中，請稍候…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              開始智慧整理
            </>
          )}
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Stage 2：比對編輯
// ══════════════════════════════════════════════════

interface EditStageProps {
  pdfUrl: string | null
  title: string
  items: QAItem[]
  processing: boolean
  chunkProgress: { current: number; total: number } | null
  doneInfo: { usage: TokenUsage; model: string } | null
  exporting: boolean
  exportingTxt: boolean
  importing: boolean
  importSuccess: { kbName: string; count: number } | null
  onUpdateItem: (id: number, patch: Partial<QAItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onExport: () => void
  onExportTxt: () => void
  onImportClick: () => void
  onReset: () => void
}

function EditStage({
  pdfUrl, title, items, processing, chunkProgress, doneInfo, exporting, exportingTxt,
  importing, importSuccess,
  onUpdateItem, onDeleteItem, onAddItem, onExport, onExportTxt, onImportClick, onReset,
}: EditStageProps) {
  const PANEL_BG = '#1A3A52'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">


      {/* 主體：左右分割 */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* 左：PDF 預覽 */}
        <div className="flex w-[45%] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: PANEL_BG }}>
          <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <FileText className="h-4 w-4 text-white/70" />
            <span className="text-base font-medium text-white/70">原始文件</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 rounded-lg border border-white/20 px-2.5 py-1 text-sm text-white/60 transition hover:bg-white/10"
            >
              <Upload className="h-3.5 w-3.5" />
              重新上傳
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="h-full w-full border-0"
                title="原始 PDF 預覽"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-base text-white/30">
                無法預覽
              </div>
            )}
          </div>
        </div>

        {/* 右：整理結果（可編輯）*/}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: PANEL_BG }}>
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <span className="text-base font-medium text-white/70">❓ Q&A 整理結果</span>
            {/* 進度顯示 */}
            {processing && chunkProgress && chunkProgress.total > 1 && (
              <span className="flex items-center gap-1 text-sm text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                第 {chunkProgress.current}/{chunkProgress.total} 段
              </span>
            )}
            {processing && (!chunkProgress || chunkProgress.total === 1) && (
              <span className="flex items-center gap-1 text-sm text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                整理中…
              </span>
            )}
            <div className="flex-1" />
            {importSuccess && (
              <span className="text-xs text-emerald-400">
                ✓ 已匯入「{importSuccess.kbName}」{importSuccess.count} 條
              </span>
            )}
            <button
              type="button"
              onClick={onImportClick}
              disabled={importing || items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="text-base leading-none">📥</span>}
              匯入至知識庫
            </button>
            <button
              type="button"
              onClick={onExportTxt}
              disabled={exportingTxt || items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1 text-sm font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              {exportingTxt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              下載 TXT
            </button>
            <button
              type="button"
              onClick={onExport}
              disabled={exporting || items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              下載 PDF
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {items.length === 0 && processing && (
              <div className="flex flex-col items-center justify-center gap-3 pt-16 text-white/40">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-base">AI 正在整理中，請稍候…</span>
              </div>
            )}
            {items.length === 0 && !processing && (
              <p className="mt-8 text-center text-base text-white/30">沒有內容，請重新整理</p>
            )}

            {items.map((item) => (
              <QACard
                key={item.id}
                item={item}
                onUpdate={(patch) => onUpdateItem(item.id, patch)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}

            {/* 新增按鈕 */}
            <button
              type="button"
              onClick={onAddItem}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-3 text-base text-white/40 transition hover:border-white/40 hover:text-white/60"
            >
              <Plus className="h-4 w-4" />
              新增一條
            </button>
          </div>

          {/* Token 使用量 footer */}
          {doneInfo && (
            <div className="flex flex-shrink-0 items-center border-t border-white/10 px-4 py-2 font-mono text-sm text-white/40">
              <span>model: {doneInfo.model}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>prompt: {doneInfo.usage.prompt_tokens.toLocaleString()}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>completion: {doneInfo.usage.completion_tokens.toLocaleString()}</span>
              <span className="mx-2 text-white/20">·</span>
              <span>total: {doneInfo.usage.total_tokens.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Q&A 卡片
// ══════════════════════════════════════════════════

function QACard({
  item,
  onUpdate,
  onDelete,
}: {
  item: QAItem
  onUpdate: (patch: Partial<QAItem>) => void
  onDelete: () => void
}) {
  const [question, setQuestion] = useState(item.question)
  const [answer, setAnswer] = useState(item.answer)

  // 當 item 從外部替換時（如新 PDF 整理完成）才同步
  useEffect(() => { setQuestion(item.question) }, [item.id, item.question])
  useEffect(() => { setAnswer(item.answer) }, [item.id, item.answer])

  return (
    <div className="group rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 rounded-md bg-blue-600/30 px-2 py-0.5 text-xs font-bold text-blue-300">
          Q{item.id}
        </span>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onBlur={() => onUpdate({ question })}
          placeholder="輸入問題…"
          rows={2}
          className="flex-1 resize-none rounded-lg bg-transparent text-sm text-white/90 placeholder-white/30 outline-none focus:bg-white/5 focus:ring-1 focus:ring-blue-400/40 px-2 py-1"
        />
        <button
          onClick={onDelete}
          className="flex-shrink-0 rounded-lg p-1 text-white/20 opacity-0 transition hover:bg-red-900/40 hover:text-red-400 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-start gap-2 pl-1">
        <span className="mt-0.5 flex-shrink-0 rounded-md bg-emerald-700/30 px-2 py-0.5 text-xs font-bold text-emerald-300">
          A
        </span>
        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onBlur={() => onUpdate({ answer })}
          placeholder="輸入答案…"
          rows={3}
          className="flex-1 resize-none rounded-lg bg-transparent text-sm text-white/80 placeholder-white/30 outline-none focus:bg-white/5 focus:ring-1 focus:ring-emerald-400/40 px-2 py-1"
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// 匯入至知識庫 Modal
// ══════════════════════════════════════════════════

function ImportToKBModal({
  onConfirm,
  onClose,
  importing,
}: {
  onConfirm: (kbId: number | undefined, newKbName: string | undefined) => void
  onClose: () => void
  importing: boolean
}) {
  const MODAL_BG = '#1A3A52'
  const [kbs, setKbs] = useState<KBOption[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedKbId, setSelectedKbId] = useState<number | 'new' | ''>('')
  const [newKbName, setNewKbName] = useState('')

  useEffect(() => {
    listKBs()
      .then((data) => { setKbs(data); if (data.length > 0) setSelectedKbId(data[0].id) })
      .catch(() => setSelectedKbId('new'))
      .finally(() => setLoading(false))
  }, [])

  const handleConfirm = useCallback(() => {
    if (selectedKbId === 'new') {
      if (!newKbName.trim()) return
      onConfirm(undefined, newKbName.trim())
    } else if (typeof selectedKbId === 'number') {
      onConfirm(selectedKbId, undefined)
    }
  }, [selectedKbId, newKbName, onConfirm])

  const canConfirm = !importing && (
    (selectedKbId === 'new' && newKbName.trim().length > 0) ||
    typeof selectedKbId === 'number'
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/20 p-6 shadow-2xl"
        style={{ backgroundColor: MODAL_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-white">匯入至知識庫</h3>

        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-white/40" /></div>
        ) : (
          <>
            <div className="mb-4">
              <label className="mb-1.5 block text-sm text-white/60">選擇知識庫</label>
              <select
                value={selectedKbId === '' ? '' : String(selectedKbId)}
                onChange={(e) => {
                  const v = e.target.value
                  setSelectedKbId(v === 'new' ? 'new' : Number(v))
                }}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white outline-none focus:border-sky-400"
              >
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id} className="bg-slate-800">
                    {kb.name}{kb.scope === 'company' ? '（公司）' : ''}
                  </option>
                ))}
                <option value="new" className="bg-slate-800">＋ 建立新知識庫</option>
              </select>
            </div>

            {selectedKbId === 'new' && (
              <div className="mb-4">
                <label className="mb-1.5 block text-sm text-white/60">新知識庫名稱</label>
                <input
                  type="text"
                  value={newKbName}
                  onChange={(e) => setNewKbName(e.target.value)}
                  placeholder="輸入名稱…"
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-sky-400"
                />
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white/60 hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
          >
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            確認匯入
          </button>
        </div>
      </div>
    </div>
  )
}

