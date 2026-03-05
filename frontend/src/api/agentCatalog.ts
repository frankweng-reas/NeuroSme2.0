import { apiFetch } from './client'
import type { AgentCatalog } from '@/types'

/** 取得所有 agent_catalog（需 super_admin） */
export async function listAgentCatalog(): Promise<AgentCatalog[]> {
  return apiFetch<AgentCatalog[]>('/agent-catalog/')
}

/** 新增 agent */
export async function createAgentCatalog(data: {
  id: string
  sort_id?: string | null
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name?: string | null
}): Promise<AgentCatalog> {
  return apiFetch<AgentCatalog>('/agent-catalog/', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

/** 更新 agent */
export async function updateAgentCatalog(
  id: string,
  data: {
    sort_id?: string | null
    group_id: string
    group_name: string
    agent_id: string
    agent_name: string
    icon_name?: string | null
  }
): Promise<AgentCatalog> {
  return apiFetch<AgentCatalog>(`/agent-catalog/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

/** 刪除 agent */
export async function deleteAgentCatalog(id: string): Promise<void> {
  return apiFetch(`/agent-catalog/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
