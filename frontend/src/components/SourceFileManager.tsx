/** 可重複使用的來源檔案管理元件：列表、上傳、選用、重新命名、刪除（含 header） */
import { useEffect, useState } from 'react'
import { FileEdit, FileText, HelpCircle, Pencil, Plus, X } from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import {
  listSourceFiles,
  uploadSourceFile,
  createSourceFileFromText,
  updateSourceFileSelected,
  renameSourceFile,
  deleteSourceFile,
  getSourceFile,
  updateSourceFileContent,
  type SourceFileItem,
} from '@/api/sourceFiles'
import { ApiError } from '@/api/client'

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  if (err instanceof Error) return err.message
  return '操作失敗，請稍後再試'
}

export interface SourceFileManagerProps {
  agentId: string
  onError?: (message: string) => void
  /** 標題列右側按鈕（如折疊） */
  headerActions?: React.ReactNode
}

export default function SourceFileManager({
  agentId,
  onError,
  headerActions,
}: SourceFileManagerProps) {
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  const [sourceFiles, setSourceFiles] = useState<SourceFileItem[]>([])
  const [sourceFilesLoading, setSourceFilesLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [pendingTextItems, setPendingTextItems] = useState<{ file_name: string; content: string }[]>(
    []
  )
  const [textInputOpen, setTextInputOpen] = useState(false)
  const [textInputContent, setTextInputContent] = useState('')
  const [textInputFileName, setTextInputFileName] = useState('文字內容#1')
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null)
  const [editContentId, setEditContentId] = useState<number | null>(null)
  const [editContentValue, setEditContentValue] = useState('')
  const [editContentLoading, setEditContentLoading] = useState(false)
  const [editContentSaving, setEditContentSaving] = useState(false)

  const showListError = (msg: string) => {
    setListError(msg)
    onError?.(msg)
  }

  useEffect(() => {
    setListError(null)
    listSourceFiles(agentId)
      .then((data) => {
        setSourceFiles(data)
        setListError(null)
      })
      .catch(() => {
        setSourceFiles([])
        showListError('載入失敗，請重新整理頁面')
      })
      .finally(() => setSourceFilesLoading(false))
  }, [agentId])

  const refreshSourceFiles = () => {
    setListError(null)
    listSourceFiles(agentId)
      .then(setSourceFiles)
      .catch(() => showListError('重新載入失敗，請稍後再試'))
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    const allFiles = Array.from(files)
    const csvFiles = allFiles.filter((f) => f.name.toLowerCase().endsWith('.csv'))
    const nonCsvCount = allFiles.length - csvFiles.length

    const existing = new Set([
      ...sourceFiles.map((f) => f.file_name),
      ...pendingFiles.map((f) => f.name),
      ...pendingTextItems.map((t) => t.file_name),
    ])
    const newFiles = csvFiles.filter((f) => !existing.has(f.name))
    const duplicateCount = csvFiles.length - newFiles.length

    setPendingFiles((prev) => [...prev, ...newFiles])

    const parts: string[] = []
    if (duplicateCount > 0) parts.push(`發現重複檔案，已經忽略`)
    if (nonCsvCount > 0) parts.push(`已略過 ${nonCsvCount} 個非 CSV 檔案`)
    setFileMessage(parts.length > 0 ? parts.join('、') : null)

    e.target.value = ''
  }

  const removePendingFile = (index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const removePendingTextItem = (index: number) => {
    setPendingTextItems((prev) => prev.filter((_, i) => i !== index))
  }

  const getNextTextContentName = () => {
    const allNames = [
      ...sourceFiles.map((f) => f.file_name),
      ...pendingFiles.map((f) => f.name),
      ...pendingTextItems.map((t) => t.file_name),
    ]
    const matches = allNames
      .map((n) => n.match(/^文字內容#(\d+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
    const maxNum = matches.length
      ? Math.max(...matches.map((m) => parseInt(m[1], 10)))
      : 0
    return `文字內容#${maxNum + 1}`
  }

  const addPendingTextItem = () => {
    const content = textInputContent.trim()
    if (!content) {
      setFileMessage('請輸入內容')
      return
    }
    const rawName = textInputFileName.trim()
    const finalName = rawName || getNextTextContentName()
    const existing = new Set([
      ...sourceFiles.map((f) => f.file_name),
      ...pendingFiles.map((f) => f.name),
      ...pendingTextItems.map((t) => t.file_name),
    ])
    if (existing.has(finalName)) {
      setFileMessage('已經上傳，檔案重複')
      return
    }
    setPendingTextItems((prev) => [...prev, { file_name: finalName, content }])
    setTextInputContent('')
    setTextInputFileName(getNextTextContentName())
    setTextInputOpen(false)
    setFileMessage(null)
  }

  const handleConfirm = async () => {
    const totalFiles = pendingFiles.length
    const totalText = pendingTextItems.length
    const total = totalFiles + totalText
    if (total === 0) return
    setUploading(true)
    setUploadProgress({ current: 0, total })
    setFileMessage(null)
    let duplicateCount = 0
    let done = 0
    for (const file of pendingFiles) {
      done += 1
      setUploadProgress({ current: done, total })
      try {
        await uploadSourceFile(agentId, file)
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          duplicateCount += 1
        } else {
          const msg = getErrorMessage(err)
          setFileMessage(msg)
          onError?.(msg)
          refreshSourceFiles()
          setUploading(false)
          setUploadProgress(null)
          return
        }
      }
    }
    for (const item of pendingTextItems) {
      done += 1
      setUploadProgress({ current: done, total })
      try {
        await createSourceFileFromText(agentId, item.file_name, item.content)
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          duplicateCount += 1
        } else {
          const msg = getErrorMessage(err)
          setFileMessage(msg)
          onError?.(msg)
          refreshSourceFiles()
          setUploading(false)
          setUploadProgress(null)
          return
        }
      }
    }
    if (duplicateCount > 0) {
      setFileMessage('已經上傳，檔案重複')
    }
    setPendingFiles([])
    setPendingTextItems([])
    refreshSourceFiles()
    setUploading(false)
    setUploadProgress(null)
    if (duplicateCount === 0) setAddSourceOpen(false)
  }

  const handleCancel = () => {
    setPendingFiles([])
    setPendingTextItems([])
    setTextInputOpen(false)
    setTextInputContent('')
    setTextInputFileName('文字內容#1')
    setFileMessage(null)
    setAddSourceOpen(false)
  }

  return (
    <>
      <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
        <div className="flex items-center gap-1">
          <span>來源</span>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-200"
            aria-label="使用說明"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>
        {headerActions}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {listError && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">
            <span>{listError}</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={refreshSourceFiles}
                className="rounded px-2 py-0.5 text-red-700 underline hover:bg-red-100"
              >
                重試
              </button>
              <button
                type="button"
                onClick={() => setListError(null)}
                className="rounded p-0.5 hover:bg-red-100"
                aria-label="關閉"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => setAddSourceOpen(true)}
          className="flex w-full shrink-0 items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50/80 py-4 text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-100 hover:shadow-sm"
        >
          <Plus className="h-5 w-5" />
          新增來源
        </button>
        {sourceFilesLoading ? (
          <p className="py-2 text-gray-500">載入中...</p>
        ) : sourceFiles.length === 0 ? (
          <p className="py-2 text-center text-gray-500">尚無來源檔案</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sourceFiles.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 ring-1 ring-gray-200/40"
              >
                <input
                  type="checkbox"
                  checked={f.is_selected}
                  onChange={(e) => {
                    const checked = e.target.checked
                    const prevFiles = [...sourceFiles]
                    setSourceFiles((prev) =>
                      prev.map((x) =>
                        x.id === f.id ? { ...x, is_selected: checked } : x
                      )
                    )
                    updateSourceFileSelected(f.id, checked)
                      .then((updated) => {
                        setSourceFiles((prev) =>
                          prev.map((x) => (x.id === f.id ? updated : x))
                        )
                      })
                      .catch((err) => {
                        setSourceFiles(prevFiles)
                        showListError(getErrorMessage(err))
                      })
                  }}
                  className="h-4 w-4 shrink-0 rounded border-gray-300"
                  aria-label={`選用 ${f.file_name}`}
                />
                {renamingId === f.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        const name = renameValue.trim()
                        if (name && name !== f.file_name) {
                          renameSourceFile(f.id, name)
                            .then((updated) => {
                              setSourceFiles((prev) =>
                                prev.map((x) => (x.id === f.id ? updated : x))
                              )
                              setRenamingId(null)
                            })
                            .catch((err) => {
                              setRenameValue(f.file_name)
                              showListError(getErrorMessage(err))
                            })
                        }
                      } else if (e.key === 'Escape') {
                        setRenamingId(null)
                        setRenameValue(f.file_name)
                      }
                    }}
                    onBlur={() => {
                      const name = renameValue.trim()
                      if (name && name !== f.file_name) {
                        renameSourceFile(f.id, name)
                          .then((updated) => {
                            setSourceFiles((prev) =>
                              prev.map((x) => (x.id === f.id ? updated : x))
                            )
                            setRenamingId(null)
                          })
                          .catch((err) => {
                            setRenameValue(f.file_name)
                            showListError(getErrorMessage(err))
                          })
                      } else {
                        setRenamingId(null)
                      }
                    }}
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-0.5 text-gray-700"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{f.file_name}</span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (renamingId === f.id) return
                    setRenamingId(f.id)
                    setRenameValue(f.file_name)
                  }}
                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="重新命名"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditContentId(f.id)
                    setEditContentValue('')
                    setEditContentLoading(true)
                    getSourceFile(f.id)
                      .then((detail) => setEditContentValue(detail.content))
                      .catch((err) => {
                        showListError(getErrorMessage(err))
                        setEditContentId(null)
                      })
                      .finally(() => setEditContentLoading(false))
                  }}
                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="編輯內容"
                >
                  <FileEdit className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(f.id)}
                  className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="刪除"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 新增來源 modal */}
      {addSourceOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => handleCancel()}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 min-w-[1200px] max-w-[90vw] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-semibold text-gray-800">新增來源</h2>
            {(fileMessage || uploadProgress) && (
              <div className="mb-3 space-y-2">
                {uploadProgress && (
                  <p className="rounded-lg bg-blue-50 px-3 py-2 text-blue-800">
                    上傳中 {uploadProgress.current}/{uploadProgress.total}
                  </p>
                )}
                {fileMessage && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
                    {fileMessage}
                  </p>
                )}
              </div>
            )}
            <label className="mb-3 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-6 transition-colors hover:border-gray-400 hover:bg-gray-100">
              <Plus className="mb-2 h-8 w-8 text-gray-500" />
              <span className="text-gray-600">選擇 CSV 檔案（可多選）</span>
              <input
                type="file"
                accept=".csv"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setTextInputOpen((prev) => {
                  if (!prev) setTextInputFileName(getNextTextContentName())
                  return !prev
                })
              }}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 py-4 transition-colors hover:border-gray-400 hover:bg-gray-100"
            >
              <FileText className="h-5 w-5 text-gray-500" />
              <span className="text-gray-600">輸入文字</span>
            </button>
            {textInputOpen && (
              <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <label className="mb-1 block text-sm text-gray-600">檔名</label>
                <input
                  type="text"
                  value={textInputFileName}
                  onChange={(e) => setTextInputFileName(e.target.value)}
                  placeholder="文字內容#1"
                  className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-gray-700"
                />
                <label className="mb-1 block text-sm text-gray-600">內容</label>
                <textarea
                  value={textInputContent}
                  onChange={(e) => setTextInputContent(e.target.value)}
                  placeholder="貼上或輸入文字..."
                  rows={5}
                  className="mb-2 w-full rounded border border-gray-300 px-3 py-2 text-gray-700"
                />
                <button
                  type="button"
                  onClick={addPendingTextItem}
                  className="rounded-lg bg-gray-700 px-3 py-1.5 text-white hover:bg-gray-800"
                >
                  加入
                </button>
              </div>
            )}
            {(pendingFiles.length > 0 || pendingTextItems.length > 0) && (
              <ul className="mb-4 max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-2">
                {pendingFiles.map((f, i) => (
                  <li
                    key={`file-${f.name}-${i}`}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span className="truncate text-gray-700">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removePendingFile(i)}
                      className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      aria-label="移除"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
                {pendingTextItems.map((t, i) => (
                  <li
                    key={`text-${t.file_name}-${i}`}
                    className="flex items-center justify-between gap-2 py-1"
                  >
                    <span className="truncate text-gray-700">{t.file_name}</span>
                    <button
                      type="button"
                      onClick={() => removePendingTextItem(i)}
                      className="shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                      aria-label="移除"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={(pendingFiles.length === 0 && pendingTextItems.length === 0) || uploading}
                className="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {uploading && uploadProgress
                  ? `上傳中 ${uploadProgress.current}/${uploadProgress.total}`
                  : '確認'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編輯內容 modal */}
      {editContentId !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 flex max-h-[85vh] min-w-[1200px] max-w-[90vw] flex-col rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-semibold text-gray-800">
              編輯內容 — {sourceFiles.find((x) => x.id === editContentId)?.file_name ?? ''}
            </h2>
            {editContentLoading ? (
              <p className="py-8 text-center text-gray-500">載入中...</p>
            ) : (
              <>
                <label className="mb-1 block text-sm text-gray-600">內容</label>
                <textarea
                  value={editContentValue}
                  onChange={(e) => setEditContentValue(e.target.value)}
                  placeholder="貼上或輸入文字..."
                  rows={12}
                  disabled={editContentSaving}
                  className="mb-4 min-h-0 flex-1 resize-y rounded border border-gray-300 px-3 py-2 text-gray-700 disabled:bg-gray-100"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditContentId(null)}
                    disabled={editContentSaving}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (editContentId === null) return
                      setEditContentSaving(true)
                      try {
                        await updateSourceFileContent(editContentId, editContentValue)
                        setEditContentId(null)
                      } catch (err) {
                        showListError(getErrorMessage(err))
                      } finally {
                        setEditContentSaving(false)
                      }
                    }}
                    disabled={editContentSaving}
                    className="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    {editContentSaving ? '儲存中...' : '儲存'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={deleteConfirmId !== null}
        title="確認刪除"
        message={`確定要刪除「${sourceFiles.find((x) => x.id === deleteConfirmId)?.file_name ?? ''}」嗎？`}
        confirmText="確認刪除"
        onConfirm={() => {
          const id = deleteConfirmId
          const file = sourceFiles.find((x) => x.id === id)
          setDeleteConfirmId(null)
          if (!file || id === null) return
          const prevFiles = [...sourceFiles]
          setSourceFiles((prev) => prev.filter((x) => x.id !== id))
          deleteSourceFile(id)
            .then(refreshSourceFiles)
            .catch((err) => {
              setSourceFiles(prevFiles)
              showListError(getErrorMessage(err))
            })
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-sourcefile.md"
      />
    </>
  )
}
