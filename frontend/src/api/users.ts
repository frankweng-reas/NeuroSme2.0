import { apiFetch } from './client'
import type { User } from '@/types'

/** 取得當前登入使用者（從 JWT） */
export async function getMe(): Promise<User> {
  return apiFetch<User>('/users/me')
}

export async function getUserByEmail(email: string): Promise<User> {
  return apiFetch<User>(`/users/by-email?email=${encodeURIComponent(email)}`)
}

export async function listUsers(): Promise<User[]> {
  return apiFetch<User[]>('/users/')
}

export interface CreateUserPayload {
  email: string
  username: string
  password: string
  role?: 'admin' | 'manager' | 'member'
  must_change_password?: boolean
}

export async function createUser(payload: CreateUserPayload): Promise<User> {
  return apiFetch<User>('/users/', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function deleteUser(userId: number): Promise<void> {
  await apiFetch(`/users/${userId}`, { method: 'DELETE' })
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

export async function updateUserRole(userId: number, role: 'admin' | 'manager' | 'member'): Promise<void> {
  await apiFetch(`/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

export async function updateUser(
  userId: number,
  payload: { username?: string; role?: 'admin' | 'manager' | 'member' },
): Promise<User> {
  return apiFetch<User>(`/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

export interface UpdateProfilePayload {
  display_name?: string | null
  avatar_b64?: string | null
}

export async function updateMyProfile(payload: UpdateProfilePayload): Promise<User> {
  return apiFetch<User>('/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/** 取得該 user 的模型權限清單（null = 繼承租戶全部模型） */
export async function getUserModelPermissions(userId: number): Promise<string[] | null> {
  const res = await apiFetch<{ user_id: number; allowed_models: string[] | null }>(
    `/users/${userId}/model-permissions`
  )
  return res.allowed_models
}

/** 更新該 user 的模型權限清單（null = 繼承租戶全部模型） */
export async function updateUserModelPermissions(
  userId: number,
  allowedModels: string[] | null,
): Promise<void> {
  await apiFetch(`/users/${userId}/model-permissions`, {
    method: 'PUT',
    body: JSON.stringify({ allowed_models: allowedModels }),
  })
}
