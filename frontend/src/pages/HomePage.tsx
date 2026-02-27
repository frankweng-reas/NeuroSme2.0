import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAgents } from '@/api/agents'
import type { Agent } from '@/types'
import AgentIcon from '@/components/AgentIcon'

export default function HomePage() {
  const navigate = useNavigate()
  const [agents, setAgents] = useState<Agent[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    getAgents()
      .then(setAgents)
      .catch(() => setAgents([]))
      .finally(() => setIsLoading(false))
  }, [])

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mx-auto max-w-7xl">
        {/* 標題和按鈕區域 - ReadyQA 風格 */}
        <div className="mb-8 rounded-2xl border-2 border-gray-300 bg-gray-50 px-8 py-6 shadow-lg">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => navigate('/assistant')}
              className="cursor-pointer text-left transition-opacity hover:opacity-80"
            >
              <h1 className="mb-2 text-3xl font-bold text-gray-900">
                我的助理
              </h1>
              <p className="text-lg text-gray-600">
                點選進入你的智能助理
              </p>
            </button>
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
        ) : agents.length === 0 ? (
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
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition-all duration-300 hover:-translate-y-1 hover:border-blue-200 hover:shadow-xl"
                style={{
                  boxShadow:
                    '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)',
                }}
              >
                {/* 背景裝飾 */}
                <div className="absolute right-0 top-0 h-32 w-32 rounded-bl-full bg-gradient-to-br from-blue-50 to-purple-50 opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

                {/* 內容 */}
                <div className="relative flex flex-1 flex-col p-6">
                  <div className="mb-4 flex flex-1 items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border-2 border-gray-200 bg-white shadow-lg transition-all duration-300 group-hover:scale-110 group-hover:border-gray-300 group-hover:shadow-xl">
                        <AgentIcon iconName={agent.icon_name} />
                      </div>
                    </div>

                    <div className="min-w-0 flex-1 pt-1">
                      <p className="mb-1 text-lg font-medium uppercase tracking-wide text-gray-500">
                        {agent.group_name}
                      </p>
                      <h3 className="truncate text-xl font-bold text-gray-900 transition-colors duration-200 group-hover:text-blue-600">
                        {agent.agent_name}
                      </h3>
                    </div>
                  </div>

                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
