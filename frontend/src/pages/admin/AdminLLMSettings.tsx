/** Admin：租戶 LLM 設定（admin / super_admin） */
import { useCallback, useEffect, useState } from 'react'
import {
  KeyRound,
  Pencil,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Zap,
  Lock,
  Settings2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from 'lucide-react'
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
} from '@/api/llmConfigs'
import type {
  EmbeddingTestResult,
  LLMProviderConfigCreate,
  LLMProviderConfigUpdate,
  LLMTestResult,
  TenantConfig,
} from '@/api/llmConfigs'
import { getMe } from '@/api/users'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { LLMProviderConfig } from '@/types'

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  twcc: '台智雲 TWCC',
  local: '本機模型 (Local)',
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-100 text-green-800',
  gemini: 'bg-blue-100 text-blue-800',
  twcc: 'bg-orange-100 text-orange-800',
  local: 'bg-purple-100 text-purple-800',
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  provider: string
  label: string
  api_key: string
  api_base_url: string
  available_models_text: string
  is_active: boolean
}

const EMPTY_FORM: FormState = {
  provider: 'openai',
  label: '',
  api_key: '',
  api_base_url: '',
  available_models_text: '',
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

  // default LLM edit
  const [showDefaultLLMForm, setShowDefaultLLMForm] = useState(false)
  const [defaultLLMForm, setDefaultLLMForm] = useState({ provider: '', model: '' })
  const [savingDefaultLLM, setSavingDefaultLLM] = useState(false)

  // embedding migration
  const [showMigrateForm, setShowMigrateForm] = useState(false)
  const [migrateForm, setMigrateForm] = useState({ provider: 'openai', model: '', confirm: false })
  const [migrating, setMigrating] = useState(false)

  // embedding test
  const [testingEmbedding, setTestingEmbedding] = useState(false)
  const [embeddingTestResult, setEmbeddingTestResult] = useState<EmbeddingTestResult | null>(null)

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
      api_base_url: cfg.api_base_url ?? '',
      available_models_text: (cfg.available_models ?? []).join('\n'),
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
      const availableModels = form.available_models_text
        .split('\n').map((s) => s.trim()).filter(Boolean)

      if (editingId !== null) {
        const body: LLMProviderConfigUpdate = {
          label: form.label || null,
          api_base_url: form.api_base_url || null,
          available_models: availableModels.length > 0 ? availableModels : null,
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
          available_models: availableModels.length > 0 ? availableModels : null,
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

  // ── Embedding migration ───────────────────────────────────────────────────

  async function handleMigrate() {
    if (!migrateForm.model.trim()) { showToast('請填寫新的 Model 名稱', 'error'); return }
    if (!migrateForm.confirm) { showToast('請勾選確認選項', 'error'); return }
    setMigrating(true)
    try {
      const tc = await migrateEmbedding({
        provider: migrateForm.provider,
        model: migrateForm.model.trim(),
        confirm: true,
      })
      setTenantConfig(tc)
      setShowMigrateForm(false)
        setMigrateForm({ provider: 'openai', model: '', confirm: false })
      showToast('Embedding 遷移完成，請重新上傳文件以建立索引', 'success')
      load()
    } catch (err) {
      showToast(err instanceof ApiError ? (err.detail ?? err.message) : '遷移失敗', 'error')
    } finally {
      setMigrating(false)
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

  const defaultModelsForProvider = providerOptions[form.provider] ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 text-lg">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Settings2 className="h-6 w-6 text-gray-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-800">AI 設定（租戶）</h2>
            {currentTenantId && (
              <p className="text-base text-gray-500 mt-0.5">
                租戶 ID：<code className="rounded bg-gray-100 px-1.5 py-0.5">{currentTenantId}</code>
              </p>
            )}
          </div>
        </div>
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">

              {/* 預設 LLM */}
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
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
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-base font-medium text-gray-500 uppercase tracking-wide">Embedding Model</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => void handleTestEmbedding()}
                      disabled={testingEmbedding}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-gray-500 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                    >
                      <Zap className={`h-3.5 w-3.5 ${testingEmbedding ? 'animate-pulse' : ''}`} />
                      {testingEmbedding ? '測試中...' : '測試'}
                    </button>
                    <button
                      onClick={() => {
                        setMigrateForm({ provider: tenantConfig?.embedding_provider === 'local' ? 'local' : 'openai', model: '', confirm: false })
                        setShowMigrateForm(true)
                      }}
                      className="flex items-center gap-1 rounded px-2 py-1 text-base text-orange-500 hover:text-orange-700 hover:bg-orange-50 transition-colors"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" /> 遷移
                    </button>
                  </div>
                </div>
                {tenantConfig && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-base font-semibold ${PROVIDER_COLORS[tenantConfig.embedding_provider] ?? 'bg-gray-100 text-gray-700'}`}>
                        {PROVIDER_LABELS[tenantConfig.embedding_provider] ?? tenantConfig.embedding_provider}
                      </span>
                      <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-base text-gray-500">
                        v{tenantConfig.embedding_version}
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
              {configs.map((cfg) => {
                const isExpanded = expandedIds.has(cfg.id)
                const isToggling = togglingIds.has(cfg.id)
                const colorClass = PROVIDER_COLORS[cfg.provider] ?? 'bg-gray-100 text-gray-800'
                // models to display: available_models or fallback to provider defaults
                const models: string[] = cfg.available_models?.length
                  ? cfg.available_models
                  : (providerOptions[cfg.provider] ?? [])

                return (
                  <div
                    key={cfg.id}
                    className={`rounded-lg border bg-white shadow-sm overflow-hidden transition-opacity ${cfg.is_active ? 'border-gray-200' : 'border-gray-200 opacity-60'}`}
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
                        {models.map((m) => {
                          const key = testKey(cfg.id, m)
                          const isTesting = testingKey === key
                          return (
                            <div key={m} className="flex items-center gap-3">
                              <span className="font-mono text-base text-gray-700 flex-1 truncate">{m}</span>
                              <button
                                onClick={() => void handleTestModel(cfg.id, m)}
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
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl overflow-y-auto max-h-[90vh]">
            <ModalHeader title={editingId !== null ? '編輯 Provider 連線' : '新增 Provider 連線'} onClose={() => setShowForm(false)} />
            <div className="px-6 py-5 space-y-4">

              <Field label="Provider" required>
                <select
                  disabled={editingId !== null}
                  value={form.provider}
                  onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value, available_models_text: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:bg-gray-50"
                >
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
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
                hint={form.provider === 'local' ? '本機服務通常不需要 API Key，可留空或填任意字串（如 local）' : undefined}
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
                      ? '本機服務必填，例：http://localhost:11434（Ollama）或 http://localhost:1234（LM Studio）'
                      : '選填，用於 Azure OpenAI 或 OpenAI-compatible Proxy'
                }
              >
                <input
                  type="text"
                  placeholder={
                    form.provider === 'twcc'
                      ? 'https://api-ams.twcc.ai/api/models/conversation'
                      : form.provider === 'local'
                        ? 'http://localhost:11434'
                        : 'https://your-proxy.example.com/v1'
                  }
                  value={form.api_base_url}
                  onChange={(e) => setForm((f) => ({ ...f, api_base_url: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </Field>

              <Field label="可用 Models（每行一個）">
                <textarea
                  rows={4}
                  placeholder={defaultModelsForProvider.join('\n') || '每行一個 model id'}
                  value={form.available_models_text}
                  onChange={(e) => setForm((f) => ({ ...f, available_models_text: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
                />
                {defaultModelsForProvider.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, available_models_text: defaultModelsForProvider.join('\n') }))}
                    className="text-base text-blue-600 hover:underline mt-1"
                  >
                    使用預設清單
                  </button>
                )}
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
                      {ms.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setDefaultLLMForm((f) => ({ ...f, model: m }))}
                          className="rounded bg-gray-100 px-2 py-0.5 text-base text-gray-600 hover:bg-gray-200 transition-colors font-mono"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ) : null
                })()}
              </Field>
            </div>
            <ModalFooter onCancel={() => setShowDefaultLLMForm(false)} onConfirm={handleSaveDefaultLLM} saving={savingDefaultLLM} confirmLabel="儲存" />
          </div>
        </div>
      )}

      {/* ── Modal：Embedding 遷移 ── */}
      {showMigrateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-2xl">
            <ModalHeader title="遷移 Embedding Model" onClose={() => setShowMigrateForm(false)} />
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-base text-red-700 space-y-1">
                <p className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> 此操作不可逆</p>
                <p>執行後將清空此租戶所有向量索引，原始文件保留但需重新上傳以重建索引。</p>
              </div>

              <Field label="新 Provider" required>
                <select
                  value={migrateForm.provider}
                  onChange={(e) => setMigrateForm((f) => ({ ...f, provider: e.target.value, model: '' }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  <option value="openai">OpenAI</option>
                  <option value="local">本機模型 (Local / Ollama)</option>
                </select>
              </Field>

              {migrateForm.provider === 'local' && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-base text-blue-800 space-y-1">
                  <p className="font-semibold">使用本機 Embedding 前請確認：</p>
                  <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                    <li>已在「Provider 連線設定」新增並啟用 <strong>本機模型 (Local)</strong>，並填入 API Base URL（例：<code className="bg-blue-100 px-1 rounded">http://&lt;server&gt;:11434</code>）</li>
                    <li>推薦使用 <code className="bg-blue-100 px-1 rounded">nomic-embed-text</code>（768 維，與系統 schema 一致）</li>
                    <li>請先在 Ollama 執行 <code className="bg-blue-100 px-1 rounded">ollama pull nomic-embed-text</code></li>
                  </ul>
                </div>
              )}

              <Field
                label="新 Model"
                required
                hint={
                  migrateForm.provider === 'local'
                    ? '輸入 Ollama 模型名稱（不含 ollama/ 前綴），例：nomic-embed-text'
                    : '例：text-embedding-3-small（OpenAI）'
                }
              >
                <input
                  type="text"
                  placeholder={
                    migrateForm.provider === 'local'
                      ? 'nomic-embed-text'
                      : migrateForm.provider === 'openai'
                        ? 'text-embedding-3-small'
                        : 'text-embedding-004'
                  }
                  value={migrateForm.model}
                  onChange={(e) => setMigrateForm((f) => ({ ...f, model: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
                {migrateForm.provider === 'local' && (
                  <button
                    type="button"
                    onClick={() => setMigrateForm((f) => ({ ...f, model: 'nomic-embed-text' }))}
                    className="mt-1.5 rounded bg-blue-100 px-2 py-0.5 text-base text-blue-700 hover:bg-blue-200 transition-colors font-mono"
                  >
                    nomic-embed-text <span className="font-normal text-blue-500">768 維 ✓</span>
                  </button>
                )}
              </Field>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={migrateForm.confirm}
                  onChange={(e) => setMigrateForm((f) => ({ ...f, confirm: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-base text-gray-700">我了解此操作將清空所有向量索引，且需要重新上傳文件</span>
              </label>
            </div>
            <ModalFooter
              onCancel={() => setShowMigrateForm(false)}
              onConfirm={handleMigrate}
              saving={migrating}
              confirmLabel="確認遷移"
              confirmDanger
            />
          </div>
        </div>
      )}

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
