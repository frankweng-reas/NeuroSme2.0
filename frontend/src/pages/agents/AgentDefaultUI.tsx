/** 預設 UI：無專屬 UI 的 agent 使用此版面 */
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { Agent } from '@/types'

interface AgentDefaultUIProps {
  agent: Agent
}

export default function AgentDefaultUI({ agent }: AgentDefaultUIProps) {
  return (
    <div className="flex h-full flex-col p-4">
      {/* Header 容器 */}
      <header
        className="flex-shrink-0 rounded-lg border-b border-gray-200 px-6 py-4 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center text-white transition-opacity hover:opacity-80"
            aria-label="返回"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-2xl font-bold text-white">{agent.agent_name}</h1>
        </div>
      </header>

      {/* Content 容器 - 預設 */}
      <div className="mt-4 flex flex-1 flex-col rounded-lg border-2 border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-lg text-gray-500">開發中...</p>
      </div>
    </div>
  )
}
