import { apiFetch } from './client'
import type { User } from '@/types'

export async function getUserByEmail(email: string): Promise<User> {
  return apiFetch<User>(`/users/by-email?email=${encodeURIComponent(email)}`)
}
