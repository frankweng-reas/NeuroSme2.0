/**
 * 範例問題：獨立視窗 — 選用（系統／我的）與維護我的範例分區，避免與對話區混雜
 */
import { useState } from 'react'
import { ChevronDown, Copy, Lightbulb, Trash2, X } from 'lucide-react'
import type { ExamplePromptItem } from '@/types/examplePrompts'

const MAX_CHARS = 280

export interface ExamplePromptsModalProps {
  open: boolean
  onClose: () => void
  examplePrompts: readonly ExamplePromptItem[]
  /** 「我的範例」：選一則帶入對話輸入框（系統提供僅複製，不呼叫此函式） */
  onPick: (text: string) => void
  onAdd?: (text: string) => void
  onRemove?: (id: string) => void
  isLoading?: boolean
  onCopySuccess?: () => void
  onCopyError?: () => void
}

export default function ExamplePromptsModal({
  open,
  onClose,
  examplePrompts,
  onPick,
  onAdd,
  onRemove,
  isLoading = false,
  onCopySuccess,
  onCopyError,
}: ExamplePromptsModalProps) {
  const [draft, setDraft] = useState('')
  const [activeTab, setActiveTab] = useState<'pick' | 'manage'>('pick')
  const [systemSectionOpen, setSystemSectionOpen] = useState(true)
  const [userSectionOpen, setUserSectionOpen] = useState(true)

  if (!open) return null

  const systemItems = examplePrompts.filter((p) => p.isSystem)
  const userItems = examplePrompts.filter((p) => !p.isSystem)

  const handlePick = (text: string) => {
    onPick(text.trim())
    onClose()
    setDraft('')
  }

  const handleAdd = () => {
    const t = draft.trim()
    if (!t || !onAdd) return
    onAdd(t)
    setDraft('')
  }

  const copySystemText = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => onCopySuccess?.(),
      () => onCopyError?.()
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <button
        type="button"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        aria-label="關閉"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="example-prompts-title"
        className="relative flex max-h-[min(88vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-2xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 bg-slate-50 px-5 py-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800">
              <Lightbulb className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="example-prompts-title" className="text-lg font-semibold text-gray-900">
                範例問題
              </h2>
              <p className="text-sm text-gray-500">
                系統範例僅可複製；我的範例可帶入對話，或管理清單
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-800"
            aria-label="關閉"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex shrink-0 gap-1 border-b border-gray-200 bg-white px-3 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('pick')}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'pick'
                ? 'bg-white text-blue-700 shadow-[0_-1px_0_0_white]'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
          >
            選用
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manage')}
            className={`rounded-t-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === 'manage'
                ? 'bg-white text-blue-700 shadow-[0_-1px_0_0_white]'
                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
            }`}
          >
            管理我的範例
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {activeTab === 'pick' && (
            <div className="space-y-6">
              <section className="rounded-xl border-2 border-teal-200/90 bg-gradient-to-b from-teal-50/90 to-teal-50/40 shadow-sm ring-1 ring-teal-100/60">
                <button
                  type="button"
                  onClick={() => setSystemSectionOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-teal-100/50"
                  aria-expanded={systemSectionOpen}
                  id="example-system-section-toggle"
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                    系統提供
                  </h3>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-teal-700 transition-transform ${systemSectionOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {systemSectionOpen && (
                  <div className="border-t-2 border-teal-100/80 px-3 pb-3 pt-1">
                    <p className="py-2 text-xs leading-relaxed text-teal-900/65">
                      實際可用問法會依您的資料欄位而異；請複製後自行改寫再貼到對話。
                    </p>
                    {systemItems.length === 0 ? (
                      <p className="py-2 text-sm text-teal-900/60">目前無系統範例。</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {systemItems.map((p) => (
                          <li
                            key={p.id}
                            className="flex gap-2 rounded-xl border border-teal-200/80 bg-white/95 px-3 py-2.5 shadow-sm"
                          >
                            <p className="min-w-0 flex-1 text-[15px] leading-snug text-gray-800">
                              {p.text}
                            </p>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => copySystemText(p.text)}
                              className="shrink-0 self-start rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5 text-xs font-medium text-teal-900 transition-colors hover:bg-teal-100 disabled:opacity-50"
                              aria-label={`複製：${p.text.slice(0, 24)}${p.text.length > 24 ? '…' : ''}`}
                            >
                              <span className="flex items-center gap-1">
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                                複製
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
              <section className="rounded-xl border-2 border-violet-200/90 bg-gradient-to-b from-violet-50/90 to-violet-50/40 shadow-sm ring-1 ring-violet-100/60">
                <button
                  type="button"
                  onClick={() => setUserSectionOpen((o) => !o)}
                  className="flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-violet-100/50"
                  aria-expanded={userSectionOpen}
                >
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">
                    我的範例
                  </h3>
                  <ChevronDown
                    className={`h-5 w-5 shrink-0 text-violet-700 transition-transform ${userSectionOpen ? 'rotate-180' : ''}`}
                    aria-hidden
                  />
                </button>
                {userSectionOpen && (
                  <div className="border-t-2 border-violet-100/80 px-3 pb-3 pt-1">
                    {userItems.length === 0 ? (
                      <p className="py-2 text-sm text-violet-900/60">
                        尚未新增。請切換到「管理我的範例」加入。
                      </p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {userItems.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              disabled={isLoading}
                              onClick={() => handlePick(p.text)}
                              className="w-full rounded-xl border border-violet-200/80 bg-white/95 px-4 py-3 text-left text-[15px] leading-snug text-gray-800 shadow-sm transition-colors hover:border-violet-400 hover:bg-violet-50/70 disabled:opacity-50"
                            >
                              {p.text}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'manage' && (
            <div className="space-y-4">
              <p className="text-sm text-violet-900/75">
                以下僅你本人可見（依租戶與助理區分）。刪除後無法復原。
              </p>
              {userItems.length === 0 ? (
                <p className="rounded-xl border-2 border-dashed border-violet-200 bg-violet-50/50 px-4 py-8 text-center text-sm text-violet-800/70">
                  尚無自訂範例，請在下方<span className="font-medium text-violet-900">新增範例</span>區塊加入。
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {userItems.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-start gap-2 rounded-xl border border-violet-200/80 bg-white px-3 py-2.5 shadow-sm ring-1 ring-violet-50"
                    >
                      <p className="min-w-0 flex-1 text-[15px] leading-snug text-gray-800">{p.text}</p>
                      {onRemove && (
                        <button
                          type="button"
                          onClick={() => onRemove(p.id)}
                          className="shrink-0 rounded-lg p-2 text-red-600 transition-colors hover:bg-red-50"
                          aria-label="刪除此範例"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {onAdd && (
                <div className="rounded-xl border-2 border-violet-300/90 bg-gradient-to-b from-violet-50/95 to-violet-50/50 p-4 shadow-sm ring-1 ring-violet-100/80">
                  <label
                    htmlFor="example-new-draft"
                    className="mb-2 block text-sm font-semibold text-violet-900"
                  >
                    新增範例
                  </label>
                  <textarea
                    id="example-new-draft"
                    rows={3}
                    value={draft}
                    maxLength={MAX_CHARS}
                    onChange={(e) => setDraft(e.target.value.slice(0, MAX_CHARS))}
                    placeholder="輸入常問的分析問題…"
                    disabled={isLoading}
                    className="mb-2 w-full resize-y rounded-lg border-2 border-violet-200/80 bg-white px-3 py-2 text-[15px] text-gray-800 shadow-sm placeholder:text-violet-900/35 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-300/60 disabled:opacity-50"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-violet-700/70">
                      {draft.length}/{MAX_CHARS}
                    </span>
                    <button
                      type="button"
                      disabled={isLoading || !draft.trim()}
                      onClick={handleAdd}
                      className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-violet-700 disabled:opacity-40"
                    >
                      加入清單
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
