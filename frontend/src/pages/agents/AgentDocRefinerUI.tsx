/**
 * Doc Refiner Agent UI（agent_id = doc-refiner）
 * Sidebar 切換三種模式：
 *   doc  - 文件 → FAQ（上傳 PDF → AI 萃取知識點）
 *   note - 筆記 → FAQ（貼入文字 → AI 整理）
 *   sop  - SOP → FAQ（上傳 PDF/TXT → AI 逐步保留）
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import {
  BookOpen,
  ChevronRight,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  processDocumentStream,
  exportTxt,
  listKBs,
  importToKB,
  rewriteQAItem,
  type TokenUsage,
  type QAItem,
  type KBOption,
} from '@/api/docRefiner'
import AgentHeader from '@/components/AgentHeader'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import LLMModelSelect from '@/components/LLMModelSelect'
import type { Agent } from '@/types'

interface Props { agent: Agent }

type Stage = 'upload' | 'edit'
type Mode = 'doc' | 'note' | 'sop'

const HEADER_COLOR = '#1A3A52'

const NAV_ITEMS: { id: Mode; label: string; icon: React.ReactNode }[] = [
  { id: 'doc',  label: '文件 → FAQ', icon: <FileText      className="h-4 w-4 shrink-0" /> },
  { id: 'note', label: '筆記 → FAQ', icon: <BookOpen      className="h-4 w-4 shrink-0" /> },
  { id: 'sop',  label: 'SOP → FAQ',  icon: <ClipboardList className="h-4 w-4 shrink-0" /> },
]

export default function AgentDocRefinerUI({ agent }: Props) {
  // ── Mode & Sidebar ──
  const [mode, setMode] = useState<Mode>('doc')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  // ── 階段（doc mode 專用）──
  const [stage, setStage] = useState<Stage>('edit')

  // ── 上傳設定 ──
  const [file, setFile] = useState<File | null>(null)
  const [model, setModel] = useState('')
  const [processing, setProcessing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── 整理結果（可編輯）──
  const [items, setItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:doc:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [title, setTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:doc:title') ?? ''
  )
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  // SSE 進度
  const [chunkProgress, setChunkProgress] = useState<{ current: number; total: number } | null>(null)
  // 完成後的 usage / model（用於 footer）
  const [doneInfo, setDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  // abort controller
  const abortRef = useRef<AbortController | null>(null)

  // ── 匯出 ──
  const [_exportingTxt, setExportingTxt] = useState(false)

  // ── 匯入至 KB ──
  const [_importSuccess, setImportSuccess] = useState<{ kbName: string; count: number } | null>(null)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)

  // ── Note mode 獨立狀態 ──
  const [noteText, setNoteText] = useState<string>(() =>
    localStorage.getItem('doc-refiner:note:text') ?? ''
  )
  const [noteTitle, setNoteTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:note:title') ?? '筆記整理'
  )
  const [noteItems, setNoteItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:note:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [_noteImportSuccess, setNoteImportSuccess] = useState<{ kbName: string; count: number } | null>(null)
  const [noteDownloadModalOpen, setNoteDownloadModalOpen] = useState(false)
  const [_noteExportingTxt, setNoteExportingTxt] = useState(false)
  const [noteProcessing, setNoteProcessing] = useState(false)
  const [noteChunkProgress, setNoteChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [noteDoneInfo, setNoteDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const noteAbortRef = useRef<AbortController | null>(null)

  // ── SOP mode 獨立狀態 ──
  const [sopFile, setSopFile] = useState<File | null>(null)
  const [sopPdfUrl, setSopPdfUrl] = useState<string | null>(null)
  const [sopTitle, setSopTitle] = useState<string>(() =>
    localStorage.getItem('doc-refiner:sop:title') ?? ''
  )
  const [sopItems, setSopItems] = useState<QAItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('doc-refiner:sop:items') ?? 'null') ?? [] } catch { return [] }
  })
  const [sopProcessing, setSopProcessing] = useState(false)
  const [sopChunkProgress, setSopChunkProgress] = useState<{ current: number; total: number } | null>(null)
  const [sopDoneInfo, setSopDoneInfo] = useState<{ usage: TokenUsage; model: string } | null>(null)
  const sopAbortRef = useRef<AbortController | null>(null)
  const [sopReuploadModalOpen, setSopReuploadModalOpen] = useState(false)
  const [sopDownloadModalOpen, setSopDownloadModalOpen] = useState(false)
  const [_sopImportSuccess, setSopImportSuccess] = useState<{ kbName: string; count: number } | null>(null)

  // ── 錯誤 ──
  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)

  // ── 使用說明 ──
  const [helpOpen, setHelpOpen] = useState(false)

  // ── localStorage 自動存檔 ──
  useEffect(() => {
    if (processing) return
    try { localStorage.setItem('doc-refiner:doc:items', JSON.stringify(items)) } catch { /* ignore */ }
  }, [items, processing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:doc:title', title) } catch { /* ignore */ }
  }, [title])

  useEffect(() => {
    if (noteProcessing) return
    try { localStorage.setItem('doc-refiner:note:items', JSON.stringify(noteItems)) } catch { /* ignore */ }
  }, [noteItems, noteProcessing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:note:title', noteTitle) } catch { /* ignore */ }
  }, [noteTitle])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:note:text', noteText) } catch { /* ignore */ }
  }, [noteText])

  useEffect(() => {
    if (sopProcessing) return
    try { localStorage.setItem('doc-refiner:sop:items', JSON.stringify(sopItems)) } catch { /* ignore */ }
  }, [sopItems, sopProcessing])

  useEffect(() => {
    try { localStorage.setItem('doc-refiner:sop:title', sopTitle) } catch { /* ignore */ }
  }, [sopTitle])

  // ────────────────────────────────────────────────
  // 檔案選擇
  // ────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setErrorModal({ title: '格式錯誤', message: '目前支援 PDF 或 TXT 格式' })
      return
    }
    setFile(f)
    setPdfUrl(URL.createObjectURL(f))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files?.[0]
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setErrorModal({ title: '格式錯誤', message: '目前支援 PDF 或 TXT 格式' })
      return
    }
    setFile(f)
    setPdfUrl(URL.createObjectURL(f))
  }

  // ────────────────────────────────────────────────
  // 開始整理
  // ────────────────────────────────────────────────

  // ── 重新上傳 Modal ──
  const [reuploadModalOpen, setReuploadModalOpen] = useState(false)

  // ────────────────────────────────────────────────
  // 開始整理（可由外部傳入 file/model 覆蓋）
  // ────────────────────────────────────────────────

  const handleProcess = async (overrideFile?: File, overrideModel?: string, append = false) => {
    const f = overrideFile ?? file
    const m = overrideModel ?? model
    if (!f) return

    // 取消上次未完成的 stream
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    setProcessing(true)
    if (!append) setItems([])
    setDoneInfo(null)
    setChunkProgress(null)
    setTitle(f.name.replace(/\.(pdf|txt)$/i, ''))
    setStage('edit')  // 立即切到 EditStage，讓用戶看到結果逐漸出現

    try {
      for await (const event of processDocumentStream(
        f, m || undefined, abortRef.current.signal, 'doc',
      )) {
        if (event.type === 'meta') {
          setChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setDoneInfo({ usage: event.usage, model: event.model })
          setChunkProgress(null)
          setProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setProcessing(false)
        } else if (event.type === 'chunk_error') {
          // 某段失敗但繼續，不跳錯誤 modal，只 log
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      // 串流正常結束但未收到 done（例如後端非預期中斷），確保 spinner 停止
      setProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setProcessing(false)
    }
  }

  // 重新上傳確認：換新檔案後直接開始整理
  const handleReuploadConfirm = (newFile: File, append: boolean) => {
    setFile(newFile)
    setPdfUrl(URL.createObjectURL(newFile))
    setImportSuccess(null)
    setReuploadModalOpen(false)
    void handleProcess(newFile, undefined, append)
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

  const handleImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({
      title: qaSetName || title,
      items,
      kb_id: kbId,
      new_kb_name: newKbName,
    })
    setImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  // ────────────────────────────────────────────────
  // 匯出 PDF
  // ────────────────────────────────────────────────

  const handleExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || title
    setExportingTxt(true)
    try {
      const blob = await exportTxt({ title: name, items })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name || 'qa'}.txt`
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

  // ────────────────────────────────────────────────
  // Note mode：Q&A 卡片操作
  // ────────────────────────────────────────────────

  const updateNoteItem = (id: number, patch: Partial<QAItem>) => {
    setNoteItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const deleteNoteItem = (id: number) => {
    setNoteItems((prev) => prev.filter((it) => it.id !== id))
  }

  const addNoteItem = () => {
    const newId = Math.max(0, ...noteItems.map((it) => it.id)) + 1
    setNoteItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  const handleNoteImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({ title: qaSetName || noteTitle, items: noteItems, kb_id: kbId, new_kb_name: newKbName })
    setNoteImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  const handleNoteProcess = async () => {
    if (!noteText.trim()) return
    noteAbortRef.current?.abort()
    noteAbortRef.current = new AbortController()

    setNoteProcessing(true)
    setNoteDoneInfo(null)
    setNoteChunkProgress(null)

    // 將文字包成 File 送進既有的串流處理
    const blob = new Blob([noteText], { type: 'text/plain' })
    const file = new File([blob], `${noteTitle || 'note'}.txt`, { type: 'text/plain' })

    try {
      for await (const event of processDocumentStream(
        file, model || undefined, noteAbortRef.current.signal, 'note',
      )) {
        if (event.type === 'meta') {
          setNoteChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setNoteItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setNoteChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setNoteDoneInfo({ usage: event.usage, model: event.model })
          setNoteChunkProgress(null)
          setNoteProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setNoteProcessing(false)
        } else if (event.type === 'chunk_error') {
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      setNoteProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setNoteProcessing(false)
    }
  }

  const handleNoteExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || noteTitle
    setNoteExportingTxt(true)
    try {
      const blob = await exportTxt({ title: name, items: noteItems })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${name || 'note-qa'}.txt`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({ title: '匯出失敗', message: err instanceof Error ? err.message : '匯出 TXT 失敗' })
    } finally {
      setNoteExportingTxt(false)
    }
  }

  // ────────────────────────────────────────────────
  // SOP mode handlers
  // ────────────────────────────────────────────────

  const updateSopItem = (id: number, patch: Partial<QAItem>) => {
    setSopItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }
  const deleteSopItem = (id: number) => {
    setSopItems((prev) => prev.filter((it) => it.id !== id))
  }
  const addSopItem = () => {
    const newId = Math.max(0, ...sopItems.map((it) => it.id)) + 1
    setSopItems((prev) => [...prev, { id: newId, question: '', answer: '' }])
  }

  const handleSopProcess = useCallback(async (overrideFile?: File, append = false) => {
    const f = overrideFile ?? sopFile
    if (!f) return
    sopAbortRef.current?.abort()
    sopAbortRef.current = new AbortController()

    setSopProcessing(true)
    if (!append) setSopItems([])
    setSopDoneInfo(null)
    setSopChunkProgress(null)
    setSopTitle(f.name.replace(/\.(pdf|txt)$/i, ''))

    try {
      for await (const event of processDocumentStream(
        f, model || undefined, sopAbortRef.current.signal, 'sop',
      )) {
        if (event.type === 'meta') {
          setSopChunkProgress({ current: 0, total: event.chunk_total })
        } else if (event.type === 'items') {
          setSopItems((prev) => {
            const offset = prev.length > 0 ? Math.max(...prev.map((it) => it.id)) : 0
            return [...prev, ...event.items.map((it) => ({ ...it, id: it.id + offset }))]
          })
          setSopChunkProgress({ current: event.chunk, total: event.chunk_total })
        } else if (event.type === 'done') {
          setSopDoneInfo({ usage: event.usage, model: event.model })
          setSopChunkProgress(null)
          setSopProcessing(false)
        } else if (event.type === 'error') {
          setErrorModal({ title: '整理失敗', message: event.detail })
          setSopProcessing(false)
        } else if (event.type === 'chunk_error') {
          console.warn(`chunk ${event.chunk} 解析失敗：${event.detail}`)
        }
      }
      setSopProcessing(false)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setErrorModal({ title: '整理失敗', message: err instanceof Error ? err.message : '處理失敗，請重試' })
      }
      setSopProcessing(false)
    }
  }, [sopFile, model])

  const handleSopReuploadConfirm = (newFile: File, append: boolean) => {
    setSopFile(newFile)
    setSopPdfUrl(URL.createObjectURL(newFile))
    setSopImportSuccess(null)
    setSopReuploadModalOpen(false)
    void handleSopProcess(newFile, append)
  }

  const handleSopImport = async (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => {
    const res = await importToKB({ title: qaSetName || sopTitle, items: sopItems, kb_id: kbId, new_kb_name: newKbName })
    setSopImportSuccess({ kbName: res.kb_name, count: res.imported_count })
  }

  const handleSopExportTxt = async (qaSetName?: string) => {
    const name = qaSetName || sopTitle
    try {
      const blob = await exportTxt({ title: name, items: sopItems })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `${name || 'sop-qa'}.txt`; a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setErrorModal({ title: '匯出失敗', message: err instanceof Error ? err.message : '匯出 TXT 失敗' })
    }
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

      {reuploadModalOpen && (
        <ReuploadModal
          hasExistingItems={items.length > 0}
          onConfirm={handleReuploadConfirm}
          onClose={() => setReuploadModalOpen(false)}
        />
      )}
      {downloadModalOpen && (
        <DownloadModal
          qaTitle={title}
          onExportTxt={(name) => handleExportTxt(name)}
          onImport={handleImport}
          onClose={() => setDownloadModalOpen(false)}
        />
      )}
      {noteDownloadModalOpen && (
        <DownloadModal
          qaTitle={noteTitle}
          onExportTxt={(name) => handleNoteExportTxt(name)}
          onImport={handleNoteImport}
          onClose={() => setNoteDownloadModalOpen(false)}
        />
      )}
      {sopReuploadModalOpen && (
        <ReuploadModal
          hasExistingItems={sopItems.length > 0}
          onConfirm={handleSopReuploadConfirm}
          onClose={() => setSopReuploadModalOpen(false)}
        />
      )}
      {sopDownloadModalOpen && (
        <DownloadModal
          qaTitle={sopTitle}
          onExportTxt={(name) => handleSopExportTxt(name)}
          onImport={handleSopImport}
          onClose={() => setSopDownloadModalOpen(false)}
        />
      )}

      <div className="mt-4 flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* ── Sidebar：模式切換 ── */}
        <DocRefinerSidebar
          mode={mode}
          onModeChange={setMode}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          model={model}
          onModelChange={setModel}
        />

        {/* ── 主畫面 ── */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === 'doc' ? (
            stage === 'upload' ? (
              <UploadStage
                file={file}
                processing={processing}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                onDrop={handleDrop}
                onProcess={handleProcess}
              />
            ) : (
              <EditStage
                pdfUrl={pdfUrl}
                file={file}
                items={items}
                processing={processing}
                chunkProgress={chunkProgress}
                doneInfo={doneInfo}
                onUpdateItem={updateItem}
                onDeleteItem={deleteItem}
                onAddItem={addItem}
                onClearAll={() => setItems([])}
                onDownloadClick={() => setDownloadModalOpen(true)}
                onReuploadClick={() => setReuploadModalOpen(true)}
              />
            )
          ) : mode === 'note' ? (
            <NoteStage
              text={noteText}
              title={noteTitle}
              items={noteItems}
              processing={noteProcessing}
              chunkProgress={noteChunkProgress}
              doneInfo={noteDoneInfo}
              onTextChange={setNoteText}
              onTitleChange={setNoteTitle}
              onUpdateItem={updateNoteItem}
              onDeleteItem={deleteNoteItem}
              onAddItem={addNoteItem}
              onClearAll={() => setNoteItems([])}
              onProcess={handleNoteProcess}
              onDownloadClick={() => setNoteDownloadModalOpen(true)}
            />
          ) : (
            /* SOP 模式：與 doc 模式相同，永遠顯示 EditStage，左側空白時即為上傳入口 */
            <EditStage
              pdfUrl={sopPdfUrl}
              file={sopFile}
              items={sopItems}
              processing={sopProcessing}
              chunkProgress={sopChunkProgress}
              doneInfo={sopDoneInfo}
              onUpdateItem={updateSopItem}
              onDeleteItem={deleteSopItem}
              onAddItem={addSopItem}
              onClearAll={() => setSopItems([])}
              onDownloadClick={() => setSopDownloadModalOpen(true)}
              onReuploadClick={() => setSopReuploadModalOpen(true)}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════
// Sidebar：模式切換
// ══════════════════════════════════════════════════

interface DocRefinerSidebarProps {
  mode: Mode
  onModeChange: (m: Mode) => void
  collapsed: boolean
  onCollapsedChange: (v: boolean) => void
  model: string
  onModelChange: (m: string) => void
}

function DocRefinerSidebar({ mode, onModeChange, collapsed, onCollapsedChange, model, onModelChange }: DocRefinerSidebarProps) {
  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
        collapsed ? 'w-12' : 'w-64'
      }`}
      style={{ backgroundColor: HEADER_COLOR }}
    >
      {/* Header */}
      <div
        className={`flex shrink-0 items-center justify-between border-b border-white/20 py-2.5 ${
          collapsed ? 'px-2' : 'pl-4 pr-2'
        }`}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={() => onCollapsedChange(false)}
            className="flex w-full items-center justify-center rounded-2xl p-1.5 text-white/80 hover:bg-white/10"
            title="展開"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        ) : (
          <>
            <span className="text-base font-semibold text-white">模式</span>
            <button
              type="button"
              onClick={() => onCollapsedChange(true)}
              className="rounded-2xl px-1.5 py-1 text-white/60 hover:bg-white/10 hover:text-white"
              title="折疊"
            >
              {'<<'}
            </button>
          </>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex flex-1 flex-col gap-1 py-2 px-1.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onModeChange(item.id)}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-2.5 rounded-lg px-2 py-2.5 text-left text-lg font-medium transition-colors ${
              mode === item.id
                ? 'bg-sky-500/30 text-white'
                : 'text-white/65 hover:bg-white/10 hover:text-white'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            {item.icon}
            {!collapsed && <span className="leading-tight">{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* Model selector */}
      {!collapsed && (
        <div className="shrink-0 border-t border-white/20 px-2.5 py-3">
          <p className="mb-1.5 text-base font-medium text-white/50">模型</p>
          <LLMModelSelect
            value={model}
            onChange={onModelChange}
            label=""
            compact
            selectClassName="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-base text-white focus:border-white/40 focus:outline-none"
          />
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════
// Stage 1：上傳
// ══════════════════════════════════════════════════

interface UploadStageProps {
  file: File | null
  processing: boolean
  fileInputRef: React.RefObject<HTMLInputElement>
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDrop: (e: React.DragEvent) => void
  onProcess: () => void
}

function UploadStage({
  file, processing, fileInputRef,
  onFileChange, onDrop, onProcess,
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
            <p className="text-base text-white/50">上傳 PDF / TXT，AI 自動萃取 Q&A 知識條目</p>
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
            accept=".pdf,.txt"
            className="hidden"
            onChange={onFileChange}
          />
          {file ? (
            <>
              <FileText className="h-8 w-8 text-sky-400" />
              <div className="text-center">
                <p className="font-medium text-white">{file.name}</p>
                <p className="text-base text-white/50">{(file.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-base text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-8 w-8 text-white/40" />
              <p className="text-base text-white/60">拖曳 PDF / TXT 至此，或點擊選擇</p>
              <p className="text-base text-white/30">最大 20 MB</p>
            </>
          )}
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
  file: File | null
  items: QAItem[]
  processing: boolean
  chunkProgress: { current: number; total: number } | null
  doneInfo: { usage: TokenUsage; model: string } | null
  onUpdateItem: (id: number, patch: Partial<QAItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onClearAll: () => void
  onDownloadClick: () => void
  onReuploadClick: () => void
}

function EditStage({
  pdfUrl, file, items, processing, chunkProgress, doneInfo,
  onUpdateItem, onDeleteItem, onAddItem, onClearAll, onDownloadClick, onReuploadClick,
}: EditStageProps) {
  const PANEL_BG = '#1A3A52'
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [txtContent, setTxtContent] = useState<string | null>(null)

  useEffect(() => {
    if (file && file.name.toLowerCase().endsWith('.txt')) {
      file.text().then(setTxtContent).catch(() => setTxtContent(null))
    } else {
      setTxtContent(null)
    }
  }, [file])

  const handleCopy = () => {
    const text = items.map((it) => `Q: ${it.question}\nA: ${it.answer}`).join('\n\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">


      {/* 主體：左右分割 */}
      <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

        {/* 左：PDF 預覽 */}
        <div className="flex w-[45%] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md">
          <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5" style={{ backgroundColor: HEADER_COLOR }}>
            <FileText className="h-4 w-4 text-white/70" />
            <span className="text-base font-medium text-white/70">原始文件</span>
            <div className="flex-1" />
            <button
              type="button"
              onClick={onReuploadClick}
              className="flex items-center gap-1 rounded-lg bg-sky-700 px-2.5 py-1 text-base font-medium text-white transition hover:bg-sky-600"
            >
              <Upload className="h-3.5 w-3.5" />
              上傳
            </button>
          </div>
          <div className="flex-1 overflow-hidden bg-white">
            {pdfUrl && !txtContent ? (
              <iframe
                src={pdfUrl}
                className="h-full w-full border-0"
                title="原始 PDF 預覽"
              />
            ) : txtContent ? (
              <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words p-4 text-base leading-relaxed text-gray-800 font-sans">
                {txtContent}
              </pre>
            ) : (
              <div
                className="flex h-full cursor-pointer flex-col items-center justify-center gap-3 text-gray-300 transition-colors hover:bg-gray-50 hover:text-gray-400"
                onClick={onReuploadClick}
              >
                <Upload className="h-10 w-10" />
                <p className="text-base">點擊上傳 PDF / TXT</p>
                <p className="text-base text-gray-200">支援拖曳，最大 20 MB</p>
              </div>
            )}
          </div>
        </div>

        {/* 右：整理結果（可編輯）*/}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md" style={{ backgroundColor: PANEL_BG }}>
          <div className="flex flex-shrink-0 items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <span className="text-base font-medium text-white/70">Q&A 整理結果</span>
            {/* 進度顯示 */}
            {processing && chunkProgress && chunkProgress.total > 1 && (
              <span className="flex items-center gap-1 text-base text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                第 {chunkProgress.current}/{chunkProgress.total} 段
              </span>
            )}
            {processing && (!chunkProgress || chunkProgress.total === 1) && (
              <span className="flex items-center gap-1 text-base text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                整理中…
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDownloadClick}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              下載 Q&A
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1 text-base font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? '已複製' : '複製'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1 text-base font-semibold text-red-400/70 transition hover:bg-red-500/10 disabled:opacity-40"
              title="清空全部 Q&A"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
          </div>

          <ConfirmModal
            open={confirmClear}
            title="清空 Q&A"
            message="確定清除所有 Q&A 條目？此操作無法復原。"
            confirmText="確定清空"
            variant="danger"
            onConfirm={() => { onClearAll(); setConfirmClear(false) }}
            onCancel={() => setConfirmClear(false)}
          />

          <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4 pt-2 bg-white">
            {items.length === 0 && processing && (
              <div className="flex flex-col items-center justify-center gap-3 pt-16 text-white/40">
                <Loader2 className="h-8 w-8 animate-spin" />
                <span className="text-base">AI 正在整理中，請稍候…</span>
              </div>
            )}
            {items.length === 0 && !processing && (
              <div className="flex flex-col items-center gap-3 pt-16 text-white/30">
                <FileText className="h-8 w-8 opacity-40" />
                <p className="text-base">上傳 PDF / TXT 後，AI 將自動萃取 Q&A</p>
              </div>
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
            <div className="flex flex-shrink-0 items-center border-t border-white/10 px-4 py-2 font-mono text-base text-white/60">
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

const REWRITE_PRESETS = [
  { label: '問題更自然', instruction: '讓問題聽起來更像真人提問，更自然口語' },
  { label: '答案更清楚', instruction: '重新措辭，讓答案更容易理解' },
  { label: '答案更精簡', instruction: '去除冗詞，保留核心內容' },
]

function QACard({
  item,
  onUpdate,
  onDelete,
}: {
  item: QAItem
  onUpdate: (patch: Partial<QAItem>) => void
  onDelete: () => void
}) {
  const [question, setQuestion] = useState(item.question.trim())
  const [answer, setAnswer] = useState(item.answer.trim())
  const qRef = useRef<HTMLTextAreaElement>(null)
  const aRef = useRef<HTMLTextAreaElement>(null)

  // ── AI 改寫狀態 ──
  const [rewriteOpen, setRewriteOpen] = useState(false)
  const [customInstruction, setCustomInstruction] = useState('')
  const [rewriting, setRewriting] = useState(false)
  const [rewriteResult, setRewriteResult] = useState<{ question: string; answer: string } | null>(null)

  const autoResize = (el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => { setQuestion(item.question.trim()) }, [item.id, item.question])
  useEffect(() => { setAnswer(item.answer.trim()) }, [item.id, item.answer])
  useEffect(() => { autoResize(qRef.current) }, [question])
  useEffect(() => { autoResize(aRef.current) }, [answer])

  const handleRewrite = async (instruction: string) => {
    if (!instruction.trim()) return
    setRewriting(true)
    setRewriteResult(null)
    try {
      const result = await rewriteQAItem({ question, answer, instruction })
      setRewriteResult(result)
    } catch (err) {
      setRewriteResult({ question: `改寫失敗：${err instanceof Error ? err.message : '請重試'}`, answer })
    } finally {
      setRewriting(false)
    }
  }

  const handleApply = () => {
    if (!rewriteResult) return
    setQuestion(rewriteResult.question)
    setAnswer(rewriteResult.answer)
    onUpdate({ question: rewriteResult.question, answer: rewriteResult.answer })
    setRewriteResult(null)
    setRewriteOpen(false)
    setCustomInstruction('')
  }

  return (
    <div className="group rounded-xl border border-black/10 transition hover:border-black/20" style={{ backgroundColor: '#343434' }}>
      {/* Q / A 內容 */}
      <div className="p-4">
        <div className="mb-2 flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0 rounded-md bg-blue-500/30 px-2 py-0.5 text-base font-bold text-blue-300">
            Q{item.id}
          </span>
          <textarea
            ref={qRef}
            value={question}
            onChange={(e) => { setQuestion(e.target.value); autoResize(e.target) }}
            onBlur={() => onUpdate({ question })}
            placeholder="輸入問題…"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-lg bg-transparent text-base text-white/90 placeholder-white/30 outline-none focus:ring-1 focus:ring-blue-400/40 px-2 py-1"
          />
          <button
            onClick={() => { setRewriteOpen((v) => !v); setRewriteResult(null) }}
            className="flex-shrink-0 rounded-lg px-2 py-1 text-violet-400 transition hover:bg-violet-500/20 hover:text-violet-300"
            title="AI 改寫"
          >
            <Sparkles className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="flex-shrink-0 rounded-lg p-1 text-white/40 transition hover:bg-red-900/40 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex items-start gap-2 pl-1">
          <span className="mt-0.5 flex-shrink-0 rounded-md bg-emerald-600/30 px-2 py-0.5 text-base font-bold text-emerald-300">
            A
          </span>
          <textarea
            ref={aRef}
            value={answer}
            onChange={(e) => { setAnswer(e.target.value); autoResize(e.target) }}
            onBlur={() => onUpdate({ answer })}
            placeholder="輸入答案…"
            rows={1}
            className="flex-1 resize-none overflow-hidden rounded-lg bg-transparent text-base text-white/75 placeholder-white/25 outline-none focus:ring-1 focus:ring-emerald-400/40 px-2 py-1"
          />
        </div>
      </div>

      {/* AI 改寫面板 */}
      {rewriteOpen && (
        <div className="border-t border-white/10 px-4 pb-4 pt-3">
          <p className="mb-2 text-base font-medium text-white/50">AI 改寫</p>
          {/* 預設指令 */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REWRITE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={rewriting}
                onClick={() => setCustomInstruction((prev) =>
                  prev.trim() ? `${prev.trim()}，${p.instruction}` : p.instruction
                )}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-base text-white/60 transition hover:border-violet-400/50 hover:bg-violet-500/10 hover:text-violet-300 disabled:opacity-40"
              >
                {p.label}
              </button>
            ))}
          </div>
          {/* 自訂指令 */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleRewrite(customInstruction) }}
              placeholder="自訂指令…"
              disabled={rewriting}
              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-base text-white/70 placeholder-white/25 outline-none focus:border-violet-400/50 disabled:opacity-40"
            />
            <button
              type="button"
              disabled={rewriting || !customInstruction.trim()}
              onClick={() => handleRewrite(customInstruction)}
              className="flex items-center gap-1 rounded-lg bg-violet-600 px-2.5 py-1 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              {rewriting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              改寫
            </button>
          </div>

          {/* 改寫結果 */}
          {rewriting && (
            <div className="mt-3 flex items-center gap-2 text-base text-white/40">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> AI 改寫中…
            </div>
          )}
          {rewriteResult && !rewriting && (
            <div className="mt-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
              <p className="mb-1 text-[11px] font-semibold text-violet-400">改寫結果</p>
              <p className="mb-0.5 text-base text-white/80"><span className="text-blue-300 font-medium">Q：</span>{rewriteResult.question}</p>
              <p className="text-base text-white/70"><span className="text-emerald-300 font-medium">A：</span>{rewriteResult.answer}</p>
              <div className="mt-2.5 flex gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  className="rounded-lg bg-violet-600 px-3 py-1 text-base font-semibold text-white hover:bg-violet-500"
                >
                  套用
                </button>
                <button
                  type="button"
                  onClick={() => setRewriteResult(null)}
                  className="rounded-lg border border-white/15 px-3 py-1 text-base text-white/50 hover:bg-white/10"
                >
                  捨棄
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════
// Note Stage：筆記 → FAQ
// ══════════════════════════════════════════════════

interface NoteStageProps {
  text: string
  title: string
  items: QAItem[]
  processing: boolean
  chunkProgress: { current: number; total: number } | null
  doneInfo: { usage: TokenUsage; model: string } | null
  onTextChange: (v: string) => void
  onTitleChange: (v: string) => void
  onUpdateItem: (id: number, patch: Partial<QAItem>) => void
  onDeleteItem: (id: number) => void
  onAddItem: () => void
  onClearAll: () => void
  onProcess: () => void
  onDownloadClick: () => void
}

function NoteStage({
  text, title: _title, items, processing, chunkProgress, doneInfo,
  onTextChange, onTitleChange: _onTitleChange, onUpdateItem, onDeleteItem, onAddItem,
  onClearAll, onProcess, onDownloadClick,
}: NoteStageProps) {
  const PANEL_BG = '#1A3A52'
  const [copied, setCopied] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)

  const handleCopy = () => {
    const t = items.map((it) => `Q: ${it.question}\nA: ${it.answer}`).join('\n\n')
    navigator.clipboard.writeText(t).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">

      {/* 左：貼入文字 */}
      <div
        className="flex w-[45%] shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
      >
        <div className="flex items-center gap-2 border-b border-white/20 px-4 py-2.5" style={{ backgroundColor: HEADER_COLOR }}>
          <BookOpen className="h-4 w-4 text-white/70" />
          <span className="text-base font-medium text-white/70">原始筆記</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onProcess}
            disabled={processing || !text.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
          >
            {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            轉成 Q&A
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-hidden bg-white p-3">
          <textarea
            value={text}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={"貼入或輸入任意文字…\n\n例：\n- 會議紀錄\n- SOP 說明\n- 規章條文\n- 產品說明\n\nAI 將協助轉換為 Q&A 格式"}
            className="flex-1 resize-none rounded-lg bg-transparent p-3 text-base text-gray-700 placeholder-gray-300 outline-none focus:ring-1 focus:ring-sky-400/60"
          />
        </div>
      </div>

      {/* 右：Q&A 整理結果 */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md"
        style={{ backgroundColor: PANEL_BG }}
      >
        {/* 操作按鈕列 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-white/20 px-4 py-2.5">
            <span className="text-base font-medium text-white/70">Q&A 整理結果</span>
            {processing && chunkProgress && chunkProgress.total > 1 && (
              <span className="flex items-center gap-1 text-base text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                第 {chunkProgress.current}/{chunkProgress.total} 段
              </span>
            )}
            {processing && (!chunkProgress || chunkProgress.total === 1) && (
              <span className="flex items-center gap-1 text-base text-sky-400/80">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                整理中…
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={onDownloadClick}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1 text-base font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              下載 Q&A
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={items.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1 text-base font-semibold text-white/70 transition hover:bg-white/10 disabled:opacity-40"
            >
              {copied ? <ClipboardCheck className="h-3.5 w-3.5 text-emerald-400" /> : <Clipboard className="h-3.5 w-3.5" />}
              {copied ? '已複製' : '複製'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={items.length === 0 || processing}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1 text-base font-semibold text-red-400/70 transition hover:bg-red-500/10 disabled:opacity-40"
              title="清空全部 Q&A"
            >
              <Trash2 className="h-3.5 w-3.5" />
              清空
            </button>
        </div>

        <ConfirmModal
          open={confirmClear}
          title="清空 Q&A"
          message="確定清除所有 Q&A 條目？此操作無法復原。"
          confirmText="確定清空"
          variant="danger"
          onConfirm={() => { onClearAll(); setConfirmClear(false) }}
          onCancel={() => setConfirmClear(false)}
        />

        {/* Q&A 卡片列表 */}
        <div className="flex-1 space-y-1 overflow-y-auto px-4 pb-4 pt-2 bg-white">
          {items.length === 0 && processing && (
            <div className="flex flex-col items-center justify-center gap-3 pt-16 text-white/40">
              <Loader2 className="h-8 w-8 animate-spin" />
              <span className="text-base">AI 正在整理中，請稍候…</span>
            </div>
          )}
          {items.length === 0 && !processing && (
            <div className="flex flex-col items-center gap-3 pt-16 text-white/30">
              <Sparkles className="h-8 w-8 opacity-40" />
              <p className="text-base">在左側貼入文字後，點擊「全部轉為 Q&A」</p>
            </div>
          )}

          {items.map((item) => (
            <QACard
              key={item.id}
              item={item}
              onUpdate={(patch) => onUpdateItem(item.id, patch)}
              onDelete={() => onDeleteItem(item.id)}
            />
          ))}

          {items.length > 0 && (
            <button
              type="button"
              onClick={onAddItem}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 py-3 text-base text-white/40 transition hover:border-white/40 hover:text-white/60"
            >
              <Plus className="h-4 w-4" />
              新增一條
            </button>
          )}
        </div>
        {doneInfo && (
          <div className="flex flex-shrink-0 items-center border-t border-white/10 px-4 py-2 font-mono text-base text-white/60">
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
  )
}

// ══════════════════════════════════════════════════
// 重新上傳 Modal
// ══════════════════════════════════════════════════

function ReuploadModal({
  hasExistingItems,
  title = '上傳文件',
  onConfirm,
  onClose,
}: {
  hasExistingItems: boolean
  title?: string
  onConfirm: (file: File, append: boolean) => void
  onClose: () => void
}) {
  const MODAL_BG = '#1A3A52'
  const [tempFile, setTempFile] = useState<File | null>(null)
  const [append, setAppend] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleSubmit = () => {
    if (!tempFile) return
    if (hasExistingItems && !append) {
      setConfirmOpen(true)
    } else {
      onConfirm(tempFile, append)
    }
  }

  const handleFile = (f: File | undefined) => {
    if (!f) return
    if (!f.name.toLowerCase().match(/\.(pdf|txt)$/)) {
      setFileError('目前支援 PDF 或 TXT 格式')
      return
    }
    setFileError('')
    setTempFile(f)
  }

  return (
    <>
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-white/20 p-6 shadow-2xl"
        style={{ backgroundColor: MODAL_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-400/20">
            <Upload className="h-4 w-4 text-sky-300" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">{title}</h3>
            <p className="text-base text-white/50">選擇 PDF / TXT，AI 自動開始整理</p>
          </div>
        </div>

        {/* 拖曳上傳區 */}
        <div
          className={`mb-4 flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-7 transition-colors ${
            tempFile
              ? 'border-sky-400/60 bg-sky-900/20'
              : 'border-white/20 hover:border-white/40 hover:bg-white/5'
          }`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0]) }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          {tempFile ? (
            <>
              <FileText className="h-7 w-7 text-sky-400" />
              <div className="text-center">
                <p className="text-base font-medium text-white">{tempFile.name}</p>
                <p className="text-base text-white/50">{(tempFile.size / 1024).toFixed(1)} KB</p>
              </div>
              <p className="text-base text-white/40">點擊重新選擇</p>
            </>
          ) : (
            <>
              <Upload className="h-7 w-7 text-white/40" />
              <p className="text-base text-white/60">拖曳 PDF / TXT 至此，或點擊選擇</p>
              <p className="text-base text-white/30">最大 20 MB</p>
            </>
          )}
        </div>
        {fileError && <p className="mb-3 text-base text-red-400">{fileError}</p>}

        {/* 累加模式 toggle（有舊 Q&A 時顯示）*/}
        {hasExistingItems && (
          <div className="mb-5 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-2.5">
            <div>
              <p className="text-base font-medium text-white/80">Q&A 累加模式</p>
              <p className="text-base text-white/40">{append ? '新 Q&A 將附加到現有清單' : '新 Q&A 將取代現有清單'}</p>
            </div>
            <button
              type="button"
              onClick={() => setAppend((v) => !v)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${append ? 'bg-sky-500' : 'bg-white/20'}`}
              role="switch"
              aria-checked={append}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${append ? 'translate-x-5' : 'translate-x-0'}`}
              />
            </button>
          </div>
        )}

        {/* 按鈕 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl border border-white/20 py-2.5 text-base text-white/60 hover:bg-white/10"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!tempFile}
            onClick={handleSubmit}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: '#0e7490' }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            開始整理
          </button>
        </div>
      </div>
    </div>

    <ConfirmModal
      open={confirmOpen}
      title="確認取代 Q&A"
      message="目前的 Q&A 清單將被清除，確定繼續？"
      confirmText="確認取代"
      cancelText="取消"
      variant="danger"
      onConfirm={() => { setConfirmOpen(false); onConfirm(tempFile!, false) }}
      onCancel={() => setConfirmOpen(false)}
    />
  </>
  )
}

// ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════
// 下載 Q&A Modal（下載 TXT + 可選匯入 KB）
// ══════════════════════════════════════════════════

function DownloadModal({
  qaTitle,
  onExportTxt,
  onImport,
  onClose,
}: {
  qaTitle: string
  onExportTxt: (qaSetName: string) => Promise<void>
  onImport: (kbId: number | undefined, newKbName: string | undefined, qaSetName: string) => Promise<void>
  onClose: () => void
}) {
  const MODAL_BG = '#1A3A52'
  const [qaSetName, setQaSetName] = useState(qaTitle)
  const [importEnabled, setImportEnabled] = useState(false)
  const [kbs, setKbs] = useState<KBOption[]>([])
  const [kbsLoading, setKbsLoading] = useState(false)
  const [selectedKbId, setSelectedKbId] = useState<number | 'new' | ''>('')
  const [newKbName, setNewKbName] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (importEnabled && kbs.length === 0 && !kbsLoading) {
      setKbsLoading(true)
      listKBs()
        .then((data) => { setKbs(data); if (data.length > 0) setSelectedKbId(data[0].id) })
        .catch(() => setSelectedKbId('new'))
        .finally(() => setKbsLoading(false))
    }
  }, [importEnabled])

  const selectedKbName = selectedKbId === 'new'
    ? (newKbName.trim() || '新知識庫')
    : (kbs.find((kb) => kb.id === selectedKbId)?.name ?? '')

  const canConfirm = !loading && (
    !importEnabled ||
    (selectedKbId === 'new' ? newKbName.trim().length > 0 : typeof selectedKbId === 'number')
  )

  const handleConfirm = async () => {
    setLoading(true)
    const name = qaSetName.trim() || qaTitle
    try {
      await onExportTxt(name)
      if (importEnabled) {
        const kbId = typeof selectedKbId === 'number' ? selectedKbId : undefined
        const newKb = selectedKbId === 'new' ? newKbName.trim() : undefined
        await onImport(kbId, newKb, name)
      }
      onClose()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-white/20 p-6 shadow-2xl"
        style={{ backgroundColor: MODAL_BG }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-semibold text-white">下載 Q&A</h3>

        {/* Q&A 集名稱 */}
        <div className="mb-4">
          <label className="mb-1.5 block text-base text-white/60">Q&A 集名稱</label>
          <input
            type="text"
            value={qaSetName}
            onChange={(e) => setQaSetName(e.target.value)}
            placeholder="輸入名稱…"
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-sky-400"
          />
        </div>

        {/* 匯入 KB toggle */}
        <div
          className="mb-4 flex cursor-pointer items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3"
          onClick={() => setImportEnabled((v) => !v)}
        >
          <div>
            <p className="text-base font-medium text-white/80">同時匯入至知識庫</p>
            <p className="text-base text-white/40">{importEnabled ? '下載後自動匯入' : '僅下載 TXT'}</p>
          </div>
          <button
            type="button"
            className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${importEnabled ? 'bg-sky-500' : 'bg-white/20'}`}
            role="switch"
            aria-checked={importEnabled}
            onClick={(e) => { e.stopPropagation(); setImportEnabled((v) => !v) }}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${importEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>

        {/* KB 選擇（toggle ON 後才顯示）*/}
        {importEnabled && (
          <div className="mb-4 space-y-3">
            {kbsLoading ? (
              <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-white/40" /></div>
            ) : (
              <>
                <div>
                  <label className="mb-1.5 block text-base text-white/60">選擇知識庫</label>
                  <select
                    value={selectedKbId === '' ? '' : String(selectedKbId)}
                    onChange={(e) => {
                      const v = e.target.value
                      setSelectedKbId(v === 'new' ? 'new' : Number(v))
                    }}
                    className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white outline-none focus:border-sky-400"
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
                  <div>
                    <label className="mb-1.5 block text-base text-white/60">新知識庫名稱</label>
                    <input
                      type="text"
                      value={newKbName}
                      onChange={(e) => setNewKbName(e.target.value)}
                      placeholder="輸入名稱…"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-base text-white placeholder-white/30 outline-none focus:border-sky-400"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 確認摘要 */}
        <p className="mb-3 text-base text-white/50">
          {importEnabled
            ? `將下載 TXT 並匯入至「${selectedKbName}」`
            : '將下載 TXT 檔案'}
        </p>

        {/* 按鈕 */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 rounded-xl border border-white/20 py-2.5 text-base text-white/60 hover:bg-white/10 disabled:opacity-40"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            style={{ backgroundColor: '#0e7490' }}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            確認下載
          </button>
        </div>
      </div>
    </div>
  )
}

