import { apiFetch } from './client'
import type { Tenant } from '@/types'

/** 取得所有 tenants（需 super_admin） */
export async function listTenants(): Promise<Tenant[]> {
  return apiFetch<Tenant[]>('/tenants/')
}

/** 新增 tenant */
export async function createTenant(id: string, name: string): Promise<Tenant> {
  return apiFetch<Tenant>('/tenants/', {
    method: 'POST',
    body: JSON.stringify({ id, name }),
  })
}

/** 更新 tenant */
export async function updateTenant(id: string, name: string): Promise<Tenant> {
  return apiFetch<Tenant>(`/tenants/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  })
}

/** 刪除 tenant */
export async function deleteTenant(id: string): Promise<void> {
  return apiFetch(`/tenants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/** 取得 tenant 可使用的 agent_id 清單 */
export async function getTenantAgentIds(tenantId: string): Promise<string[]> {
  const res = await apiFetch<{ agent_ids: string[] }>(`/tenants/${encodeURIComponent(tenantId)}/agents`)
  return res.agent_ids
}

/** 更新 tenant 可使用的 agent 清單 */
export async function updateTenantAgents(tenantId: string, agentIds: string[]): Promise<void> {
  await apiFetch(`/tenants/${encodeURIComponent(tenantId)}/agents`, {
    method: 'PUT',
    body: JSON.stringify({ agent_ids: agentIds }),
  })
}
