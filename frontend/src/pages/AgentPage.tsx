/** Agent 詳情頁：依 agent_id 選擇 Business/Customer/Chat/Default UI 並渲染 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgent } from '@/api/agents'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types'
import AgentBusinessUI from './agents/AgentBusinessUI'
import AgentChatUI from './agents/AgentChatUI'
import AgentCustomerUI from './agents/AgentCustomerUI'
import AgentQuotationUI from './agents/AgentQuotationUI'
import AgentWritingUI from './agents/AgentWritingUI'
import AgentMarketingUI from './agents/AgentMarketingUI'
import AgentOcrUI from './agents/AgentOcrUI'
import AgentKbManagerUI from './agents/AgentKbManagerUI'
import AgentKbBotBuilderUI from './agents/AgentKbBotBuilderUI'
import AgentDocRefinerUI from './agents/AgentDocRefinerUI'
import AgentPageLayout from '@/components/AgentPageLayout'
import AgentIcon from '@/components/AgentIcon'

function getAgentUI(agent: Agent) {
  const id = agent.agent_id.toLowerCase()
  if (id === 'chat') return AgentChatUI
  if (id === 'kb-manager') return AgentKbManagerUI
  if (id === 'kb-bot-builder') return AgentKbBotBuilderUI
  if (id === 'doc-refiner') return AgentDocRefinerUI
  if (id === 'writing') return AgentWritingUI
  if (id === 'marketing') return AgentMarketingUI
  if (id.includes('business')) return AgentBusinessUI
  if (id.includes('customer')) return AgentCustomerUI
  if (id.includes('quotation')) return AgentQuotationUI
  if (id === 'ocr') return AgentOcrUI

  return null
}

export default function AgentPage() {
  const { id } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isForbidden, setIsForbidden] = useState(false)

  useEffect(() => {
    if (!id) return
    getAgent(id)
      .then((a) => {
        setAgent(a)
        setIsForbidden(false)
      })
      .catch((err) => {
        setAgent(null)
        setIsForbidden(err instanceof ApiError && err.status === 403)
      })
      .finally(() => setIsLoading(false))
  }, [id])

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    )
  }

  if (isForbidden) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-600">您沒有權限存取此助理</p>
        <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
          ← 返回首頁
        </Link>
      </div>
    )
  }

  if (!agent) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-gray-600">找不到此助理</p>
        <Link to="/" className="mt-4 inline-block text-blue-600 hover:underline">
          ← 返回首頁
        </Link>
      </div>
    )
  }

  const AgentUI = getAgentUI(agent)
  if (!AgentUI) {
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
  return <AgentUI agent={agent} />
}
