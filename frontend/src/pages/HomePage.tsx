/** 首頁：顯示「我的助理」區塊與 agents 卡片列表，點擊進入 /agent/:id */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents } from '@/api/agents'
import { getActivationStatus } from '@/api/activation'
import { getMe } from '@/api/users'
import ActivationDialog from '@/components/ActivationDialog'
import type { Agent } from '@/types'
import AgentIcon from '@/components/AgentIcon'

const AGENT_DESCRIPTIONS: Record<string, string> = {
  chat:      '通用對話，協助思考、草擬文件與說明',
  writing:   'AI 輔助撰寫商業文書，一鍵生成草稿',
  knowledge: '根據企業知識庫文件精準回答問題',
  cs:        '基於知識庫，提供精準客服問答',
  business:  '數據分析與商業洞察報告',
  marketing: '社群貼文、廣告文案、EDM 一鍵生成',
  quotation: '自動化報價流程管理',
  customer:  '客戶行為分析與洞察',
  interview: '面試流程與評核輔助',
  invoice:   '發票與財務單據管理',
  ocr:       '上傳圖片，自動抽取結構化欄位資料',
}

// 依 group 首次出現順序分配色盤
const PALETTES = [
  { ring: 'ring-slate-200',     ringHover: 'hover:ring-slate-300',   iconBg: 'bg-slate-100',   iconColor: 'text-slate-600',  badgeBg: 'bg-slate-100',   badgeText: 'text-slate-600'  },
  { ring: 'ring-blue-200',      ringHover: 'hover:ring-blue-300',    iconBg: 'bg-blue-100',    iconColor: 'text-blue-600',   badgeBg: 'bg-blue-50',     badgeText: 'text-blue-600'   },
  { ring: 'ring-teal-200',      ringHover: 'hover:ring-teal-300',    iconBg: 'bg-teal-100',    iconColor: 'text-teal-600',   badgeBg: 'bg-teal-50',     badgeText: 'text-teal-600'   },
  { ring: 'ring-violet-200',    ringHover: 'hover:ring-violet-300',  iconBg: 'bg-violet-100',  iconColor: 'text-violet-600', badgeBg: 'bg-violet-50',   badgeText: 'text-violet-600' },
  { ring: 'ring-amber-200',     ringHover: 'hover:ring-amber-300',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-700',  badgeBg: 'bg-amber-50',    badgeText: 'text-amber-700'  },
]

function getGreeting(): string {
  const h = new Date().getHours()
  if (h >= 5 && h < 12) return '早安'
  if (h >= 12 && h < 14) return '午安'
  if (h >= 14 && h < 18) return '下午好'
  return '晚上好'
}

export default function HomePage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showActivationDialog, setShowActivationDialog] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    getAgents(false)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoading(false))
  }, [])

  // 取得使用者名稱，同時檢查啟用狀態
  useEffect(() => {
    getMe()
      .then((me) => {
        setUsername(me.display_name || me.username || me.email.split('@')[0])
        if (me.role === 'super_admin') return
        if (me.role !== 'admin') return
        return getActivationStatus().then((status) => {
          if (!status.activated) setShowActivationDialog(true)
        })
      })
      .catch(() => { /* 靜默忽略 */ })
  }, [])

  // 依 group 分組（保留 API 回傳的 sort_id 順序，group 間以第一個 agent 的 sort_id 排序）
  const groups = useMemo(() => {
    const map = new Map<string, Agent[]>()
    for (const agent of agents) {
      if (!map.has(agent.group_id)) map.set(agent.group_id, [])
      map.get(agent.group_id)!.push(agent)
    }
    return Array.from(map.entries())
  }, [agents])

  // 將 groups 攤平為一維：group 內順序 + group 間順序都與舊版一致
  const sortedAgents = useMemo(
    () => groups.flatMap(([, groupAgents]) => groupAgents),
    [groups],
  )

  // group_id → palette index（依 group 首次出現順序決定）
  const groupPaletteIndex = useMemo(() => {
    const map = new Map<string, number>()
    for (const [, groupAgents] of groups) {
      const gid = groupAgents[0].group_id
      if (!map.has(gid)) map.set(gid, map.size)
    }
    return map
  }, [groups])

  return (
    <div className="flex h-full flex-col px-2 pt-3 pb-5">
      {showActivationDialog && (
        <ActivationDialog
          onActivated={() => {
            setShowActivationDialog(false)
            window.location.reload()
          }}
        />
      )}
      {/* 大圓角容器：充滿剩餘高度，內部捲動 */}
      <div
        className="flex min-h-0 flex-1 flex-col rounded-3xl ring-1 ring-slate-300/60 shadow-xl"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath d='M 0 0 L 40 40 M 40 0 L 0 40' fill='none' stroke='rgba(24,51,61,0.1)' stroke-width='1'/%3E%3C/svg%3E"), linear-gradient(160deg, #e3e9ec 0%, #dee5e8 100%)`,
        }}
      >
        <div className="flex-1 overflow-y-auto px-7 py-6">

          {/* Hero 問候區 */}
          {!isLoading && (
            <div className="mb-7 flex items-end justify-between">
              <div>
                <h1 className="mt-0.5 text-3xl font-bold text-slate-700 tracking-tight">
                  {getGreeting()}，{username || '…'}
                </h1>
                <p className="mt-1 text-base text-slate-500">今天要用哪個助理？</p>
              </div>
              {sortedAgents.length > 0 && (
                <div className="flex items-center gap-2 rounded-2xl bg-white/60 px-4 py-2 ring-1 ring-slate-200 shadow-sm backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="text-base font-medium text-slate-600">
                    {sortedAgents.length} 個助理已開通
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Agent 卡片 */}
          {isLoading ? (
            <div className="py-16 text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
              <p className="text-gray-500">載入中...</p>
            </div>
          ) : agents.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-100">
                <svg className="h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="mb-1 text-xl font-semibold text-gray-800">尚未開通任何助理</h3>
              <p className="text-base text-gray-500">請聯絡管理員輸入授權碼以開通模組</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {sortedAgents.map((agent) => {
                const idx = (groupPaletteIndex.get(agent.group_id) ?? 0) % PALETTES.length
                const p = PALETTES[idx]
                const description = AGENT_DESCRIPTIONS[agent.agent_id] ?? ''
                return (
                  <div
                    key={agent.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(`/agent/${encodeURIComponent(agent.id)}`)}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/agent/${encodeURIComponent(agent.id)}`)}
                    className={`group relative flex cursor-pointer items-center gap-5 rounded-xl bg-white px-5 pt-5 pb-9 ring-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-2 ${p.ring} ${p.ringHover}`}
                  >
                    {/* icon：與右側文字垂直置中 */}
                    <div className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${p.iconBg}`}>
                      <AgentIcon iconName={agent.icon_name} className={`h-7 w-7 ${p.iconColor}`} />
                    </div>
                    {/* 右側：name + desc */}
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-base font-semibold leading-snug text-gray-900">
                        {agent.agent_name}
                      </h3>
                      <p className="mt-0.5 truncate text-sm leading-snug text-gray-500">
                        {description || '—'}
                      </p>
                    </div>
                    {/* badge：絕對定位右下角 */}
                    <span className={`absolute bottom-2.5 right-4 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${p.badgeBg} ${p.badgeText}`}>
                      {agent.group_name}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
