/** 預設 UI：無專屬 UI 的 agent 使用此版面 */
import AgentIcon from '@/components/AgentIcon'
import AgentPageLayout from '@/components/AgentPageLayout'
import type { Agent } from '@/types'

interface AgentDefaultUIProps {
  agent: Agent
}

export default function AgentDefaultUI({ agent }: AgentDefaultUIProps) {
  return (
    <AgentPageLayout
      title={agent.agent_name}
      headerIcon={<AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />}
    >
      <div className="flex flex-1 flex-col rounded-2xl border-2 border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-gray-500">開發中...</p>
      </div>
    </AgentPageLayout>
  )
}
