/** 統一來源清單 UI：以 SourceFileManager 為準，透過 Adapter 切換資料來源 */
import { useEffect, useState } from 'react'
import { FileEdit, FileText, HelpCircle, Pencil, Plus, X } from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import type { SourceListAdapter, SourceListItem } from '@/adapters/sourceListAdapter'
import { ApiError } from '@/api/client'

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  if (err instanceof Error) return err.message
  return '操作失敗，請稍後再試'
}

export interface SourceListManagerProps {
  adapter: SourceListAdapter
  title?: string
  showHelp?: boolean
  helpUrl?: string
  /** 隱藏 header，僅顯示內容區（用於嵌入其他區塊時） */
  hideHeader?: boolean
  headerActions?: React.ReactNode
  onError?: (message: string) => void
}

export default function SourceListManager({
  adapter,
  title = '來源',
  showHelp = false,
  helpUrl = '/help-sourcefile.md',
  hideHeader = false,
  headerActions,
  onError,
}: SourceListManagerProps) {
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [addSourceOpen, setAddSourceOpen] = useState(false)
  const [items, setItems] = useState<SourceListItem[]>([])
  const [loading, setLoading] = useState(true)
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
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [editContentId, setEditContentId] = useState<string | null>(null)
  const [editContentValue, setEditContentValue] = useState('')
  const [editContentLoading, setEditContentLoading] = useState(false)
  const [editContentSaving, setEditContentSaving] = useState(false)

  const { config } = adapter
  const showListError = (msg: string) => {
    setListError(msg)
    onError?.(msg)
  }

  const refresh = () => {
    setListError(null)
    adapter
      .list()
      .then(setItems)
      .catch(() => showListError('重新載入失敗，請稍後再試'))
  }

  useEffect(() => {
    setListError(null)
    setLoading(true)
    adapter
      .list()
      .then((data) => {
        setItems(data)
        setListError(null)
      })
      .catch(() => {
        setItems([])
        showListError('載入失敗，請重新整理頁面')
      })
      .finally(() => setLoading(false))
  }, [adapter])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    const allFiles = Array.from(files).filter((f) => f.size > 0 && f.size < 1024 * 1024)
    const accept = config.fileAccept ?? '.csv,.txt,.md,.json'
    const extList = accept.split(',').map((x) => x.trim().toLowerCase().replace(/^\*/, ''))
    const filtered =
      extList.length === 0
        ? allFiles
        : allFiles.filter((f) =>
            extList.some((ext) => f.name.toLowerCase().endsWith(ext))
          )
    const nonMatchCount = allFiles.length - filtered.length

    const existing = new Set([
      ...items.map((f) => f.file_name),
      ...pendingFiles.map((f) => f.name),
      ...pendingTextItems.map((t) => t.file_name),
    ])
    const newFiles = filtered.filter((f) => !existing.has(f.name))
    const duplicateCount = filtered.length - newFiles.length

    setPendingFiles((prev) => [...prev, ...newFiles])

    const parts: string[] = []
    if (duplicateCount > 0) parts.push(`發現重複檔案，已經忽略`)
    if (nonMatchCount > 0) parts.push(`已略過 ${nonMatchCount} 個不符合格式的檔案`)
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
      ...items.map((f) => f.file_name),
      ...pendingFiles.map((f) => f.name),
      ...pendingTextItems.map((t) => t.file_name),
    ]
    const matches = allNames
      .map((n) => n.match(/^文字內容#(\d+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
    const maxNum = matches.length ? Math.max(...matches.map((m) => parseInt(m[1], 10))) : 0
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
      ...items.map((f) => f.file_name),
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
        const created = await adapter.uploadFile(file)
        setItems((prev) => [...prev, created])
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          duplicateCount += 1
        } else {
          setFileMessage(getErrorMessage(err))
          onError?.(getErrorMessage(err))
          refresh()
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
        const created = await adapter.createFromText(item)
        setItems((prev) => [...prev, created])
      } catch (err) {
        if (err instanceof ApiError && err.status === 400) {
          duplicateCount += 1
        } else {
          setFileMessage(getErrorMessage(err))
          onError?.(getErrorMessage(err))
          refresh()
          setUploading(false)
          setUploadProgress(null)
          return
        }
      }
    }
    if (duplicateCount > 0) setFileMessage('已經上傳，檔案重複')
    setPendingFiles([])
    setPendingTextItems([])
    refresh()
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

  const loadEditContent = (id: string) => {
    const item = items.find((x) => x.id === id)
    if (item?.content != null) {
      setEditContentValue(item.content ?? '')
      return
    }
    if (adapter.getContent) {
      setEditContentLoading(true)
      adapter
        .getContent(id)
        .then(setEditContentValue)
        .catch((err) => {
          showListError(getErrorMessage(err))
          setEditContentId(null)
        })
        .finally(() => setEditContentLoading(false))
    } else {
      setEditContentValue('')
    }
  }

  return (
    <>
      {!hideHeader && (
      <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
        <div className="flex items-center gap-1">
          <span>{title}</span>
          {showHelp && (
            <button
              type="button"
              onClick={() => setShowHelpModal(true)}
              className="rounded-2xl p-1.5 text-gray-600 transition-colors hover:bg-gray-200"
              aria-label="使用說明"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          )}
        </div>
        {headerActions}
      </header>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {listError && (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">
            <span>{listError}</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={refresh}
                className="rounded-2xl px-2 py-0.5 text-red-700 underline hover:bg-red-100"
              >
                重試
              </button>
              <button
                type="button"
                onClick={() => setListError(null)}
                className="rounded-2xl p-0.5 hover:bg-red-100"
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
          className="flex w-full shrink-0 items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/80 py-4 text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-100 hover:shadow-sm"
        >
          <Plus className="h-5 w-5" />
          新增來源
        </button>
        {loading ? (
          <p className="py-2 text-gray-500">載入中...</p>
        ) : items.length === 0 ? (
          <p className="py-2 text-center text-gray-500">
            {config.emptyMessage ?? '尚無來源'}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {items.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-gray-700 ring-1 ring-gray-200/40"
              >
                {config.supportsCheckbox && (
                  <input
                    type="checkbox"
                    checked={f.is_selected ?? false}
                    onChange={(e) => {
                      const checked = e.target.checked
                      const prevItems = [...items]
                      setItems((prev) =>
                        prev.map((x) =>
                          x.id === f.id ? { ...x, is_selected: checked } : x
                        )
                      )
                      adapter
                        .update({ id: f.id, is_selected: checked })
                        .then((updated) => {
                          setItems((prev) =>
                            prev.map((x) => (x.id === f.id ? updated : x))
                          )
                        })
                        .catch((err) => {
                          setItems(prevItems)
                          showListError(getErrorMessage(err))
                        })
                    }}
                    className="h-4 w-4 shrink-0 rounded border-gray-300"
                    aria-label={`選用 ${f.file_name}`}
                  />
                )}
                {renamingId === f.id ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                        const name = renameValue.trim()
                        if (name && name !== f.file_name) {
                          adapter
                            .update({ id: f.id, file_name: name })
                            .then((updated) => {
                              setItems((prev) =>
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
                        adapter
                          .update({ id: f.id, file_name: name })
                          .then((updated) => {
                            setItems((prev) =>
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
                  className="shrink-0 rounded-2xl p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="重新命名"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditContentId(f.id)
                    setEditContentValue('')
                    loadEditContent(f.id)
                  }}
                  className="shrink-0 rounded-2xl p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="編輯內容"
                >
                  <FileEdit className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(f.id)}
                  className="shrink-0 rounded-2xl p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
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
          onClick={handleCancel}
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
              <span className="text-gray-600">
                {config.fileUploadLabel ?? '選擇檔案（可多選）'}
              </span>
              <input
                type="file"
                accept={config.fileAccept}
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
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50 py-4 transition-colors hover:border-gray-400 hover:bg-gray-100"
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
                  className="rounded-2xl bg-gray-700 px-3 py-1.5 text-white hover:bg-gray-800"
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
                      className="shrink-0 rounded-2xl p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
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
                      className="shrink-0 rounded-2xl p-0.5 text-gray-500 hover:bg-gray-200 hover:text-gray-700"
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
                className="rounded-2xl border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  (pendingFiles.length === 0 && pendingTextItems.length === 0) || uploading
                }
                className="rounded-2xl bg-gray-700 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
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
              編輯內容 — {items.find((x) => x.id === editContentId)?.file_name ?? ''}
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
                    className="rounded-2xl border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (editContentId === null) return
                      setEditContentSaving(true)
                      try {
                        const updated = await adapter.update({
                          id: editContentId,
                          content: editContentValue,
                        })
                        setItems((prev) =>
                          prev.map((x) => (x.id === editContentId ? updated : x))
                        )
                        setEditContentId(null)
                      } catch (err) {
                        showListError(getErrorMessage(err))
                      } finally {
                        setEditContentSaving(false)
                      }
                    }}
                    disabled={editContentSaving}
                    className="rounded-2xl bg-gray-700 px-4 py-2 text-white hover:bg-gray-800 disabled:opacity-50"
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
        message={`確定要刪除「${items.find((x) => x.id === deleteConfirmId)?.file_name ?? ''}」嗎？`}
        confirmText="確認刪除"
        onConfirm={() => {
          const id = deleteConfirmId
          setDeleteConfirmId(null)
          if (!id) return
          const prevItems = [...items]
          setItems((prev) => prev.filter((x) => x.id !== id))
          adapter
            .delete(id)
            .then(refresh)
            .catch((err) => {
              setItems(prevItems)
              showListError(getErrorMessage(err))
            })
        }}
        onCancel={() => setDeleteConfirmId(null)}
      />
      {showHelp && (
        <HelpModal
          open={showHelpModal}
          onClose={() => setShowHelpModal(false)}
          url={helpUrl}
        />
      )}
    </>
  )
}
