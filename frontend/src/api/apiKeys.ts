import { apiFetch } from './client'

export type ApiKeyType = 'bot' | 'voice' | 'general'

export interface ApiKey {
  id: number
  name: string
  label: string | null
  key_prefix: string
  is_active: boolean
  bot_id: number | null
  key_type: ApiKeyType
  created_at: string
  last_used_at: string | null
}

export interface ApiKeyCreateResponse extends ApiKey {
  plain_key: string
}

export interface DailyUsage {
  date: string
  request_count: number
  input_tokens: number
  output_tokens: number
  audio_seconds: number
}

export interface ApiKeyUsageResponse {
  api_key_id: number
  days: DailyUsage[]
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
  total_audio_seconds: number
}

export async function createApiKey(
  name: string,
  botId?: number,
  keyType: ApiKeyType = 'bot',
  label?: string,
): Promise<ApiKeyCreateResponse> {
  return apiFetch<ApiKeyCreateResponse>('/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name, bot_id: botId ?? null, key_type: keyType, label: label ?? null }),
  })
}

export async function listApiKeys(botId?: number, keyType?: ApiKeyType): Promise<ApiKey[]> {
  const params = new URLSearchParams()
  if (botId != null) params.set('bot_id', String(botId))
  if (keyType != null) params.set('key_type', keyType)
  const qs = params.toString() ? `?${params.toString()}` : ''
  return apiFetch<ApiKey[]>(`/api-keys${qs}`)
}

export async function revokeApiKey(id: number): Promise<void> {
  return apiFetch<void>(`/api-keys/${id}`, { method: 'DELETE' })
}

export async function getApiKeyUsage(id: number): Promise<ApiKeyUsageResponse> {
  return apiFetch<ApiKeyUsageResponse>(`/api-keys/${id}/usage`)
}
