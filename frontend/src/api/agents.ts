import { apiFetch } from './client'
import type { Agent } from '@/types'

export async function getAgents(): Promise<Agent[]> {
  return apiFetch<Agent[]>('/agents/')
}
