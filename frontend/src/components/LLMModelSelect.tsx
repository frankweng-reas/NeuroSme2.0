/**
 * 【僅供 LLM 使用】此元件只負責選擇送給 Chat / LiteLLM 的 model 字串（來源：/llm-configs/model-options）。
 * 請勿用於 Schema、公司、專案、角色等非 LLM model 的下拉選單；那些請用一般 <select> 或專用元件。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getLLMModelOptions, type LLMModelOption } from '@/api/llmConfigs'
import { ApiError } from '@/api/client'

export interface LLMModelSelectProps {
  /** 傳給後端 chat 的 model id（例 gpt-4o-mini、gemini/gemini-2.5-flash） */
  value: string
  onChange: (modelId: string) => void
  id?: string
  label?: string
  className?: string
  labelClassName?: string
  selectClassName?: string
  disabled?: boolean
  /** 僅限單元測試等情境覆寫選項；預設 null 一律打 /llm-configs/model-options */
  optionsOverride?: LLMModelOption[] | null
  /** inline：標籤與下拉同一列；stacked：標籤在上（表單欄位） */
  labelPosition?: 'inline' | 'stacked'
  /** 不顯示載入/錯誤段落，改以 select 的 title 提示（適合窄工具列） */
  compact?: boolean
  /** 在清單最上方加一個空值選項（label 預設「系統預設」），讓 value='' 時 UI 與 state 一致 */
  allowEmpty?: boolean
  emptyLabel?: string
}

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; options: LLMModelOption[] }
  | { kind: 'error'; message: string }

/** 租戶 DB 無 llm_provider_config 時之占位（value 須為空字串，勿當成 model id 送出） */
const NO_MODELS_PLACEHOLDER_VALUE = ''
const NO_MODELS_PLACEHOLDER_LABEL = '--尚未建立模型--'

export default function LLMModelSelect({
  value,
  onChange,
  id,
  label = '模型',
  className = '',
  labelClassName = 'shrink-0 text-[16px] font-medium text-gray-700',
  selectClassName = 'min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[16px] focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400',
  disabled = false,
  optionsOverride = null,
  labelPosition = 'inline',
  compact = false,
  allowEmpty = false,
  emptyLabel = '系統預設',
}: LLMModelSelectProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'idle' })

  // 用 ref 持有最新的 onChange，讓自動切換 effect 不需把 onChange 加進依賴
  const onChangeRef = useRef(onChange)
  useLayoutEffect(() => { onChangeRef.current = onChange }, [onChange])

  useEffect(() => {
    if (optionsOverride != null) {
      setLoadState({ kind: 'ok', options: optionsOverride })
      return
    }
    let cancelled = false
    setLoadState({ kind: 'loading' })
    getLLMModelOptions()
      .then((opts) => {
        if (!cancelled) setLoadState({ kind: 'ok', options: Array.isArray(opts) ? opts : [] })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const msg =
          e instanceof ApiError
            ? e.detail ?? e.message
            : e instanceof Error
              ? e.message
              : '無法載入模型清單'
        setLoadState({ kind: 'error', message: msg })
      })
    return () => {
      cancelled = true
    }
  }, [optionsOverride])

  const hasNoModels =
    loadState.kind === 'ok' &&
    (optionsOverride != null ? optionsOverride.length === 0 : loadState.options.length === 0)

  // 選項載入成功後：
  // 1. value 為空（初始或 fallback）→ 自動選第一個可用模型（= tenant default）
  // 2. value 不在清單中（provider 已停用）→ 同樣自動切換
  // allowEmpty 時 value='' 代表「系統預設」，不做自動切換
  useEffect(() => {
    if (loadState.kind !== 'ok') return
    if (hasNoModels) return
    if (allowEmpty && value === '') return
    const valid = loadState.options
    if (!value || !valid.some((o) => o.value === value)) {
      onChangeRef.current(allowEmpty ? '' : (valid[0]?.value ?? ''))
    }
  }, [loadState, value, hasNoModels, allowEmpty])

  const displayOptions = useMemo(() => {
    if (loadState.kind === 'ok' && hasNoModels) {
      return [{ value: NO_MODELS_PLACEHOLDER_VALUE, label: NO_MODELS_PLACEHOLDER_LABEL }]
    }
    let base: LLMModelOption[] = []
    if (loadState.kind === 'ok') base = loadState.options
    const opts = [...base]
    // loading / idle 時保留舊值顯示（避免閃爍）；ok 時不加無效項目，由上方 effect 自動切換
    if (loadState.kind !== 'ok' && value && !opts.some((o) => o.value === value)) {
      opts.unshift({ value, label: value })
    }
    if (allowEmpty) opts.unshift({ value: '', label: emptyLabel })
    return opts
  }, [loadState, value, hasNoModels, allowEmpty, emptyLabel])

  const selectValue =
    loadState.kind === 'ok' && hasNoModels ? NO_MODELS_PLACEHOLDER_VALUE : value

  const selectDisabled =
    disabled ||
    (loadState.kind === 'loading' && optionsOverride == null) ||
    loadState.kind === 'error' ||
    hasNoModels

  const showError = loadState.kind === 'error'
  const loadingRemote = loadState.kind === 'loading' && optionsOverride == null

  const selectTitle =
    showError ? loadState.message : loadingRemote ? '載入模型清單…' : undefined

  const selectClass =
    `${selectClassName}${showError ? ' ring-1 ring-red-400 border-red-300' : ''}`.trim()

  const control = (
    <select
      id={id}
      value={selectValue}
      onChange={(e) => onChange(e.target.value)}
      disabled={selectDisabled}
      className={selectClass}
      title={selectTitle}
      aria-invalid={showError}
      aria-busy={loadingRemote}
    >
      {loadingRemote && displayOptions.length === 0 ? (
        <option value="">{value || '載入中…'}</option>
      ) : null}
      {displayOptions.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  )

  const showStatusParagraph = !compact && (loadingRemote || showError)

  if (labelPosition === 'stacked') {
    return (
      <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
        {label ? (
          <label htmlFor={id} className={labelClassName}>
            {label}
          </label>
        ) : null}
        {control}
        {showStatusParagraph && loadingRemote ? (
          <p className="text-[14px] text-gray-500">載入模型清單…</p>
        ) : null}
        {showStatusParagraph && showError ? (
          <p className="text-[14px] text-red-600 break-words">{loadState.message}</p>
        ) : null}
      </div>
    )
  }

  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <div className="flex min-w-0 items-center gap-2">
        {label ? (
          <label htmlFor={id} className={labelClassName}>
            {label}
          </label>
        ) : null}
        {control}
      </div>
      {showStatusParagraph && loadingRemote ? (
        <p className="text-[14px] text-gray-500">載入模型清單…</p>
      ) : null}
      {showStatusParagraph && showError ? (
        <p className="text-[14px] text-red-600 break-words">{loadState.message}</p>
      ) : null}
    </div>
  )
}
