/** Widget 管理：Admin 專用，開通 / 停用 / 重設各知識庫的 Widget Token */
import { useEffect, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleOff,
  Copy,
  Loader2,
  RefreshCw,
  Wifi,
  WifiOff,
} from 'lucide-react'
import {
  generateWidgetToken,
  listKnowledgeBases,
  revokeWidgetToken,
  type KmKnowledgeBase,
} from '@/api/km'

const EMBED_CODE = (origin: string, token: string, color: string) =>
  [
    `<!-- NeuroSme Widget -->`,
    `<button id="ns-btn" onclick="nsTgl()"`,
    `  style="position:fixed;bottom:24px;right:24px;z-index:10000;`,
    `         width:56px;height:56px;border-radius:50%;border:none;`,
    `         background:${color};color:#fff;font-size:26px;`,
    `         cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2)">💬</button>`,
    `<iframe id="ns-ifr" width="400" height="600" frameborder="0"`,
    `  style="display:none;position:fixed;bottom:88px;right:24px;z-index:9999;`,
    `         border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.18)"></iframe>`,
    `<script>`,
    `function nsTgl() {`,
    `  var f = document.getElementById('ns-ifr');`,
    `  var b = document.getElementById('ns-btn');`,
    `  var o = f.style.display !== 'none';`,
    `  if (!o && !f.src) {`,
    `    var l = document.documentElement.lang || navigator.language || 'zh-TW';`,
    `    f.src = '${origin}/widget/${token}?embed=1&lang=' + encodeURIComponent(l);`,
    `  }`,
    `  f.style.display = o ? 'none' : 'block';`,
    `  b.innerHTML = o ? '💬' : '✕';`,
    `}`,
    `<\/script>`,
  ].join('\n')

interface KbRowProps {
  kb: KmKnowledgeBase
  onUpdated: (kb: KmKnowledgeBase) => void
}

function KbRow({ kb, onUpdated }: KbRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null)

  const origin = window.location.origin
  const widgetUrl = kb.public_token ? `${origin}/widget/${kb.public_token}` : null
  const color = kb.widget_color || '#1A3A52'

  const handleGenerate = async () => {
    setLoading(true)
    try {
      const updated = await generateWidgetToken(kb.id)
      onUpdated(updated)
      setExpanded(true)
    } finally {
      setLoading(false)
    }
  }

  const handleRevoke = async () => {
    if (!window.confirm(`確定要停用「${kb.name}」的 Widget？現有連結將立即失效。`)) return
    setLoading(true)
    try {
      const updated = await revokeWidgetToken(kb.id)
      onUpdated(updated)
    } finally {
      setLoading(false)
    }
  }

  const handleReset = async () => {
    if (!window.confirm(`確定要重設「${kb.name}」的 Widget Token？舊連結將失效。`)) return
    setLoading(true)
    try {
      const updated = await generateWidgetToken(kb.id)
      onUpdated(updated)
    } finally {
      setLoading(false)
    }
  }

  const copy = (text: string, type: 'link' | 'embed') => {
    navigator.clipboard.writeText(text)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* 標題列 */}
      <div className="flex items-center gap-3 px-5 py-4">
        {kb.public_token ? (
          <Wifi className="h-5 w-5 shrink-0 text-green-500" />
        ) : (
          <WifiOff className="h-5 w-5 shrink-0 text-gray-300" />
        )}
        <div className="flex-1">
          <p className="text-base font-medium text-gray-800">{kb.name}</p>
          {kb.public_token ? (
            <p className="text-xs text-green-600">已開通</p>
          ) : (
            <p className="text-xs text-gray-400">未開通</p>
          )}
        </div>

        {/* 操作按鈕 */}
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {!kb.public_token ? (
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm text-sky-700 hover:bg-sky-100 disabled:opacity-50"
            >
              <Wifi className="h-3.5 w-3.5" />
              開通
            </button>
          ) : (
            <>
              <button
                onClick={handleRevoke}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <CircleOff className="h-3.5 w-3.5" />
                停用
              </button>
              <button
                onClick={handleReset}
                disabled={loading}
                className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-white px-3 py-1.5 text-sm text-orange-600 hover:bg-orange-50 disabled:opacity-50"
                title="重設 Token（舊連結將失效）"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                重設 Token
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                className="rounded-lg border border-gray-200 px-2 py-1.5 text-gray-400 hover:bg-gray-50"
              >
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* 展開區：embed code */}
      {expanded && kb.public_token && widgetUrl && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-4">
          {/* Widget 連結 */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-600">Widget 連結</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={widgetUrl}
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-700 focus:outline-none"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={() => copy(widgetUrl, 'link')}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                {copied === 'link' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                複製
              </button>
            </div>
          </div>

          {/* Embed Code */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium text-gray-600">
                Embed Code
                <span className="ml-1 font-normal text-gray-400">（貼入網頁 &lt;body&gt; 尾端）</span>
              </label>
              <button
                onClick={() => copy(EMBED_CODE(origin, kb.public_token!, color), 'embed')}
                className="flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50"
              >
                {copied === 'embed' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
                複製
              </button>
            </div>
            <textarea
              readOnly
              rows={12}
              value={EMBED_CODE(origin, kb.public_token!, color)}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-mono text-gray-600 focus:outline-none"
              onClick={(e) => (e.target as HTMLTextAreaElement).select()}
            />
            <p className="mt-1 text-xs text-gray-400">
              語言優先序：網站 <code>lang</code> 屬性 › KB 設定語言 › 繁體中文
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminWidgetManagement() {
  const [kbs, setKbs] = useState<KmKnowledgeBase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listKnowledgeBases()
      .then(setKbs)
      .catch(() => setKbs([]))
      .finally(() => setLoading(false))
  }, [])

  const handleUpdated = (updated: KmKnowledgeBase) => {
    setKbs((prev) => prev.map((kb) => (kb.id === updated.id ? updated : kb)))
  }

  const active = kbs.filter((kb) => kb.public_token)
  const inactive = kbs.filter((kb) => !kb.public_token)

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Widget 管理</h1>
        <p className="mt-1 text-sm text-gray-500">
          開通後，用戶可將 Widget 嵌入外部網站。Token 由管理員統一管理，外觀設定由各知識庫擁有者在知識庫設定中配置。
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          載入中...
        </div>
      ) : kbs.length === 0 ? (
        <p className="text-sm text-gray-400">目前沒有知識庫。</p>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-gray-500">
                已開通 ({active.length})
              </h2>
              <div className="space-y-3">
                {active.map((kb) => (
                  <KbRow key={kb.id} kb={kb} onUpdated={handleUpdated} />
                ))}
              </div>
            </section>
          )}
          {inactive.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-gray-500">
                未開通 ({inactive.length})
              </h2>
              <div className="space-y-3">
                {inactive.map((kb) => (
                  <KbRow key={kb.id} kb={kb} onUpdated={handleUpdated} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
