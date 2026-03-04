/** AI 設定選項常數，供 AISettingsPanel 及 buildUserPrompt 使用 */

export const MODEL_OPTIONS = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
  { value: 'gpt-4o', label: 'gpt-4o' },
  { value: 'gemini/gemini-2.0-flash', label: 'gemini-2.0-flash' },
  { value: 'gemini/gemini-2.5-flash', label: 'gemini-2.5-flash' },
  { value: 'gemini/gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
  { value: 'gemini/gemini-1.5-pro', label: 'gemini-1.5-pro' },
  { value: 'gemini/gemini-pro', label: 'gemini-pro' },
  { value: 'twcc/Llama3.1-FFM-8B-32K', label: '台智雲 Llama3.1-FFM-8B' },
] as const

export const ROLE_OPTIONS = [
  { value: 'manager', label: '管理者', prompt: '以管理者的角度來分析。' },
  { value: 'boss', label: '老闆', prompt: '以老闆的角度來分析。' },
  { value: 'employee', label: '員工', prompt: '以員工的角度來分析。' },
] as const

export const LANGUAGE_OPTIONS = [
  { value: 'zh-TW', label: '繁中', prompt: '請用繁體中文回覆。' },
  { value: 'en', label: '英文', prompt: 'Please respond in English.' },
] as const

export const DETAIL_OPTIONS = [
  { value: 'brief', label: '簡要', prompt: '請簡要回答（3–5 點重點）。' },
  { value: 'standard', label: '標準', prompt: '請以標準詳細程度回答。' },
  { value: 'detailed', label: '詳細', prompt: '請詳細分析，包含數據與推論。' },
] as const
