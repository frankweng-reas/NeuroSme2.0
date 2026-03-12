import { apiFetch } from './client'

export interface ScheduleAssignment {
  staff_id: string
  staff_name: string
  day: number
  shift_id: string
  shift_name: string
}

export interface ScheduleSolveRequest {
  agent_id: string
  content?: string
  constraints?: Record<string, unknown>
  model?: string
}

export interface ScheduleSolveResponse {
  status: string
  assignments: ScheduleAssignment[]
  summary?: string
  error?: string
}

export async function solveSchedule(req: ScheduleSolveRequest): Promise<ScheduleSolveResponse> {
  return apiFetch<ScheduleSolveResponse>('/scheduling/solve', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: req.agent_id,
      content: req.content ?? '',
      constraints: req.constraints,
      model: req.model ?? 'gpt-4o-mini',
    }),
    timeout: 90000,
  })
}
