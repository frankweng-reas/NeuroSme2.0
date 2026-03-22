/** Test01 Agent 專用 UI：CSV → Schema Mapping → DuckDB */
import AgentIcon from '@/components/AgentIcon'
import AgentPageLayout from '@/components/AgentPageLayout'
import MappingTemplateEditor from '@/components/MappingTemplateEditor'
import type { Agent } from '@/types'

interface AgentTestUIProps {
  agent: Agent
}

export default function AgentTestUI({ agent }: AgentTestUIProps) {
  return (
    <AgentPageLayout
      title={agent.agent_name}
      headerIcon={<AgentIcon iconName={agent.icon_name} className="h-6 w-6 text-white" />}
    >
      <MappingTemplateEditor />
    </AgentPageLayout>
  )
}
