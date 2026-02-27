export interface User {
  id: number
  email: string
  username: string
}

export interface Agent {
  id: number
  group_id: string
  group_name: string
  agent_id: string
  agent_name: string
  icon_name?: string | null
}
