import { apiFetch } from './client'
import type { User } from '@/types'

export async function getUserByEmail(email: string): Promise<User> {
  return apiFetch<User>(`/users/by-email?email=${encodeURIComponent(email)}`)
}

export async function listUsers(): Promise<User[]> {
  return apiFetch<User[]>('/users/')
}

export async function getUserAgentIds(userId: number): Promise<string[]> {
  const res = await apiFetch<{ agent_ids: string[] }>(`/users/${userId}/agents`)
  return res.agent_ids
}

export async function updateUserAgents(userId: number, agentIds: string[]): Promise<void> {
  await apiFetch(`/users/${userId}/agents`, {
    method: 'PUT',
    body: JSON.stringify({ agent_ids: agentIds }),
  })
}

export async function updateUserRole(userId: number, role: 'admin' | 'member'): Promise<void> {
  await apiFetch(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}
