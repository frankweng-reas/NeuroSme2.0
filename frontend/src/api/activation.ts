import { apiFetch } from './client'

export interface ActivationStatus {
  activated: boolean
  customer_name: string | null
  agent_ids: string[]
  expires_at: string | null
  is_expired: boolean
}

export interface RedeemCodeResponse {
  customer_name: string
  agent_ids: string[]
  expires_at: string | null
}

/** 兌換 Activation Code（admin） */
export async function redeemActivationCode(code: string): Promise<RedeemCodeResponse> {
  return apiFetch<RedeemCodeResponse>('/activate/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/** 取得目前 tenant 的啟用狀態（admin） */
export async function getActivationStatus(): Promise<ActivationStatus> {
  return apiFetch<ActivationStatus>('/activate/status')
}
