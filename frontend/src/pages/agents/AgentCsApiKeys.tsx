/**
 * CS Agent API Key 管理頁面
 * 功能：建立、列出、撤銷 API Keys，以及查詢用量圖表
 */
import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Key, Loader2, Plus, Trash2, TrendingUp, X } from 'lucide-react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  createApiKey,
  getApiKeyUsage,
  listApiKeys,
  revokeApiKey,
  type ApiKey,
  type ApiKeyUsageResponse,
} from '@/api/apiKeys'
import ConfirmModal from '@/components/ConfirmModal'
import ErrorModal from '@/components/ErrorModal'
import type { KmKnowledgeBase } from '@/api/km'

const HEADER_COLOR = '#1A3A52'

interface Props {
  canManage: boolean
  kbs: KmKnowledgeBase[]
  selectedKbId: number | null
}

export default function AgentCsApiKeys({ canManage, kbs, selectedKbId }: Props) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [createLoading, setCreateLoading] = useState(false)
  const [plainKey, setPlainKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const [revokeTarget, setRevokeTarget] = useState<ApiKey | null>(null)
  const [revokeLoading, setRevokeLoading] = useState(false)

  const [selectedKeyId, setSelectedKeyId] = useState<number | null>(null)
  const [usageData, setUsageData] = useState<ApiKeyUsageResponse | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)

  const [errorModal, setErrorModal] = useState<{ title?: string; message: string } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
  }, [])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(id)
  }, [toast])

  const loadKeys = useCallback(() => {
    setLoading(true)
    listApiKeys()
      .then(setKeys)
      .catch(() => setKeys([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleCreate = async () => {
    const name = newName.trim()
    if (!name) return
    setCreateLoading(true)
    try {
      const res = await createApiKey(name)
      setKeys((prev) => [res, ...prev])
      setPlainKey(res.plain_key)
      setCreating(false)
      setNewName('')
    } catch (err) {
      setErrorModal({ title: '建立失敗', message: err instanceof Error ? err.message : '未知錯誤' })
    } finally {
      setCreateLoading(false)
    }
  }

  const handleRevoke = async () => {
    if (!revokeTarget) return
    setRevokeLoading(true)
    try {
      await revokeApiKey(revokeTarget.id)
      setKeys((prev) => prev.map((k) => k.id === revokeTarget.id ? { ...k, is_active: false } : k))
      if (selectedKeyId === revokeTarget.id) setUsageData(null)
    } catch (err) {
      setErrorModal({ title: '撤銷失敗', message: err instanceof Error ? err.message : '未知錯誤' })
    } finally {
      setRevokeLoading(false)
      setRevokeTarget(null)
    }
  }

  const loadUsage = useCallback((keyId: number) => {
    setSelectedKeyId(keyId)
    setUsageLoading(true)
    getApiKeyUsage(keyId)
      .then(setUsageData)
      .catch(() => setUsageData(null))
      .finally(() => setUsageLoading(false))
  }, [])

  const handleCopyPlainKey = () => {
    if (!plainKey) return
    navigator.clipboard.writeText(plainKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric' })

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-4 py-2 text-base text-white shadow-lg">
          {toast}
        </div>
      )}

      <ErrorModal
        open={errorModal !== null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={() => setErrorModal(null)}
      />

      <ConfirmModal
        open={revokeTarget !== null}
        title="撤銷 API Key"
        message={`確定要撤銷「${revokeTarget?.name}」嗎？\n撤銷後此 Key 將立即失效，無法還原。`}
        confirmText={revokeLoading ? '處理中…' : '撤銷'}
        variant="danger"
        onConfirm={() => { if (!revokeLoading) void handleRevoke() }}
        onCancel={() => !revokeLoading && setRevokeTarget(null)}
      />

      {/* 明文 Key 顯示 Modal（只出現一次）*/}
      {plainKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-emerald-500" />
                <span className="text-base font-semibold text-gray-800">API Key 建立成功</span>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-base font-medium text-amber-800">重要提示</p>
                <p className="mt-0.5 text-base text-amber-700">
                  此 API Key 只會顯示一次，請立即複製並妥善保存。關閉後將無法再次查看。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={plainKey}
                  className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-base text-gray-800 focus:outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={handleCopyPlainKey}
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-base text-gray-700 hover:bg-gray-50"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已複製' : '複製'}
                </button>
              </div>
            </div>
            <div className="flex justify-end border-t border-gray-100 px-6 py-4">
              <button
                type="button"
                onClick={() => { setPlainKey(null); setCopied(false) }}
                className="rounded-lg px-4 py-2 text-base font-medium text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: HEADER_COLOR }}
              >
                我已複製，關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* API Key 列表 */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-gray-500" />
            <span className="text-base font-semibold text-gray-800">API Keys</span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-sm text-gray-500">
              {keys.filter((k) => k.is_active).length} 個啟用中
            </span>
          </div>
          {canManage && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-base font-medium text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: HEADER_COLOR }}
            >
              <Plus className="h-4 w-4" />
              建立 Key
            </button>
          )}
        </div>

        {/* 建立 Key 表單 */}
        {creating && (
          <div className="flex items-center gap-3 border-b border-gray-100 bg-sky-50/50 px-5 py-3">
            <input
              autoFocus
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreate()
                if (e.key === 'Escape') { setCreating(false); setNewName('') }
              }}
              placeholder="Key 名稱（例：LINE Bot 整合）"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-base focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              maxLength={100}
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={createLoading || !newName.trim()}
              className="flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-base text-white disabled:opacity-50"
            >
              {createLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              建立
            </button>
            <button
              type="button"
              onClick={() => { setCreating(false); setNewName('') }}
              className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Key 列表 */}
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Key className="h-8 w-8 text-gray-200" />
            <p className="text-base text-gray-400">尚無 API Key</p>
            {canManage && <p className="text-base text-gray-300">點擊「建立 Key」開始整合外部 App</p>}
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {keys.map((k) => (
              <li
                key={k.id}
                className={`flex items-center gap-4 px-5 py-3 transition-colors hover:bg-gray-50 ${
                  selectedKeyId === k.id ? 'bg-sky-50/60' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => loadUsage(k.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-base font-medium ${k.is_active ? 'text-gray-800' : 'text-gray-400 line-through'}`}>
                      {k.name}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${
                        k.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {k.is_active ? '啟用' : '已撤銷'}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-3">
                    <span className="font-mono text-base text-gray-400">{k.key_prefix}{'•'.repeat(8)}</span>
                    {k.last_used_at && (
                      <span className="text-base text-gray-400">
                        最近使用：{new Date(k.last_used_at).toLocaleDateString('zh-TW')}
                      </span>
                    )}
                    <span className="text-base text-gray-300">
                      建立：{new Date(k.created_at).toLocaleDateString('zh-TW')}
                    </span>
                  </div>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      showToast('Key 前綴已複製（僅供識別，不含完整金鑰）')
                      navigator.clipboard.writeText(k.key_prefix).catch(() => {})
                    }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    title="複製 Key 前綴（非完整金鑰）"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {canManage && k.is_active && (
                    <button
                      type="button"
                      onClick={() => setRevokeTarget(k)}
                      className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                      title="撤銷此 Key"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 用量圖表 */}
      {selectedKeyId && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-3.5">
            <TrendingUp className="h-4 w-4 text-gray-500" />
            <span className="text-base font-semibold text-gray-800">
              用量統計 — {keys.find((k) => k.id === selectedKeyId)?.name}
            </span>
            <span className="text-base text-gray-400">（近 30 天）</span>
          </div>

          {usageLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
            </div>
          ) : !usageData || usageData.days.length === 0 ? (
            <div className="py-10 text-center text-base text-gray-400">尚無用量資料</div>
          ) : (
            <div className="px-5 py-4 space-y-4">
              {/* 摘要卡片 */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: '總請求數', value: usageData.total_requests.toLocaleString() },
                  { label: '輸入 Tokens', value: usageData.total_input_tokens.toLocaleString() },
                  { label: '輸出 Tokens', value: usageData.total_output_tokens.toLocaleString() },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-center">
                    <p className="text-2xl font-bold text-gray-800">{value}</p>
                    <p className="mt-0.5 text-base text-gray-500">{label}</p>
                  </div>
                ))}
              </div>

              {/* 請求數折線圖 */}
              <div>
                <p className="mb-2 text-base font-medium text-gray-600">每日請求數</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={usageData.days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={36} />
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString(), '請求數']}
                      labelFormatter={(label: string) => new Date(label).toLocaleDateString('zh-TW')}
                    />
                    <Line type="monotone" dataKey="request_count" stroke={HEADER_COLOR} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Tokens 折線圖 */}
              <div>
                <p className="mb-2 text-base font-medium text-gray-600">每日 Token 用量</p>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={usageData.days} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatDate}
                      tick={{ fontSize: 11, fill: '#9ca3af' }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} tickLine={false} axisLine={false} width={42} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        value.toLocaleString(),
                        name === 'input_tokens' ? '輸入 Tokens' : '輸出 Tokens',
                      ]}
                      labelFormatter={(label: string) => new Date(label).toLocaleDateString('zh-TW')}
                    />
                    <Legend
                      formatter={(value: string) => value === 'input_tokens' ? '輸入' : '輸出'}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    <Line type="monotone" dataKey="input_tokens" stroke="#0ea5e9" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="output_tokens" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 使用說明 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-4">
        <p className="mb-3 text-base font-semibold text-gray-700">如何使用 API</p>
        <div className="space-y-4 text-base text-gray-600">

          {/* 知識庫 ID 對照表 */}
          <div>
            <p className="mb-2 font-medium text-gray-800">知識庫 ID 對照</p>
            {kbs.length === 0 ? (
              <p className="text-base text-gray-400">尚無知識庫，請先在左側建立。</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                <table className="w-full text-base">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left text-gray-500">
                      <th className="px-4 py-2 font-medium">knowledge_base_id</th>
                      <th className="px-4 py-2 font-medium">知識庫名稱</th>
                      <th className="px-4 py-2 font-medium">文件數</th>
                    </tr>
                  </thead>
                  <tbody>
                    {kbs.map((kb) => (
                      <tr
                        key={kb.id}
                        className={`border-b border-gray-50 last:border-0 ${selectedKbId === kb.id ? 'bg-sky-50' : ''}`}
                      >
                        <td className="px-4 py-2">
                          <code className="rounded bg-gray-100 px-2 py-0.5 font-mono font-bold text-sky-700">
                            {kb.id}
                          </code>
                          {selectedKbId === kb.id && (
                            <span className="ml-2 rounded-full bg-sky-100 px-1.5 py-0.5 text-xs text-sky-600">目前選取</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-700">{kb.name}</td>
                        <td className="px-4 py-2 text-gray-400">{kb.ready_count}/{kb.doc_count} 份</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 pt-3 space-y-3">
            <p>
              <span className="font-medium text-gray-800">端點：</span>
              <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-base">
                POST /api/v1/public/cs/query
              </code>
            </p>
            <p>
              <span className="font-medium text-gray-800">認證：</span>
              Header 加入 <code className="rounded bg-gray-200 px-1.5 py-0.5 font-mono text-base">X-API-Key: nsk_...</code>
            </p>
            <p className="font-medium text-gray-800">請求範例：</p>
            <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-3 font-mono text-sm text-gray-700">{`curl -X POST ${window.location.origin}/api/v1/public/cs/query \\
  -H "X-API-Key: nsk_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "knowledge_base_id": ${selectedKbId ?? (kbs[0]?.id ?? 1)},
    "question": "請問退貨政策是什麼？"
  }'`}</pre>
            <p className="text-base text-gray-500">
              Rate Limit：每個 API Key 每小時最多 100 次請求。詳細規格請參閱{' '}
              <a
                href="/api/v1/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sky-600 underline hover:text-sky-700"
              >
                /api/v1/docs
              </a>
              （Swagger UI）。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
