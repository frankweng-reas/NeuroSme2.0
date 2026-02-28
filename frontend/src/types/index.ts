export type UserRole = 'admin' | 'member'

export interface User {
  id: number
  email: string
  username: string
  role: UserRole
}

export interface Agent {
  id: string
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name?: string | null
}
