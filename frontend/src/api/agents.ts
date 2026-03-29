import { apiFetch } from './client'
import type { Agent } from '@/types'

/** 取得當前使用者有權限的 agents 列表（需登入） */
export async function getAgents(isPurchasedOnly?: boolean, tenantId?: string): Promise<Agent[]> {
  const params = new URLSearchParams()
  if (isPurchasedOnly) params.set('is_purchased', 'true')
  if (tenantId) params.set('target_tenant_id', tenantId)
  const qs = params.toString()
  return apiFetch<Agent[]>(`/agents/${qs ? `?${qs}` : ''}`)
}

/** 取得單一 agent（需有權限） */
export async function getAgent(id: string): Promise<Agent> {
  return apiFetch<Agent>(`/agents/${encodeURIComponent(id)}`)
}
