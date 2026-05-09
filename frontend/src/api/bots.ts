import { apiFetch } from './client'

export interface BotKbItem {
  knowledge_base_id: number
  sort_order: number
}

export interface BotKbResponse {
  knowledge_base_id: number
  name: string
  sort_order: number
}

export interface Bot {
  id: number
  name: string
  description: string | null
  is_active: boolean
  system_prompt: string | null
  model_name: string | null
  public_token: string | null
  widget_title: string | null
  widget_logo_url: string | null
  widget_color: string | null
  widget_lang: string | null
  knowledge_bases: BotKbResponse[]
  created_at: string
}

export async function listBots(): Promise<Bot[]> {
  return apiFetch<Bot[]>('/bots')
}

export async function getBot(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}`)
}

export async function createBot(data: {
  name: string
  description?: string
  system_prompt?: string
  model_name?: string
  knowledge_base_ids?: BotKbItem[]
}): Promise<Bot> {
  return apiFetch<Bot>('/bots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateBot(
  id: number,
  data: {
    name?: string
    description?: string
    is_active?: boolean
    system_prompt?: string
    model_name?: string
    knowledge_base_ids?: BotKbItem[]
    widget_title?: string
    widget_logo_url?: string
    widget_color?: string
    widget_lang?: string
  }
): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteBot(id: number): Promise<void> {
  return apiFetch<void>(`/bots/${id}`, { method: 'DELETE' })
}

export async function generateBotToken(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}/generate-token`, { method: 'POST' })
}

export async function revokeBotToken(id: number): Promise<Bot> {
  return apiFetch<Bot>(`/bots/${id}/token`, { method: 'DELETE' })
}
