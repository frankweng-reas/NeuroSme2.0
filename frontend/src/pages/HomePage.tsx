/** 首頁：顯示「我的助理」區塊與 agents 卡片列表，點擊進入 /agent/:id */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents } from '@/api/agents'
import { getUserByEmail } from '@/api/users'
import { getCurrentUserEmail } from '@/utils/auth'
import type { Agent } from '@/types'
import AgentIcon from '@/components/AgentIcon'

export default function HomePage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const email = getCurrentUserEmail()
    getUserByEmail(email)
      .then((user) => getAgents(user.id))
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoading(false))
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

  // 調和色系：依 group 順序輪替，皆為低飽和度
  const GROUP_COLORS = [
    { ring: 'ring-slate-200', ringHover: 'hover:ring-slate-300', iconBg: 'bg-slate-50', iconColor: 'text-slate-600', accent: 'border-l-slate-300' },
    { ring: 'ring-blue-200/80', ringHover: 'hover:ring-blue-300', iconBg: 'bg-blue-50', iconColor: 'text-blue-600', accent: 'border-l-blue-300' },
    { ring: 'ring-teal-200/80', ringHover: 'hover:ring-teal-300', iconBg: 'bg-teal-50', iconColor: 'text-teal-600', accent: 'border-l-teal-300' },
    { ring: 'ring-violet-200/80', ringHover: 'hover:ring-violet-300', iconBg: 'bg-violet-50', iconColor: 'text-violet-600', accent: 'border-l-violet-300' },
    { ring: 'ring-amber-200/80', ringHover: 'hover:ring-amber-300', iconBg: 'bg-amber-50', iconColor: 'text-amber-700', accent: 'border-l-amber-300' },
  ]
  const getGroupColor = (index: number) => GROUP_COLORS[index % GROUP_COLORS.length]

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-7xl">
        {/* 標題和按鈕區域 - ReadyQA 風格 */}
        <div className="mb-8 rounded-2xl border-2 border-gray-300 bg-gray-50 px-8 py-6 shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="mb-2 text-3xl font-bold text-gray-900">
                我的助理
              </h1>
              <p className="text-lg text-gray-600">
                點選下方卡片進入你的智能助理
              </p>
            </div>
            <button
              type="button"
              className="rounded-full px-6 py-3 font-bold text-white shadow-lg"
              style={{ backgroundColor: '#18333D' }}
            >
              + New
            </button>
          </div>
        </div>

        {/* Agent 卡片列表 */}
        {isLoading ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-gray-600">載入中...</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-gray-100">
              <svg
                className="h-12 w-12 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold text-gray-900">
              尚無助理
            </h3>
            <p className="text-gray-600">目前沒有任何助理</p>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.map(([groupId, groupAgents], groupIndex) => {
              const groupColors = getGroupColor(groupIndex)
              return (
              <div key={groupId}>
                {groupIndex > 0 && (
                  <hr className="mb-8 border-gray-200" />
                )}
                <h2 className={`mb-4 border-l-4 pl-3 text-xl font-semibold text-gray-800 ${groupColors.accent}`}>
                  {groupAgents[0].group_name}
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {groupAgents.map((agent) => {
                    const colors = getGroupColor(groupIndex)
                    return (
                      <div
                        key={agent.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => navigate(`/agent/${agent.id}`)}
                        onKeyDown={(e) => e.key === 'Enter' && navigate(`/agent/${agent.id}`)}
                        className={`group relative flex cursor-pointer flex-row items-center overflow-hidden rounded-xl bg-white px-4 py-3 ring-1 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md hover:ring-2 ${colors.ring} ${colors.ringHover}`}
                      >
                        <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-all duration-300 group-hover:scale-105 ${colors.iconBg}`}>
                          <AgentIcon iconName={agent.icon_name} className={`h-5 w-5 ${colors.iconColor}`} />
                        </div>
                        <h3 className="ml-3 min-w-0 flex-1 truncate text-base font-semibold text-gray-900 transition-colors duration-200 group-hover:text-gray-700">
                          {agent.agent_name}
                        </h3>
                      </div>
                    )
                  })}
                </div>
              </div>
            )})}
          </div>
        )}
      </div>
    </div>
  )
}
