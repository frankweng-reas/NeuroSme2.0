/** Admin：租戶 LLM 設定（admin / super_admin） */
import { useCallback, useEffect, useState } from 'react'
import { Mic } from 'lucide-react'
import {
  HelpCircle,
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  Lock,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react'
import HelpModal from '@/components/HelpModal'
import {
  createLLMConfig,
  deleteLLMConfig,
  getLLMProviderOptions,
  getTenantConfig,
  listLLMConfigs,
  migrateEmbedding,
  testEmbedding,
  testLLMConfig,
  updateDefaultLLM,
  updateLLMConfig,
  updateSpeechConfig,
  testSpeechConfig,
} from '@/api/llmConfigs'
import type {
  EmbeddingTestResult,
  LLMProviderConfigCreate,
  LLMProviderConfigUpdate,
  LLMTestResult,
  SpeechTestResult,
  TenantConfig,
} from '@/api/llmConfigs'
import type { LLMModelEntry } from '@/types'
import { getMe } from '@/api/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { LLMProviderConfig } from '@/types'
import ConfirmModal from '@/components/ConfirmModal'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  twcc: '台智雲 TWCC',
  local: '本機模型 (Local)',
  anthropic: 'Anthropic',
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-200 text-green-900',
  gemini: 'bg-blue-200 text-blue-900',
  twcc: 'bg-orange-200 text-orange-900',
  local: 'bg-purple-200 text-purple-900',
  anthropic: 'bg-amber-200 text-amber-900',
}

const PROVIDER_CARD_COLORS: Record<string, string> = {
  openai: 'border-green-100 bg-green-50/50',
  gemini: 'border-blue-100 bg-blue-50/50',
  twcc:   'border-orange-100 bg-orange-50/50',
  local:  'border-purple-100 bg-purple-50/50',
  anthropic: 'border-amber-100 bg-amber-50/50',
}

// 系統固定 768 維，僅此兩種 model 相容
const EMBEDDING_MODELS: Record<string, { model: string; note: string }[]> = {
  openai: [{ model: 'text-embedding-3-small', note: '768 維（截斷）' }],
  local:  [{ model: 'nomic-embed-text',        note: '768 維（原生）' }],
}

// 語音支援兩種服務
const SPEECH_MODELS: Record<string, { model: string; label: string; note: string }> = {
  local:  { model: 'Systran/faster-whisper-medium', label: '本機模型 (Local)',  note: '地端 faster-whisper-server，預設端口 8002' },
  openai: { model: 'whisper-1',                     label: 'OpenAI Whisper',    note: '雲端 API，沿用 Provider 連線設定中的 OpenAI Key' },
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  provider: string
  label: string
  api_key: string
  api_key_masked: string
  api_base_url: string
  available_models_entries: LLMModelEntry[]
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  provider: 'openai',
  label: '',
  api_key: '',
  api_key_masked: '',
  api_base_url: '',
  available_models_entries: [],
  is_active: true,
}

// model → test key：`{configId}:{model}`
type TestKey = string
function testKey(configId: number, model: string): TestKey {
  return `${configId}:${model}`
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdminLLMSettings() {
  const { showToast } = useToast()

  // data
  const [tenantConfig, setTenantConfig] = useState<TenantConfig | null>(null)
  const [configs, setConfigs] = useState<LLMProviderConfig[]>([])
  const [providerOptions, setProviderOptions] = useState<Record<string, string[]>>({})
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null)

  // loading / error
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // provider CRUD form
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  // expand / collapse provider cards
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set())
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  // per-model test results  key = `{configId}:{model}`
  const [testingKey, setTestingKey] = useState<TestKey | null>(null)
  const [testResultModal, setTestResultModal] = useState<{ model: string; result: LLMTestResult } | null>(null)

  // reference models popup
  const [showRefModal, setShowRefModal] = useState(false)

  // default LLM edit
  const [showDefaultLLMForm, setShowDefaultLLMForm] = useState(false)
  const [defaultLLMForm, setDefaultLLMForm] = useState({ provider: '', model: '' })
  const [savingDefaultLLM, setSavingDefaultLLM] = useState(false)

  // embedding config
  const [showEmbeddingForm, setShowEmbeddingForm] = useState(false)
  const [embeddingForm, setEmbeddingForm] = useState({ provider: 'openai', model: '', confirm: false })
  const [savingEmbedding, setSavingEmbedding] = useState(false)

  // embedding test
  const [testingEmbedding, setTestingEmbedding] = useState(false)
  const [embeddingTestResult, setEmbeddingTestResult] = useState<EmbeddingTestResult | null>(null)

  // speech config
  const [showSpeechForm, setShowSpeechForm] = useState(false)
  const [speechForm, setSpeechForm] = useState({ provider: 'local', base_url: '', api_key: '', model: '' })
  const [savingSpeech, setSavingSpeech] = useState(false)
  const [_showSpeechApiKey, setShowSpeechApiKey] = useState(false)
  const [testingSpeech, setTestingSpeech] = useState(false)
  const [speechTestResult, setSpeechTestResult] = useState<SpeechTestResult | null>(null)
  const [showDisableSpeechConfirm, setShowDisableSpeechConfirm] = useState(false)
  const [disablingSpeech, setDisablingSpeech] = useState(false)

  // help modal
  const [showHelpModal, setShowHelpModal] = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    Promise.all([listLLMConfigs(), getLLMProviderOptions(), getMe(), getTenantConfig()])
      .then(([cfgs, opts, me, tc]) => {
        const tid = (me.tenant_id ?? '').trim()
        setCurrentTenantId(tid || null)
        const raw = Array.isArray(cfgs) ? cfgs : []
        const scoped = tid ? raw.filter((c) => (c.tenant_id ?? '').trim() === tid) : raw
        setConfigs(scoped)
        setProviderOptions(opts && typeof opts === 'object' ? opts : {})
        setTenantConfig(tc)
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? err.detail ?? '需 admin 或 super_admin 權限'
            : err instanceof ApiError && err.detail
              ? err.detail
              : '無法載入 LLM 設定',
        )
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // ── Provider CRUD ─────────────────────────────────────────────────────────

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowApiKey(false)
    setShowForm(true)
  }

  function openEdit(cfg: LLMProviderConfig) {
    setEditingId(cfg.id)
    setForm({
      provider: cfg.provider,
      label: cfg.label ?? '',
      api_key: '',
      api_key_masked: cfg.api_key_masked ?? '',
      api_base_url: cfg.api_base_url ?? '',
      available_models_entries: cfg.available_models ?? [],
      is_active: cfg.is_active,
    })
    setShowApiKey(false)
    setShowForm(true)
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function handleSave() {
    if (!form.provider) { showToast('請選擇 Provider', 'error'); return }
    setSaving(true)
    try {
      const availableModels = form.available_models_entries.filter((e) => e.model.trim())

      if (editingId !== null) {
        const body: LLMProviderConfigUpdate = {
          label: form.label || null,
          api_base_url: form.api_base_url || null,
          available_models: availableModels,
          is_active: form.is_active,
        }
        if (form.api_key.trim()) body.api_key = form.api_key.trim()
        await updateLLMConfig(editingId, body)
        showToast('LLM 設定已更新', 'success')
      } else {
        const body: LLMProviderConfigCreate = {
          provider: form.provider,
          label: form.label || null,
          api_key: form.api_key.trim() || null,
          api_base_url: form.api_base_url || null,
          available_models: availableModels,
          is_active: true,
        }
        await createLLMConfig(body)
        showToast('LLM 設定已新增', 'success')
      }
      setShowForm(false)
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteLLMConfig(id)
      showToast('已刪除', 'success')
      setDeleteTarget(null)
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '刪除失敗', 'error')
    }
  }

  async function handleToggleActive(cfg: LLMProviderConfig) {
    setTogglingIds((prev) => new Set([...prev, cfg.id]))
    try {
      await updateLLMConfig(cfg.id, { is_active: !cfg.is_active })
      showToast(cfg.is_active ? '已停用' : '已啟用', 'success')
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '操作失敗', 'error')
    } finally {
      setTogglingIds((prev) => { const n = new Set(prev); n.delete(cfg.id); return n })
    }
  }

  // ── Per-model test ─────────────────────────────────────────────────────────

  async function handleTestModel(configId: number, model: string) {
    const key = testKey(configId, model)
    setTestingKey(key)
    try {
      const result = await testLLMConfig(configId, model)
      setTestResultModal({ model, result })
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      const result: LLMTestResult = { ok: false, elapsed_ms: 0, error: msg }
      setTestResultModal({ model, result })
    } finally {
      setTestingKey(null)
    }
  }

  // ── Default LLM update ────────────────────────────────────────────────────

  function openDefaultLLMForm() {
    setDefaultLLMForm({
      provider: tenantConfig?.default_llm_provider ?? 'gemini',
      model: tenantConfig?.default_llm_model ?? '',
    })
    setShowDefaultLLMForm(true)
  }

  async function handleSaveDefaultLLM() {
    if (!defaultLLMForm.provider || !defaultLLMForm.model.trim()) {
      showToast('請填寫 Provider 與 Model', 'error'); return
    }
    setSavingDefaultLLM(true)
    try {
      const tc = await updateDefaultLLM({ provider: defaultLLMForm.provider, model: defaultLLMForm.model.trim() })
      setTenantConfig(tc)
      setShowDefaultLLMForm(false)
      showToast('預設 LLM 已更新', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingDefaultLLM(false)
    }
  }

  // ── Embedding config ─────────────────────────────────────────────────────

  function openEmbeddingForm() {
    // 只列出已在 Provider 連線設定中啟用且有 embedding 支援的 provider
    const activeSupportedProviders = [...new Set(
      configs.filter((c) => c.is_active && EMBEDDING_MODELS[c.provider]).map((c) => c.provider)
    )]
    const defaultProvider =
      (tenantConfig?.embedding_provider && EMBEDDING_MODELS[tenantConfig.embedding_provider])
        ? tenantConfig.embedding_provider
        : activeSupportedProviders[0] ?? 'openai'
    const defaultModel =
      tenantConfig?.embedding_model ?? EMBEDDING_MODELS[defaultProvider]?.[0]?.model ?? ''
    setEmbeddingForm({ provider: defaultProvider, model: defaultModel, confirm: false })
    setShowEmbeddingForm(true)
  }

  async function handleSaveEmbedding() {
    if (!embeddingForm.provider || !embeddingForm.model.trim()) {
      showToast('請選擇 Provider 與 Model', 'error'); return
    }
    const isLocked = !!tenantConfig?.embedding_locked_at
    if (isLocked && !embeddingForm.confirm) {
      showToast('請勾選確認選項', 'error'); return
    }
    setSavingEmbedding(true)
    try {
      const tc = await migrateEmbedding({
        provider: embeddingForm.provider,
        model: embeddingForm.model.trim(),
        confirm: true,
      })
      setTenantConfig(tc)
      setShowEmbeddingForm(false)
      setEmbeddingForm({ provider: 'openai', model: '', confirm: false })
      showToast(
        isLocked ? 'Embedding 已更新，請重新上傳文件以重建索引' : 'Embedding Model 已設定',
        'success',
      )
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingEmbedding(false)
    }
  }

  async function handleTestEmbedding() {
    setTestingEmbedding(true)
    setEmbeddingTestResult(null)
    try {
      const result = await testEmbedding()
      setEmbeddingTestResult(result)
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      setEmbeddingTestResult({ ok: false, elapsed_ms: 0, model: '', error: msg })
    } finally {
      setTestingEmbedding(false)
    }
  }

  function openSpeechForm() {
    const provider = tenantConfig?.speech_provider ?? 'local'
    const model = tenantConfig?.speech_model || SPEECH_MODELS[provider]?.model || ''
    setSpeechForm({
      provider,
      base_url: tenantConfig?.speech_base_url ?? '',
      api_key: '',
      model,
    })
    setShowSpeechApiKey(false)
    setSpeechTestResult(null)
    setShowSpeechForm(true)
  }

  async function handleSaveSpeech() {
    if (!speechForm.provider) { showToast('請選擇 Provider', 'error'); return }
    if (speechForm.provider === 'local' && !speechForm.base_url.trim()) {
      showToast('本機模型需填寫 Base URL', 'error'); return
    }
    setSavingSpeech(true)
    try {
      const tc = await updateSpeechConfig({
        provider: speechForm.provider,
        base_url: speechForm.base_url.trim() || null,
        api_key: speechForm.api_key || undefined,   // undefined = 不變更
        model: speechForm.model.trim() || null,
      })
      setTenantConfig(tc)
      setShowSpeechForm(false)
      showToast('語音設定已儲存', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '儲存失敗', 'error')
    } finally {
      setSavingSpeech(false)
    }
  }

  async function handleTestSpeech() {
    setTestingSpeech(true)
    setSpeechTestResult(null)
    try {
      const result = await testSpeechConfig()
      setSpeechTestResult(result)
    } catch (err) {
      const msg = err instanceof ApiError ? (err.detail ?? err.message) : '測試失敗'
      setSpeechTestResult({ ok: false, error: msg })
    } finally {
      setTestingSpeech(false)
    }
  }

  async function handleDisableSpeech() {
    setDisablingSpeech(true)
    try {
      const tc = await updateSpeechConfig({ provider: '' })
      setTenantConfig(tc)
      showToast('語音功能已停用', 'success')
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '停用失敗', 'error')
    } finally {
      setDisablingSpeech(false)
      setShowDisableSpeechConfirm(false)
    }
  }

  const defaultModelsForProvider = providerOptions[form.provider] ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 text-lg">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <KeyRound className="h-6 w-6 text-gray-600" />
          <div>
            <h2 className="text-lg font-bold text-gray-800">LLM 設定</h2>
            {currentTenantId && (
              <p className="text-base text-gray-500 mt-0.5">
                租戶 ID：<code className="rounded bg-gray-100 px-1.5 py-0.5">{currentTenantId}</code>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowHelpModal(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-base text-gray-500 hover:border-gray-300 hover:text-gray-700 hover:bg-gray-50 transition-colors"
          title="模型選型指南"
        >
          <HelpCircle className="h-4 w-4" />
          模型選型指南
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}
      {loading && (
        <div className="text-center py-8 text-gray-400">載入中...</div>
      )}

      {!loading && !error && (
        <>
          {/* ════════════════════════════════════════════════════════════════
              Section 1：租戶預設 AI 設定
          ════════════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-700 border-b border-gray-200 pb-2">
              預設 AI 設定
            </h3>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">

              {/* 預設 LLM */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">預設 LLM</span>
                  <button
                    onClick={openDefaultLLMForm}
                    className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" /> 變更
                  </button>
                </div>
                {tenantConfig?.default_llm_model ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS[tenantConfig.default_llm_provider ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                        {PROVIDER_LABELS[tenantConfig.default_llm_provider ?? ''] ?? tenantConfig.default_llm_provider}
                      </span>
                    </div>
                    <p className="font-mono text-gray-800 text-base break-all">{tenantConfig.default_llm_model}</p>
                  </div>
                ) : (
                  <p className="text-base text-gray-400 italic">尚未設定，點擊「變更」選擇</p>
                )}
              </div>

              {/* Embedding Model */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">Embedding Model</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleTestEmbedding()}
                      disabled={testingEmbedding || !tenantConfig?.embedding_model}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      <Zap className={`h-3.5 w-3.5 ${testingEmbedding ? 'animate-pulse' : ''}`} />
                      {testingEmbedding ? '測試中...' : '測試'}
                    </button>
                    <button
                      onClick={openEmbeddingForm}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 設定
                    </button>
                  </div>
                </div>
                {tenantConfig?.embedding_model ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS[tenantConfig.embedding_provider ?? ''] ?? 'bg-gray-100 text-gray-700'}`}>
                        {PROVIDER_LABELS[tenantConfig.embedding_provider ?? ''] ?? tenantConfig.embedding_provider}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-base text-gray-500">
                        v{tenantConfig.embedding_version ?? 1}
                      </span>
                    </div>
                    <p className="font-mono text-gray-800 text-base">{tenantConfig.embedding_model}</p>
                    {tenantConfig.embedding_locked_at ? (
                      <div className="flex items-center gap-1 text-base text-gray-400">
                        <Lock className="h-3 w-3" />
                        已鎖定・{new Date(tenantConfig.embedding_locked_at).toLocaleDateString('zh-TW')}
                      </div>
                    ) : (
                      <p className="text-base text-amber-500">尚未鎖定（第一次上傳文件後自動鎖定）</p>
                    )}
                  </div>
                ) : (
                  <p className="text-base text-gray-400 italic">尚未設定，點擊「設定」選擇 Embedding Model</p>
                )}
              </div>

              {/* 語音模型 */}
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">語音模型 (STT)</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleTestSpeech()}
                      disabled={testingSpeech || !tenantConfig?.speech_base_url}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      <Zap className={`h-3.5 w-3.5 ${testingSpeech ? 'animate-pulse' : ''}`} />
                      {testingSpeech ? '測試中...' : '測試'}
                    </button>
                    {tenantConfig?.speech_provider && (
                      <button
                        onClick={() => setShowDisableSpeechConfirm(true)}
                        className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        停用
                      </button>
                    )}
                    <button
                      onClick={openSpeechForm}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> 設定
                    </button>
                  </div>
                </div>
                {tenantConfig?.speech_provider ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${tenantConfig.speech_provider === 'openai' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                        {tenantConfig.speech_provider === 'openai' ? 'OpenAI Whisper' : '本機模型 (Local)'}
                      </span>
                    </div>
                    {tenantConfig.speech_model && (
                      <p className="font-mono text-gray-800 text-base">{tenantConfig.speech_model}</p>
                    )}
                    {tenantConfig.speech_base_url && (
                      <p className="font-mono text-base text-gray-400 truncate">{tenantConfig.speech_base_url}</p>
                    )}
                    {tenantConfig.speech_api_key_masked && (
                      <p className="text-base text-gray-400">API Key：{tenantConfig.speech_api_key_masked}</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-base text-gray-400 italic">尚未設定，點擊「設定」啟用語音輸入</p>
                    <div className="flex items-center gap-1.5 text-base text-gray-400">
                      <Mic className="h-3.5 w-3.5" />
                      <span>支援本機 faster-whisper 或 OpenAI Whisper API</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ════════════════════════════════════════════════════════════════
              Section 2：Provider 連線設定
          ════════════════════════════════════════════════════════════════ */}
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <h3 className="text-lg font-semibold text-gray-700">Provider 連線設定</h3>
              <button
                onClick={openCreate}
                className="flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                <Plus className="h-4 w-4" /> 新增 Provider
              </button>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-800">
              API Key 加密後存入資料庫。此設定僅管理「如何連線」，預設 LLM 請在上方「預設 AI 設定」調整。
            </div>

            {configs.length === 0 && (
              <div className="rounded-lg border-2 border-dashed border-gray-200 py-12 text-center text-gray-400">
                <KeyRound className="mx-auto h-10 w-10 mb-3 opacity-30" />
                <p>尚無 Provider 設定</p>
                <p className="text-base mt-1">點擊「新增 Provider」加入 OpenAI / Gemini / 台智雲 / 本機模型的 API Key</p>
              </div>
            )}

            <div className="space-y-3">
              {[...configs].sort((a, b) => (a.provider === 'local' ? -1 : b.provider === 'local' ? 1 : 0)).map((cfg) => {
                const isExpanded = expandedIds.has(cfg.id)
                const isToggling = togglingIds.has(cfg.id)
                const colorClass = PROVIDER_COLORS[cfg.provider] ?? 'bg-gray-100 text-gray-800'
                const models: LLMModelEntry[] = cfg.available_models?.length
                  ? cfg.available_models
                  : (providerOptions[cfg.provider] ?? []).map((m) => ({ model: m }))

                return (
                  <div
                    key={cfg.id}
                    className={`rounded-lg border shadow-sm overflow-hidden transition-opacity ${PROVIDER_CARD_COLORS[cfg.provider] ?? 'border-gray-200 bg-white'} ${cfg.is_active ? '' : 'opacity-60'}`}
                  >
                    {/* Card header */}
                    <div className="flex items-center justify-between px-5 py-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-base font-semibold ${colorClass}`}>
                          {PROVIDER_LABELS[cfg.provider] ?? cfg.provider}
                        </span>
                        <span className="font-medium text-gray-800 truncate">
                          {cfg.label || `${PROVIDER_LABELS[cfg.provider] ?? cfg.provider} 設定`}
                        </span>
                        {!cfg.is_active && (
                          <span className="shrink-0 rounded-full bg-gray-200 px-2.5 py-0.5 text-base font-medium text-gray-500">停用中</span>
                        )}
                        {cfg.api_key_masked && (
                          <span className="shrink-0 rounded bg-gray-50 border border-gray-200 px-2 py-0.5 font-mono text-base text-gray-500">
                            {cfg.api_key_masked}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => void handleToggleActive(cfg)}
                          disabled={isToggling}
                          className={`rounded px-2 py-1.5 text-base font-medium transition-colors disabled:opacity-50 ${cfg.is_active ? 'text-gray-500 hover:text-orange-600 hover:bg-orange-50' : 'text-gray-500 hover:text-green-600 hover:bg-green-50'}`}
                        >
                          {isToggling
                            ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            : cfg.is_active ? '停用' : '啟用'}
                        </button>
                        <button
                          onClick={() => openEdit(cfg)}
                          className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title="編輯"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(cfg.id)}
                          className="rounded p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                          title="刪除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => toggleExpand(cfg.id)}
                          className="rounded p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title={isExpanded ? '收合' : '展開'}
                        >
                          {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Per-model test rows (always visible) */}
                    {models.length > 0 && (
                      <div className="border-t border-gray-100 px-5 py-3 bg-gray-50 space-y-1.5">
                        <p className="text-base font-medium text-gray-400 mb-2">Models</p>
                        {models.map((entry) => {
                          const key = testKey(cfg.id, entry.model)
                          const isTesting = testingKey === key
                          return (
                            <div key={entry.model} className="flex items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <span className="font-mono text-base text-gray-700 truncate block">{entry.model}</span>
                                {entry.note && (
                                  <span className="text-base text-gray-400">{entry.note}</span>
                                )}
                              </div>
                              <button
                                onClick={() => void handleTestModel(cfg.id, entry.model)}
                                disabled={isTesting || !cfg.is_active}
                                className="flex items-center gap-1 rounded px-2 py-1 text-base font-medium text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 transition-colors shrink-0"
                              >
                                <Zap className={`h-3.5 w-3.5 ${isTesting ? 'animate-pulse' : ''}`} />
                                {isTesting ? '測試中...' : '測試'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 space-y-2 text-base">
                        <Row label="租戶 ID" value={cfg.tenant_id} mono />
                        {cfg.api_base_url && <Row label="API Base URL" value={cfg.api_base_url} mono />}
                        <Row label="建立時間" value={new Date(cfg.created_at).toLocaleString('zh-TW')} />
                        <Row label="更新時間" value={new Date(cfg.updated_at).toLocaleString('zh-TW')} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}

      {/* ── Modal：新增/編輯 Provider ── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <ModalHeader title={editingId !== null ? '編輯 Provider 連線' : '新增 Provider 連線'} onClose={() => setShowForm(false)} />
            <div className="px-6 py-5 space-y-4">

              <Field label="Provider" required>
                <select
                  disabled={editingId !== null}
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, available_models_entries: [] }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="twcc">台智雲 TWCC</option>
                  <option value="local">本機模型 (Local / Ollama / LM Studio)</option>
                </select>
              </Field>

              <Field label="顯示名稱">
                <input
                  type="text"
                  placeholder="例：OpenAI（公司帳號）"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </Field>

              <Field
                label={editingId !== null ? 'API Key（留空表示不變更）' : 'API Key'}
                hint={form.provider === 'local' ? '本機服務通常不需要 API Key，可留空或填任意字串（如 local）' : editingId !== null && form.api_key_masked ? `目前：${form.api_key_masked}` : undefined}
              >
                <div className="relative">
                  <input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder={editingId !== null ? '不填則保留原 Key' : 'sk-...'}
                    value={form.api_key}
                    onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    tabIndex={-1}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <Field
                label="API Base URL"
                required={form.provider === 'twcc' || form.provider === 'local'}
                hint={
                  form.provider === 'twcc'
                    ? '台智雲必填，例：https://api-ams.twcc.ai/api/models/conversation'
                    : form.provider === 'local'
                      ? undefined
                      : '選填，用於 Azure OpenAI 或 OpenAI-compatible Proxy'
                }
              >
                <input
                  type="text"
                  placeholder={
                    form.provider === 'twcc'
                      ? 'https://api-ams.twcc.ai/api/models/conversation'
                      : form.provider === 'local'
                        ? 'http://192.168.1.10:11434'
                        : 'https://your-proxy.example.com/v1'
                  }
                  value={form.api_base_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                {form.provider === 'local' && (
                  <div className="mt-1 space-y-0.5 text-base text-gray-400">
                    <p>設定成 Ollama / LM Studio 服務位址，例：<code className="rounded bg-gray-100 px-1">http://192.168.1.10:11434</code></p>
                    <p>NeuroSme 與 Ollama 在同一台主機時請用：<code className="rounded bg-gray-100 px-1">http://host.docker.internal:11434</code></p>
                  </div>
                )}
              </Field>

              <Field label="可用 Models">
                <div className="space-y-2">
                  {form.available_models_entries.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <div className="flex-1 space-y-1">
                        <input
                          type="text"
                          placeholder={
                            form.provider === 'local'      ? 'Model ID，例：local/gemma4:26b' :
                            form.provider === 'gemini'     ? 'Model ID，例：gemini/gemini-2.5-flash' :
                            form.provider === 'anthropic'  ? 'Model ID，例：anthropic/claude-3-5-haiku-20241022' :
                            form.provider === 'twcc'       ? 'Model ID，例：twcc/Llama3.3-FFM-70B-32K' :
                                                             'Model ID，例：gpt-4o-mini'
                          }
                          value={entry.model}
                          onChange={(e) => {
                            const next = [...form.available_models_entries]
                            next[idx] = { ...next[idx], model: e.target.value }
                            setForm((f) => ({ ...f, available_models_entries: next }))
                          }}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                        />
                        <input
                          type="text"
                          placeholder="備註（選填），例：手寫 ✓  印刷 ✓  雲端"
                          value={entry.note ?? ''}
                          onChange={(e) => {
                            const next = [...form.available_models_entries]
                            next[idx] = { ...next[idx], note: e.target.value }
                            setForm((f) => ({ ...f, available_models_entries: next }))
                          }}
                          className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-base text-gray-700 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const next = form.available_models_entries.filter((_, i) => i !== idx)
                          setForm((f) => ({ ...f, available_models_entries: next }))
                        }}
                        className="mt-1.5 rounded p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, available_models_entries: [...f.available_models_entries, { model: '', note: '' }] }))}
                    className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-base text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors w-full justify-center"
                  >
                    <Plus className="h-3.5 w-3.5" /> 新增 Model
                  </button>
                  {defaultModelsForProvider.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowRefModal(true)}
                      className="text-base text-blue-500 hover:underline"
                    >
                      參考設定
                    </button>
                  )}
                </div>
              </Field>

              <Field label="狀態">
                <label className="flex cursor-pointer items-center gap-3">
                  <div
                    onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}
                    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-gray-300'}`}
                  >
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                  </div>
                  <span className={`text-base font-medium ${form.is_active ? 'text-green-700' : 'text-gray-400'}`}>
                    {form.is_active ? '啟用中' : '停用中'}
                  </span>
                </label>
              </Field>
            </div>
            <ModalFooter onCancel={() => setShowForm(false)} onConfirm={handleSave} saving={saving} />
          </div>
        </div>
      )}

      {/* ── Modal：變更預設 LLM ── */}
      {showDefaultLLMForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="變更預設 LLM" onClose={() => setShowDefaultLLMForm(false)} />
            <div className="px-6 py-5 space-y-4">
              <Field label="Provider" required>
                <select
                  value={defaultLLMForm.provider}
                  onChange={(e) => setDefaultLLMForm((f) => ({ ...f, provider: e.target.value, model: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {Object.entries(PROVIDER_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Model" required>
                <input
                  type="text"
                  placeholder="例：gemini/gemini-2.5-flash"
                  value={defaultLLMForm.model}
                  onChange={(e) => setDefaultLLMForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                {/* quick-fill from provider's available models */}
                {(() => {
                  const cfg = configs.find((c) => c.provider === defaultLLMForm.provider && c.is_active)
                  const ms = cfg?.available_models?.length ? cfg.available_models : (providerOptions[defaultLLMForm.provider] ?? [])
                  return ms.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {ms.map((m) => {
                        const mid = typeof m === 'string' ? m : m.model
                        return (
                        <button
                          key={mid}
                          type="button"
                          onClick={() => setDefaultLLMForm((f) => ({ ...f, model: mid }))}
                          className="rounded bg-gray-100 px-2 py-0.5 text-base text-gray-600 hover:bg-gray-200 transition-colors font-mono"
                        >
                          {mid}
                        </button>
                        )
                      })}
                    </div>
                  ) : null
                })()}
              </Field>
            </div>
            <ModalFooter onCancel={() => setShowDefaultLLMForm(false)} onConfirm={handleSaveDefaultLLM} saving={savingDefaultLLM} confirmLabel="儲存" />
          </div>
        </div>
      )}

      {/* ── Modal：設定 Embedding Model ── */}
      {showEmbeddingForm && (() => {
        const isLocked = !!tenantConfig?.embedding_locked_at
        const isAlreadySet = !!tenantConfig?.embedding_model
        const activeSupportedProviders = [...new Set(
          configs.filter((c) => c.is_active && EMBEDDING_MODELS[c.provider]).map((c) => c.provider)
        )]
        const modelsForProvider = EMBEDDING_MODELS[embeddingForm.provider] ?? []
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
              <ModalHeader title="設定 Embedding Model" onClose={() => setShowEmbeddingForm(false)} />
              <div className="px-6 py-5 space-y-4">

                {/* 情境 C：已有向量資料 → 強警告 */}
                {isLocked && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-700 space-y-1">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" /> 已有向量索引，變更將清空所有資料
                    </p>
                    <p>原始文件保留，但需重新上傳以重建索引，此操作不可逆。</p>
                  </div>
                )}

                {/* 情境 B：已設定但尚未鎖定 → 軟提示 */}
                {isAlreadySet && !isLocked && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-base text-amber-700">
                    目前已設定 <code className="rounded bg-amber-100 px-1">{tenantConfig?.embedding_model}</code>，尚無向量資料，可安全變更。
                  </div>
                )}

                {/* Provider 選擇：只列已在 Provider 連線設定中啟用的 */}
                <Field label="Provider" required>
                  {activeSupportedProviders.length === 0 ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-base text-gray-500">
                      請先至「Provider 連線設定」新增並啟用 <strong>OpenAI</strong> 或<strong>本機模型 (Local)</strong>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeSupportedProviders.map((p) => (
                        <label
                          key={p}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                            embeddingForm.provider === p
                              ? 'border-gray-400 bg-gray-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="embedding_provider"
                            value={p}
                            checked={embeddingForm.provider === p}
                            onChange={() => {
                              const firstModel = EMBEDDING_MODELS[p]?.[0]?.model ?? ''
                              setEmbeddingForm((f) => ({ ...f, provider: p, model: firstModel }))
                            }}
                            className="h-4 w-4 text-gray-600"
                          />
                          <div className="flex-1">
                            <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS[p] ?? 'bg-gray-100 text-gray-700'}`}>
                              {PROVIDER_LABELS[p] ?? p}
                            </span>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </Field>

                {/* Model 選擇：固定清單 */}
                {modelsForProvider.length > 0 && (
                  <Field label="Model" required>
                    <div className="space-y-2">
                      {modelsForProvider.map((entry) => (
                        <label
                          key={entry.model}
                          className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                            embeddingForm.model === entry.model
                              ? 'border-gray-400 bg-gray-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="embedding_model"
                            value={entry.model}
                            checked={embeddingForm.model === entry.model}
                            onChange={() => setEmbeddingForm((f) => ({ ...f, model: entry.model }))}
                            className="h-4 w-4 text-gray-600"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="font-mono text-base text-gray-800">{entry.model}</p>
                            <p className="text-base text-gray-400">{entry.note}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </Field>
                )}

                {/* 768 維說明 */}
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-base text-gray-500">
                  ℹ️ 系統使用 768 維向量，僅支援以上模型
                </div>

                {/* 情境 C：勾選確認才能儲存 */}
                {isLocked && (
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={embeddingForm.confirm}
                      onChange={(e) => setEmbeddingForm((f) => ({ ...f, confirm: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    <span className="text-base text-gray-700">我了解此操作將清空所有向量索引，且需要重新上傳文件</span>
                  </label>
                )}
              </div>
              <ModalFooter
                onCancel={() => setShowEmbeddingForm(false)}
                onConfirm={handleSaveEmbedding}
                saving={savingEmbedding}
                confirmLabel="儲存"
                confirmDanger={isLocked}
              />
            </div>
          </div>
        )
      })()}

      {/* ── Modal：語音模型設定 ── */}
      {showSpeechForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <ModalHeader title="語音模型設定 (STT)" onClose={() => setShowSpeechForm(false)} />
            <div className="px-6 py-5 space-y-4">

              {/* 語音服務選擇 */}
              <Field label="語音服務" required>
                <div className="space-y-2">
                  {Object.entries(SPEECH_MODELS).map(([p, entry]) => {
                    const needsOpenAI = p === 'openai'
                    const hasOpenAIProvider = configs.some((c) => c.provider === 'openai' && c.is_active)
                    const unavailable = needsOpenAI && !hasOpenAIProvider
                    return (
                      <label
                        key={p}
                        className={`flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                          unavailable
                            ? 'cursor-not-allowed border-gray-100 bg-gray-50 opacity-50'
                            : speechForm.provider === p
                              ? 'cursor-pointer border-gray-400 bg-gray-50'
                              : 'cursor-pointer border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="speech_provider"
                          value={p}
                          disabled={unavailable}
                          checked={speechForm.provider === p}
                          onChange={() => setSpeechForm((f) => ({ ...f, provider: p, model: entry.model }))}
                          className="mt-1 h-4 w-4 text-gray-600"
                        />
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${p === 'openai' ? 'bg-green-100 text-green-800' : 'bg-purple-100 text-purple-800'}`}>
                            {entry.label}
                          </span>
                          <p className="font-mono text-base text-gray-700 mt-1">{entry.model}</p>
                          <p className="text-base text-gray-400">{entry.note}</p>
                          {unavailable && (
                            <p className="text-base text-amber-600">請先在「Provider 連線設定」啟用 OpenAI</p>
                          )}
                        </div>
                      </label>
                    )
                  })}
                </div>
              </Field>

              {/* Local 需填 Base URL */}
              {speechForm.provider === 'local' && (
                <Field label="Base URL" required hint="">
                  <input
                    type="text"
                    placeholder="http://192.168.1.10:8002"
                    value={speechForm.base_url}
                    onChange={(e) => setSpeechForm((f) => ({ ...f, base_url: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  <div className="mt-1 space-y-0.5 text-base text-gray-400">
                    <p>設定成 whisper 服務位址，例：<code className="rounded bg-gray-100 px-1">http://192.168.1.10:8002</code></p>
                    <p>NeuroSme 與 Whisper 在同一台主機時請用：<code className="rounded bg-gray-100 px-1">http://host.docker.internal:8002</code></p>
                  </div>
                </Field>
              )}

            </div>
            <ModalFooter onCancel={() => setShowSpeechForm(false)} onConfirm={handleSaveSpeech} saving={savingSpeech} confirmLabel="儲存" />
          </div>
        </div>
      )}

      {/* ── Confirm：停用語音功能 ── */}
      <ConfirmModal
        open={showDisableSpeechConfirm}
        title="停用語音功能"
        message="確定要停用語音功能？停用後使用者將無法使用語音輸入，可隨時重新設定啟用。"
        confirmText={disablingSpeech ? '停用中...' : '確認停用'}
        variant="danger"
        onConfirm={() => void handleDisableSpeech()}
        onCancel={() => setShowDisableSpeechConfirm(false)}
      />

      {/* ── Modal：刪除確認 ── */}
      {deleteTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6 space-y-4">
            <h3 className="text-lg font-semibold text-gray-800">確認刪除？</h3>
            <p className="text-base text-gray-500">刪除後此 Provider 的 API Key 將無法復原。</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setDeleteTarget(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50">取消</button>
              <button onClick={() => void handleDelete(deleteTarget)} className="rounded-lg bg-red-600 px-4 py-2 text-base font-medium text-white hover:bg-red-500">確認刪除</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal：測試結果 ── */}
      {testResultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="測試結果" onClose={() => setTestResultModal(null)} />
            <div className="px-6 py-5 space-y-4">
              <p className="font-mono text-base text-gray-600 break-all">{testResultModal.model}</p>
              <div className={`rounded-lg border px-5 py-4 space-y-2 ${testResultModal.result.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                <div className="flex items-center gap-3 text-lg font-semibold">
                  <span>{testResultModal.result.ok ? '✅ 連通成功' : '❌ 連通失敗'}</span>
                  {testResultModal.result.elapsed_ms > 0 && (
                    <span className="text-base font-normal opacity-70">{testResultModal.result.elapsed_ms} ms</span>
                  )}
                </div>
                {testResultModal.result.reply && (
                  <div className="text-base">
                    模型回覆：<span className="font-mono">{testResultModal.result.reply}</span>
                  </div>
                )}
                {testResultModal.result.error && (
                  <div className="text-base font-mono break-all">{testResultModal.result.error}</div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setTestResultModal(null)}
                className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal：語音測試結果 ── */}
      {speechTestResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="語音模型測試結果" onClose={() => setSpeechTestResult(null)} />
            <div className="px-6 py-5 space-y-4">
              {tenantConfig?.speech_model && (
                <p className="font-mono text-base text-gray-600 break-all">{tenantConfig.speech_model}</p>
              )}
              <div className={`rounded-lg border px-5 py-4 space-y-2 ${speechTestResult.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                <div className="flex items-center gap-3 text-lg font-semibold">
                  <span>{speechTestResult.ok ? '✅ 連通成功' : '❌ 連通失敗'}</span>
                  {speechTestResult.elapsed_ms && speechTestResult.elapsed_ms > 0 && (
                    <span className="text-base font-normal opacity-70">{speechTestResult.elapsed_ms} ms</span>
                  )}
                </div>
                {speechTestResult.error && (
                  <div className="text-base font-mono break-all">{speechTestResult.error}</div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setSpeechTestResult(null)} className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal：Embedding 測試結果 ── */}
      {embeddingTestResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="Embedding 測試結果" onClose={() => setEmbeddingTestResult(null)} />
            <div className="px-6 py-5 space-y-4">
              {embeddingTestResult.model && (
                <p className="font-mono text-base text-gray-600 break-all">{embeddingTestResult.model}</p>
              )}
              <div className={`rounded-lg border px-5 py-4 space-y-2 ${embeddingTestResult.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
                <div className="flex items-center gap-3 text-lg font-semibold">
                  <span>{embeddingTestResult.ok ? '✅ 連通成功' : '❌ 連通失敗'}</span>
                  {embeddingTestResult.elapsed_ms > 0 && (
                    <span className="text-base font-normal opacity-70">{embeddingTestResult.elapsed_ms} ms</span>
                  )}
                </div>
                {embeddingTestResult.ok && embeddingTestResult.dimensions && (
                  <div className="text-base">向量維度：<span className="font-mono font-semibold">{embeddingTestResult.dimensions}</span></div>
                )}
                {embeddingTestResult.error && (
                  <div className="text-base font-mono break-all">{embeddingTestResult.error}</div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button onClick={() => setEmbeddingTestResult(null)} className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors">關閉</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal：參考設定 ── */}
      {showRefModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl">
            <ModalHeader title="參考設定（僅供參考）" onClose={() => setShowRefModal(false)} />
            <div className="px-6 py-5 space-y-2">
              <p className="text-base text-gray-500 mb-3">以下為 {form.provider} 常用 Model ID，可手動複製填入：</p>
              <ul className="space-y-1.5">
                {defaultModelsForProvider.map((m) => (
                  <li key={m} className="font-mono text-base text-gray-800 bg-gray-50 rounded-lg px-3 py-2 select-all">{m}</li>
                ))}
              </ul>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowRefModal(false)}
                className="rounded-lg bg-gray-700 px-5 py-2 text-base font-medium text-white hover:bg-gray-600 transition-colors"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Online Help：模型選型指南 ── */}
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-llm-settings.md"
        title="AI 模型選型指南"
      />
    </div>
  )
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-gray-500 text-base">{label}</span>
      <span className={`text-gray-800 break-all text-base ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-base font-medium text-gray-700">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-base text-gray-400">{hint}</p>}
    </div>
  )
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
      <h3 className="text-base font-semibold text-gray-800">{title}</h3>
      <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
    </div>
  )
}

function ModalFooter({
  onCancel, onConfirm, saving, confirmLabel = '儲存', confirmDanger = false,
}: {
  onCancel: () => void
  onConfirm: () => void
  saving: boolean
  confirmLabel?: string
  confirmDanger?: boolean
}) {
  return (
    <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
      <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-600 hover:bg-gray-50 transition-colors">取消</button>
      <button
        onClick={onConfirm}
        disabled={saving}
        className={`rounded-lg px-4 py-2 text-base font-medium text-white disabled:opacity-50 transition-colors ${confirmDanger ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}
      >
        {saving ? '處理中...' : confirmLabel}
      </button>
    </div>
  )
}
