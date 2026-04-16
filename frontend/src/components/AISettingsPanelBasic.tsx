/** 基本設定：模型、角色（可選）、語言、詳略、範例問題數 */
import {
  DETAIL_OPTIONS,
  LANGUAGE_OPTIONS,
  ROLE_OPTIONS,
} from '@/constants/aiOptions'
import LLMModelSelect from '@/components/LLMModelSelect'

export interface AISettingsPanelBasicProps {
  model: string
  onModelChange: (v: string) => void
  role?: string
  onRoleChange?: (v: string) => void
  language: string
  onLanguageChange: (v: string) => void
  detailLevel: string
  onDetailLevelChange: (v: string) => void
  exampleQuestionsCount: string
  onExampleQuestionsCountChange: (v: string) => void
}

export default function AISettingsPanelBasic({
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
}: AISettingsPanelBasicProps) {
  return (
    <div className="shrink-0">
      <h3 className="mb-2 text-[14px] font-semibold uppercase tracking-wide text-blue-600">
        基本設定
      </h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <LLMModelSelect value={model} onChange={onModelChange} />
        {role !== undefined && onRoleChange !== undefined && (
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
        )}
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
  )
}
