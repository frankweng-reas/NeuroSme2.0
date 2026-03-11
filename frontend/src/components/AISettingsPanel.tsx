/** AI 設定區共用元件：模型、角色、語言、詳略、範本、User Prompt */
import { useCallback, useEffect, useState } from 'react'
import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate,
  type PromptTemplateItem,
} from '@/api/promptTemplates'
import { ApiError } from '@/api/client'
import {
  DETAIL_OPTIONS,
  LANGUAGE_OPTIONS,
  ROLE_OPTIONS,
} from '@/constants/aiOptions'
import ModelSelect from '@/components/ModelSelect'
import ConfirmModal from '@/components/ConfirmModal'
import HelpModal from '@/components/HelpModal'
import { HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'

export interface AISettingsPanelProps {
  agentId: string
  model: string
  onModelChange: (v: string) => void
  role: string
  onRoleChange: (v: string) => void
  language: string
  onLanguageChange: (v: string) => void
  detailLevel: string
  onDetailLevelChange: (v: string) => void
  exampleQuestionsCount: string
  onExampleQuestionsCountChange: (v: string) => void
  userPrompt: string
  onUserPromptChange: (v: string) => void
  selectedTemplateId: number | null
  onSelectedTemplateIdChange: (id: number | null) => void
  onToast: (msg: string) => void
  headerActions?: ReactNode
}

export default function AISettingsPanel({
  agentId,
  model,
  onModelChange,
  role,
  onRoleChange,
  language,
  onLanguageChange,
  detailLevel,
  onDetailLevelChange,
  exampleQuestionsCount,
  onExampleQuestionsCountChange,
  userPrompt,
  onUserPromptChange,
  selectedTemplateId,
  onSelectedTemplateIdChange,
  onToast,
  headerActions,
}: AISettingsPanelProps) {
  const [showHelpModal, setShowHelpModal] = useState(false)
  const [templates, setTemplates] = useState<PromptTemplateItem[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [showSaveTemplateModal, setShowSaveTemplateModal] = useState(false)
  const [saveTemplateName, setSaveTemplateName] = useState('')
  const [showDeleteTemplateConfirm, setShowDeleteTemplateConfirm] = useState(false)

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const list = await listPromptTemplates(agentId)
      setTemplates(list)
    } catch {
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  useEffect(() => {
    if (templates.length === 0) return
    if (selectedTemplateId != null && !templates.some((t) => t.id === selectedTemplateId)) {
      onSelectedTemplateIdChange(null)
    }
  }, [templates, selectedTemplateId, onSelectedTemplateIdChange])

  function handleSelectTemplate(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value
    if (val === '') {
      onSelectedTemplateIdChange(null)
      return
    }
    const id = Number(val)
    const t = templates.find((x) => x.id === id)
    if (t) {
      onSelectedTemplateIdChange(id)
      onUserPromptChange(t.content)
    }
  }

  async function handleSaveAsTemplate() {
    const name = saveTemplateName.trim()
    if (!name) {
      onToast('請輸入範本名稱')
      return
    }
    try {
      await createPromptTemplate(agentId, name, userPrompt)
      onToast('已儲存範本')
      setShowSaveTemplateModal(false)
      setSaveTemplateName('')
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '儲存失敗'
      onToast(String(msg))
    }
  }

  async function handleUpdateTemplate() {
    if (selectedTemplateId == null) return
    try {
      await updatePromptTemplate(selectedTemplateId, { content: userPrompt })
      onToast('已更新範本')
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '更新失敗'
      onToast(String(msg))
    }
  }

  async function handleDeleteTemplate() {
    if (selectedTemplateId == null) return
    try {
      await deletePromptTemplate(selectedTemplateId)
      onToast('已刪除範本')
      onSelectedTemplateIdChange(null)
      setShowDeleteTemplateConfirm(false)
      fetchTemplates()
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail ?? err.message : '刪除失敗'
      onToast(String(msg))
    }
  }

  const selectedTemplate =
    selectedTemplateId != null ? templates.find((t) => t.id === selectedTemplateId) : null

  return (
    <>
      <header className="flex flex-shrink-0 items-center justify-between rounded-t-xl border-b border-slate-200 bg-slate-100 px-4 py-3 font-semibold text-slate-800 shadow-sm">
        <div className="flex items-center gap-1">
          <span>AI 設定區</span>
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden border-b border-gray-200 bg-gray-50 px-4 py-3">
        {/* 基本設定 */}
        <div className="shrink-0">
          <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
            基本設定
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            <ModelSelect value={model} onChange={onModelChange} />
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[16px] font-medium text-gray-700">角色</label>
              <select
                value={role}
                onChange={(e) => onRoleChange(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[16px] font-medium text-gray-700">語言</label>
              <select
                value={language}
                onChange={(e) => onLanguageChange(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {LANGUAGE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[16px] font-medium text-gray-700">詳略</label>
              <select
                value={detailLevel}
                onChange={(e) => onDetailLevelChange(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {DETAIL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="shrink-0 text-[16px] font-medium text-gray-700">提供範例問題</label>
              <select
                value={exampleQuestionsCount}
                onChange={(e) => onExampleQuestionsCountChange(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                <option value="0">0</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-gray-200" />

        {/* 進階設定 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <h3 className="shrink-0 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
            進階設定
          </h3>
          <div className="flex min-w-0 shrink-0 w-full items-center gap-2">
            <label className="shrink-0 text-[16px] font-medium text-gray-700">範本</label>
            <select
              value={selectedTemplateId ?? ''}
              onChange={handleSelectTemplate}
              disabled={templatesLoading}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:opacity-50"
            >
              <option value="">無</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSaveTemplateName('')
                setShowSaveTemplateModal(true)
              }}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50"
            >
              儲存到範本
            </button>
            <button
              type="button"
              onClick={handleUpdateTemplate}
              disabled={selectedTemplateId == null}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[14px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              更新
            </button>
            <button
              type="button"
              onClick={() => selectedTemplateId != null && setShowDeleteTemplateConfirm(true)}
              disabled={selectedTemplateId == null}
              className="shrink-0 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[14px] text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              刪除
            </button>
          </div>
          <div className="min-h-0 flex-1">
            <textarea
              value={userPrompt}
              onChange={(e) => onUserPromptChange(e.target.value)}
              placeholder="User Prompt（選填），如格式、資料辭典等"
              className="h-full min-h-[80px] w-full resize-y rounded-lg border border-gray-300 bg-white p-2 text-[16px] text-gray-800 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
            />
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteTemplateConfirm}
        title="確認刪除"
        message={`確定要刪除範本「${selectedTemplate?.name ?? ''}」嗎？`}
        confirmText="刪除"
        onConfirm={handleDeleteTemplate}
        onCancel={() => setShowDeleteTemplateConfirm(false)}
      />
      {showSaveTemplateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={() => setShowSaveTemplateModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="relative z-10 min-w-[320px] rounded-2xl border-2 border-gray-200 bg-white p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 font-semibold text-gray-800">儲存為範本</h2>
            <input
              type="text"
              value={saveTemplateName}
              onChange={(e) => setSaveTemplateName(e.target.value)}
              placeholder="輸入範本名稱"
              className="mb-6 w-full rounded-lg border border-gray-300 px-3 py-2 text-[18px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSaveTemplateModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveAsTemplate}
                className="rounded-lg px-4 py-2 text-white hover:opacity-90"
                style={{ backgroundColor: '#4b5563' }}
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-ai-settings.md"
      />
    </>
  )
}
