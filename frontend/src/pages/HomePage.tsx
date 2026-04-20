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
  quotation: '自動化報價流程管理',
  customer:  '客戶行為分析與洞察',
  scheduling:'排班與行程規劃輔助',
  interview: '面試流程與評核輔助',
  invoice:   '發票與財務單據管理',
}

export default function HomePage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showActivationDialog, setShowActivationDialog] = useState(false)

  useEffect(() => {
    getAgents(false)
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoading(false))
  }, [])

  // 登入後檢查是否需要啟用（admin 且 tenant_agents 為空）
  useEffect(() => {
    getMe()
      .then((me) => {
        if (me.role === 'super_admin') return
        if (me.role !== 'admin') return
        return getActivationStatus().then((status) => {
          if (!status.activated) setShowActivationDialog(true)
        })
      })
      .catch(() => { /* 靜默忽略 */ })
  }, [])

  const groups = useMemo(() => {
    const map = new Map<string, Agent[]>()
    for (const agent of agents) {
      const key = agent.group_id
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(agent)
    }
    return Array.from(map.entries())
  }, [agents])

  const GROUP_COLORS = [
    { ring: 'ring-slate-200',     ringHover: 'hover:ring-slate-400',   cardBg: 'bg-slate-50',   iconBg: 'bg-slate-200',  iconColor: 'text-slate-600',  accent: 'border-l-slate-400'  },
    { ring: 'ring-blue-200/80',   ringHover: 'hover:ring-blue-400',    cardBg: 'bg-blue-50',    iconBg: 'bg-blue-100',   iconColor: 'text-blue-600',   accent: 'border-l-blue-400'   },
    { ring: 'ring-teal-200/80',   ringHover: 'hover:ring-teal-400',    cardBg: 'bg-teal-50',    iconBg: 'bg-teal-100',   iconColor: 'text-teal-600',   accent: 'border-l-teal-400'   },
    { ring: 'ring-violet-200/80', ringHover: 'hover:ring-violet-400',  cardBg: 'bg-violet-50',  iconBg: 'bg-violet-100', iconColor: 'text-violet-600', accent: 'border-l-violet-400' },
    { ring: 'ring-amber-200/80',  ringHover: 'hover:ring-amber-400',   cardBg: 'bg-amber-50',   iconBg: 'bg-amber-100',  iconColor: 'text-amber-700',  accent: 'border-l-amber-400'  },
  ]
  const getGroupColor = (index: number) => GROUP_COLORS[index % GROUP_COLORS.length]

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
        {/* Agent 卡片列表 */}
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-gray-500">載入中...</p>
          </div>
        ) : groups.length === 0 ? (
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
          <div className="space-y-10">
            {groups.map(([groupId, groupAgents], groupIndex) => {
              const groupColors = getGroupColor(groupIndex)
              return (
                <div key={groupId}>
                  <h2 className={`mb-4 border-l-4 pl-3 text-lg font-semibold text-gray-700 ${groupColors.accent}`}>
                    {groupAgents[0].group_name}
                  </h2>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {groupAgents.map((agent) => {
                      const colors = getGroupColor(groupIndex)
                      const description = AGENT_DESCRIPTIONS[agent.agent_id] ?? ''
                      return (
                        <div
                          key={agent.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => navigate(`/agent/${encodeURIComponent(agent.id)}`)}
                          onKeyDown={(e) => e.key === 'Enter' && navigate(`/agent/${encodeURIComponent(agent.id)}`)}
                          className={`group flex cursor-pointer items-start gap-4 rounded-xl p-5 ring-1 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-2 ${colors.cardBg} ${colors.ring} ${colors.ringHover}`}
                        >
                          <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 ${colors.iconBg}`}>
                            <AgentIcon iconName={agent.icon_name} className={`h-6 w-6 ${colors.iconColor}`} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-xl font-semibold text-gray-900">{agent.agent_name}</h3>
                            {description && (
                              <p className="mt-1 text-lg leading-snug text-gray-500">{description}</p>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
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
