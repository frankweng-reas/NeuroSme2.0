export type UserRole = 'admin' | 'manager' | 'member' | 'super_admin'

export interface User {
  id: number
  email: string
  username: string
  role: UserRole
  tenant_id?: string
  display_name?: string | null
  avatar_b64?: string | null
}

export interface Tenant {
  id: string
  name: string
}

export interface AgentCatalog {
  id: string
  sort_id?: string | null
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name?: string | null
}

export interface Agent {
  id: string
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name?: string | null
  is_purchased?: boolean
  tenant_id?: string
}

export interface Company {
  id: string
  legal_name?: string | null
  tax_id?: string | null
  logo_url?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  contact?: string | null
  sort_order?: string | null
  quotation_terms?: string | null
}

export interface LLMModelEntry {
  model: string
  note?: string | null
}

export interface LLMProviderConfig {
  id: number
  tenant_id: string
  provider: string
  label: string | null
  api_key_masked: string | null
  api_base_url: string | null
  available_models: LLMModelEntry[] | null
  is_active: boolean
  created_at: string
  updated_at: string
}
