import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  agent_id?: string // chat.py 必填；chat_dev 不填
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

/** dev-test-chat 專用：不讀 md 檔，完全使用 request 的 system_prompt */
export async function chatCompletionsDev(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat/dev/completions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
