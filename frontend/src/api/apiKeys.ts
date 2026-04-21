import { apiFetch } from './client'

export interface ApiKey {
  id: number
  name: string
  key_prefix: string
  is_active: boolean
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
}

export interface ApiKeyUsageResponse {
  api_key_id: number
  days: DailyUsage[]
  total_requests: number
  total_input_tokens: number
  total_output_tokens: number
}

export async function createApiKey(name: string): Promise<ApiKeyCreateResponse> {
  return apiFetch<ApiKeyCreateResponse>('/api-keys', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return apiFetch<ApiKey[]>('/api-keys')
}

export async function revokeApiKey(id: number): Promise<void> {
  return apiFetch<void>(`/api-keys/${id}`, { method: 'DELETE' })
}

export async function getApiKeyUsage(id: number): Promise<ApiKeyUsageResponse> {
  return apiFetch<ApiKeyUsageResponse>(`/api-keys/${id}/usage`)
}
