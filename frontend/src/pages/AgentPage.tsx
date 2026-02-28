/** Agent 詳情頁：依 agent_id 選擇 Business/Customer/Default UI 並渲染 */
import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { getAgent } from '@/api/agents'
import { getUserByEmail } from '@/api/users'
import { getCurrentUserEmail } from '@/utils/auth'
import { ApiError } from '@/api/client'
import type { Agent } from '@/types'
import AgentBusinessUI from './agents/AgentBusinessUI'
import AgentCustomerUI from './agents/AgentCustomerUI'
import AgentDefaultUI from './agents/AgentDefaultUI'

function getAgentUI(agent: Agent) {
  const id = agent.agent_id.toLowerCase()
  if (id.includes('business')) return AgentBusinessUI
  if (id.includes('customer')) return AgentCustomerUI
  return AgentDefaultUI
}

export default function AgentPage() {
  const { id } = useParams<{ id: string }>()
  const [agent, setAgent] = useState<Agent | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isForbidden, setIsForbidden] = useState(false)

  useEffect(() => {
    if (!id) return
    const email = getCurrentUserEmail()
    getUserByEmail(email)
      .then((user) => getAgent(id, user.id))
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
  return <AgentUI agent={agent} />
}
