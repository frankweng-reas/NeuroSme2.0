import { apiFetch } from './client'

export interface BiProjectItem {
  project_id: string
  project_name: string
  project_desc: string | null
  created_at: string
  conversation_data?: MessageStored[] | null
}

/** 儲存於 DB 的訊息格式（與 Message 相容） */
export interface MessageStored {
  role: 'user' | 'assistant'
  content: string
  meta?: { model: string; usage: Record<string, number>; finish_reason: string | null }
  chartData?: unknown
}

export async function createBiProject(params: {
  agent_id: string
  project_name: string
  project_desc?: string | null
}): Promise<BiProjectItem> {
  return apiFetch<BiProjectItem>('/bi-projects/', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function listBiProjects(agentId: string): Promise<BiProjectItem[]> {
  return apiFetch<BiProjectItem[]>(
    `/bi-projects/?agent_id=${encodeURIComponent(agentId)}`
  )
}

export async function updateBiProject(
  agentId: string,
  projectId: string,
  params: {
    project_name?: string
    project_desc?: string | null
    conversation_data?: MessageStored[]
  }
): Promise<BiProjectItem> {
  return apiFetch<BiProjectItem>(
    `/bi-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    }
  )
}

export async function deleteBiProject(agentId: string, projectId: string): Promise<void> {
  await apiFetch(
    `/bi-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    { method: 'DELETE' }
  )
}
