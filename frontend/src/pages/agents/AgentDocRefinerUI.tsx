/**
 * Doc Refiner Agent UI（agent_id = doc-refiner）
 * 三階段：上傳設定 → 左右分割比對編輯 → 下載 PDF
 */
import { useRef, useState } from 'react'
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
  processDocument,
  exportDocument,
  type ProcessResponse,
  type RefinerMode,
  type RefinerItem,
  type QAItem,
  type SummaryItem,
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
  const [mode, setMode] = useState<RefinerMode>('qa')
  const [model, setModel] = useState('')
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 整理結果（可編輯）──
  const [result, setResult] = useState<ProcessResponse | null>(null)
  const [items, setItems] = useState<RefinerItem[]>([])
  const [title, setTitle] = useState('')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  // ── 匯出 ──
  const [exporting, setExporting] = useState(false)

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
    setProcessing(true)
    try {
      const res = await processDocument(file, mode, model || undefined)
      setResult(res)
      setTitle(res.title)
      setItems(res.items.map((item, idx) => ({ ...item, id: idx + 1 })))
      setStage('edit')
    } catch (err) {
      setErrorModal({
        title: '整理失敗',
        message: err instanceof Error ? err.message : '處理失敗，請重試',
      })
    } finally {
      setProcessing(false)
    }
  }

  // ────────────────────────────────────────────────
  // 卡片編輯
  // ────────────────────────────────────────────────

  const updateItem = (id: number, patch: Partial<RefinerItem>) => {
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const deleteItem = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addItem = () => {
    const newId = Math.max(0, ...items.map((it) => it.id)) + 1
    if (mode === 'qa') {
      setItems((prev) => [...prev, { id: newId, question: '', answer: '' } as QAItem])
    } else {
      setItems((prev) => [...prev, { id: newId, heading: '', content: '' } as SummaryItem])
    }
  }

  // ────────────────────────────────────────────────
  // 匯出 PDF
  // ────────────────────────────────────────────────

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await exportDocument({ mode, title, items })
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

  // ────────────────────────────────────────────────
  // 重新上傳
  // ────────────────────────────────────────────────

  const handleReset = () => {
    setStage('upload')
    setFile(null)
    setPdfUrl(null)
    setResult(null)
    setItems([])
    setTitle('')
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

      <div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
        {stage === 'upload' ? (
          <UploadStage
            file={file}
            mode={mode}
            model={model}
            processing={processing}
            fileInputRef={fileInputRef}
            onFileChange={handleFileChange}
            onDrop={handleDrop}
            onModeChange={setMode}
            onModelChange={setModel}
            onProcess={handleProcess}
          />
        ) : (
          <EditStage
            pdfUrl={pdfUrl}
            mode={mode}
            title={title}
            items={items}
            result={result}
            exporting={exporting}
            onTitleChange={setTitle}
            onUpdateItem={updateItem}
            onDeleteItem={deleteItem}
            onAddItem={addItem}
            onExport={handleExport}
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
  mode: RefinerMode
  model: string
  processing: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onModeChange: (m: RefinerMode) => void
  onModelChange: (m: string) => void
  onProcess: () => void
}

function UploadStage({
  file, mode, model, processing, fileInputRef,
  onFileChange, onDrop, onModeChange, onModelChange, onProcess,
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
            <p className="text-sm text-white/50">上傳 PDF，AI 自動整理成 Q&A 或摘要</p>
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

        {/* 整理模式 */}
        <div className="mb-5">
          <label className="mb-2 block text-sm font-medium text-white/70">整理模式</label>
          <div className="flex gap-3">
            {([['qa', '❓ Q&A 格式'], ['summary', '📋 摘要格式']] as [RefinerMode, string][]).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => onModeChange(val)}
                className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition-all ${
                  mode === val
                    ? 'border-sky-400 bg-sky-600/30 text-sky-200'
                    : 'border-white/15 bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-white/40">
            {mode === 'qa'
              ? 'Q&A 模式：萃取重點整理成問答對，最適合加入知識庫'
              : '摘要模式：將每段落整理成重點摘要，適合快速掌握文件內容'}
          </p>
        </div>

        {/* 模型選擇 */}
        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-white/70">使用模型（選填）</label>
          <LLMModelSelect
            value={model}
            onChange={onModelChange}
            allowEmpty
            emptyLabel="使用租戶預設模型"
            className="w-full"
          />
          <p className="mt-1 text-xs text-white/40">建議使用 GPT-4o 或 Gemini 以取得較佳整理品質</p>
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
  mode: RefinerMode
  title: string
  items: RefinerItem[]
  result: ProcessResponse | null
  exporting: boolean
  onTitleChange: (t: string) => void
  onUpdateItem: (id: number, patch: Partial<RefinerItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onExport: () => void
  onReset: () => void
}

function EditStage({
  pdfUrl, mode, title, items, result, exporting,
  onTitleChange, onUpdateItem, onDeleteItem, onAddItem, onExport, onReset,
}: EditStageProps) {
  const PANEL_BG = '#1A3A52'
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">

      {/* 頂部工具列 */}
      <div className="flex flex-shrink-0 items-center gap-3">
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-base text-white/60 transition hover:bg-white/10"
        >
          <Upload className="h-3.5 w-3.5" />
          重新上傳
        </button>
        {result && (
          <span className="text-base text-white/70">
            {result.page_count} 頁 · {result.char_count.toLocaleString()} 字 · {items.length} 條
          </span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onExport}
          disabled={exporting || items.length === 0}
          className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-base font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-40"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          下載 PDF
        </button>
      </div>

      {/* 主體：左右分割 */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* 左：PDF 預覽 */}
        <div className="flex w-[45%] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: PANEL_BG }}>
          <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5 text-base font-medium text-white/70">
            <FileText className="h-4 w-4" />
            原始文件
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
            <span className="text-base font-medium text-white/70">
              {mode === 'qa' ? '❓ Q&A 整理結果' : '📋 摘要整理結果'}
            </span>
            <div className="flex-1" />
            {/* 文件標題 */}
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="文件標題"
              className="rounded-lg border border-white/20 bg-white/10 px-3 py-1 text-base text-white placeholder-white/30 outline-none focus:border-sky-400"
            />
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {items.length === 0 && (
              <p className="mt-8 text-center text-base text-white/30">沒有內容，請重新整理</p>
            )}

            {mode === 'qa'
              ? items.map((item) => (
                  <QACard
                    key={item.id}
                    item={item as QAItem}
                    onUpdate={(patch) => onUpdateItem(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                  />
                ))
              : items.map((item) => (
                  <SummaryCard
                    key={item.id}
                    item={item as SummaryItem}
                    onUpdate={(patch) => onUpdateItem(item.id, patch)}
                    onDelete={() => onDeleteItem(item.id)}
                  />
                ))
            }

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
  return (
    <div className="group rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20">
      <div className="mb-2 flex items-start gap-2">
        <span className="mt-0.5 flex-shrink-0 rounded-md bg-blue-600/30 px-2 py-0.5 text-xs font-bold text-blue-300">
          Q{item.id}
        </span>
        <textarea
          value={item.question}
          onChange={(e) => onUpdate({ question: e.target.value })}
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
          value={item.answer}
          onChange={(e) => onUpdate({ answer: e.target.value })}
          placeholder="輸入答案…"
          rows={3}
          className="flex-1 resize-none rounded-lg bg-transparent text-sm text-white/80 placeholder-white/30 outline-none focus:bg-white/5 focus:ring-1 focus:ring-emerald-400/40 px-2 py-1"
        />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Summary 卡片
// ══════════════════════════════════════════════════

function SummaryCard({
  item,
  onUpdate,
  onDelete,
}: {
  item: SummaryItem
  onUpdate: (patch: Partial<SummaryItem>) => void
  onDelete: () => void
}) {
  return (
    <div className="group rounded-xl border border-white/10 bg-white/5 p-4 transition hover:border-white/20">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex-shrink-0 rounded-md bg-purple-700/30 px-2 py-0.5 text-xs font-bold text-purple-300">
          #{item.id}
        </span>
        <input
          value={item.heading}
          onChange={(e) => onUpdate({ heading: e.target.value })}
          placeholder="章節標題（選填）"
          className="flex-1 rounded-lg bg-transparent text-sm font-medium text-white/90 placeholder-white/30 outline-none focus:bg-white/5 focus:ring-1 focus:ring-purple-400/40 px-2 py-1"
        />
        <button
          onClick={onDelete}
          className="flex-shrink-0 rounded-lg p-1 text-white/20 opacity-0 transition hover:bg-red-900/40 hover:text-red-400 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <textarea
        value={item.content}
        onChange={(e) => onUpdate({ content: e.target.value })}
        placeholder="摘要內容…"
        rows={4}
        className="w-full resize-none rounded-lg bg-transparent px-2 py-1 text-sm text-white/80 placeholder-white/30 outline-none focus:bg-white/5 focus:ring-1 focus:ring-purple-400/40"
      />
    </div>
  )
}
