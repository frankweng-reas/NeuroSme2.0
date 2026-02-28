import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  system_prompt: string
  user_prompt: string
  data: string
  model: string
  messages: ChatMessage[]
  content: string
}

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatResponse {
  content: string
  model: string
  usage: ChatUsage | null
  finish_reason: string | null
}

export async function chatCompletions(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
