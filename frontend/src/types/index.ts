export type UserRole = 'admin' | 'manager' | 'member' | 'super_admin'

export interface User {
  id: number
  email: string
  username: string
  role: UserRole
  tenant_id?: string
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
