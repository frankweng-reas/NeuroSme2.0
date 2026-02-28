/** agent_id 含 customer 時使用：客戶型 agent 專用 UI */
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { Agent } from '@/types'

interface AgentCustomerUIProps {
  agent: Agent
}

export default function AgentCustomerUI({ agent }: AgentCustomerUIProps) {
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

      {/* Content 容器 - B 工程師開發 */}
      <div className="mt-4 flex flex-1 flex-col rounded-lg border-2 border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-lg text-gray-500">開發中...</p>
      </div>
    </div>
  )
}
