import { apiFetch } from './client'
import type { Agent } from '@/types'

/** 取得 agents 列表。若有 userId 則只回傳該 user 有權限的 agents；無則回傳全部 */
export async function getAgents(userId?: number): Promise<Agent[]> {
  const params = userId != null ? `?user_id=${userId}` : ''
  return apiFetch<Agent[]>(`/agents/${params}`)
}

/** 取得單一 agent。若有 userId 則檢查權限，無權限會拋出 403 */
export async function getAgent(id: string, userId?: number): Promise<Agent> {
  const params = userId != null ? `?user_id=${userId}` : ''
  return apiFetch<Agent>(`/agents/${id}${params}`)
}
