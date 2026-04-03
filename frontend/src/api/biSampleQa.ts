import { apiFetch } from './client'

export interface BiSampleQaItem {
  id: string
  agent_id: string
  question_text: string
  sort_order: number
}

export async function listBiSampleQa(agentId: string): Promise<BiSampleQaItem[]> {
  return apiFetch<BiSampleQaItem[]>(
    `/bi-sample-qa/?agent_id=${encodeURIComponent(agentId)}`
  )
}

export async function createBiSampleQa(params: {
  agent_id: string
  question_text: string
}): Promise<BiSampleQaItem> {
  return apiFetch<BiSampleQaItem>('/bi-sample-qa/', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function deleteBiSampleQa(sampleId: string, agentId: string): Promise<void> {
  await apiFetch<void>(
    `/bi-sample-qa/${encodeURIComponent(sampleId)}?agent_id=${encodeURIComponent(agentId)}`,
    { method: 'DELETE' }
  )
}
