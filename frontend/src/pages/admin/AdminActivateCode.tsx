/** REAS-Activate Code 產生器（super_admin 專用） */
import { useEffect, useState } from 'react'
import { Copy, Check, ClipboardList } from 'lucide-react'
import { listAgentCatalog } from '@/api/agentCatalog'
import { generateActivationCode, listActivationHistory } from '@/api/activation'
import type { ActivationHistoryItem } from '@/api/activation'
import { useToast } from '@/contexts/ToastContext'
import type { AgentCatalog } from '@/types'

export default function AdminActivateCode() {
  const [agents, setAgents] = useState<AgentCatalog[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [customerName, setCustomerName] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [generatedCode, setGeneratedCode] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isGenerating, setIsGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [history, setHistory] = useState<ActivationHistoryItem[]>([])
  const { showToast } = useToast()

  useEffect(() => {
    listAgentCatalog()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoading(false))
    listActivationHistory()
      .then(setHistory)
      .catch(() => setHistory([]))
  }, [])

  function toggleAgent(agentId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(agentId)) next.delete(agentId)
      else next.add(agentId)
      return next
    })
  }

  function selectAll() {
    setSelectedIds(new Set(agents.map((a) => a.agent_id)))
  }

  function deselectAll() {
    setSelectedIds(new Set())
  }

  /** 從歷史記錄複製設定 */
  function applyHistory(item: ActivationHistoryItem) {
    setCustomerName(item.customer_name)
    setSelectedIds(new Set(item.agent_ids))
    setExpiresAt(item.expires_at ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    showToast(`已套用「${item.customer_name}」的設定`)
  }

  async function handleGenerate() {
    if (!customerName.trim()) {
      showToast('請輸入客戶名稱', 'error')
      return
    }
    if (selectedIds.size === 0) {
      showToast('請至少選擇一個 Agent', 'error')
      return
    }
    setIsGenerating(true)
    setGeneratedCode('')
    try {
      const res = await generateActivationCode({
        customer_name: customerName.trim(),
        agent_ids: Array.from(selectedIds),
        expires_at: expiresAt || null,
      })
      setGeneratedCode(res.code)
      showToast('Activation Code 已產生')
      // 重新載入歷史
      listActivationHistory().then(setHistory).catch(() => {})
    } catch (err) {
      const msg = err instanceof Error ? err.message : '產生失敗'
      showToast(msg, 'error')
    } finally {
      setIsGenerating(false)
    }
  }

  async function handleCopy() {
    if (!generatedCode) return
    try {
      await navigator.clipboard.writeText(generatedCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('複製失敗，請手動選取複製', 'error')
    }
  }

  // 依 group_name 分組
  const groups = agents.reduce<Record<string, AgentCatalog[]>>((acc, agent) => {
    const g = agent.group_name ?? '其他'
    if (!acc[g]) acc[g] = []
    acc[g].push(agent)
    return acc
  }, {})

  return (
    <div className="max-w-2xl">
      <h2 className="mb-1 text-xl font-bold text-gray-800">REAS-Activate Code</h2>
      <p className="mb-6 text-sm text-gray-500">產生客戶授權碼，指定可使用的 Agent 模組與到期日。</p>

      {/* 客戶名稱 */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          客戶名稱 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          placeholder="例：ACME 科技股份有限公司"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>

      {/* 到期日 */}
      <div className="mb-5">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          到期日 <span className="text-gray-400 font-normal">（留空 = 永不到期）</span>
        </label>
        <input
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="w-48 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
      </div>

      {/* Agent 選擇 */}
      <div className="mb-5">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">
            授權 Agents <span className="text-red-500">*</span>
            {selectedIds.size > 0 && (
              <span className="ml-2 text-gray-400 font-normal">（已選 {selectedIds.size} 個）</span>
            )}
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={selectAll}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              全選
            </button>
            <button
              type="button"
              onClick={deselectAll}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
            >
              全取消
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-gray-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-transparent" />
            載入中...
          </div>
        ) : (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
            {Object.entries(groups).map(([groupName, groupAgents]) => (
              <div key={groupName}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">{groupName}</p>
                <div className="space-y-1">
                  {groupAgents.map((agent) => (
                    <label
                      key={agent.agent_id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(agent.agent_id)}
                        onChange={() => toggleAgent(agent.agent_id)}
                        className="h-4 w-4 rounded border-gray-300 text-gray-600"
                      />
                      <span className="text-sm text-gray-800">{agent.agent_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 產生按鈕 */}
      <button
        type="button"
        onClick={handleGenerate}
        disabled={isGenerating}
        className="rounded-lg px-5 py-2.5 font-medium text-white shadow-sm disabled:opacity-50"
        style={{ backgroundColor: '#4b5563' }}
      >
        {isGenerating ? '產生中...' : '產生 Activation Code'}
      </button>

      {/* 產生結果 */}
      {generatedCode && (
        <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold text-green-800">Activation Code 已產生</p>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-lg border border-green-300 bg-white px-3 py-1.5 text-sm text-green-700 hover:bg-green-50"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? '已複製' : '複製'}
            </button>
          </div>
          <div className="break-all rounded-md border border-green-200 bg-white px-3 py-2 font-mono text-xs text-gray-700 select-all">
            {generatedCode}
          </div>
          <p className="mt-2 text-xs text-green-600">請將此 Code 傳送給客戶，客戶登入後在啟用對話框貼入即可。</p>
        </div>
      )}

      {/* 歷史記錄 */}
      {history.length > 0 && (
        <div className="mt-10">
          <div className="mb-3 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">歷史記錄</h3>
            <span className="text-xs text-gray-400">（點「套用」可自動填入上方欄位）</span>
          </div>
          <div className="space-y-2">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-800">{item.customer_name}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {item.agent_ids.join('、')}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    產生：{item.created_at.slice(0, 10)}
                    {item.expires_at && <span className="ml-2">到期：{item.expires_at}</span>}
                    {item.activated_at
                      ? <span className="ml-2 text-green-600">✓ 已兌換 {item.activated_at.slice(0, 10)}</span>
                      : <span className="ml-2 text-amber-500">未兌換</span>
                    }
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => applyHistory(item)}
                  className="ml-4 flex-shrink-0 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 hover:border-gray-400 transition-colors"
                >
                  套用
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
