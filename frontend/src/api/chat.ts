import { TOKEN_KEY } from '@/contexts/AuthContext'
import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  agent_id?: string // chat.py 必填；chat_dev 不填
  project_id?: string // quotation_parse 時可填，改從 qtn_sources 取參考資料
  prompt_type?: string // 空或 analysis → system_prompt_analysis.md；quotation_parse → system_prompt_quotation_1_parse.md
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

/** 測試用：compute flow（意圖萃取 + 後端計算 + 文字生成） */
export interface ChatResponseCompute {
  content: string
  model: string
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
  chart_data?: {
    labels: string[]
    data?: number[]
    datasets?: { label: string; data: number[] }[]
    chartType: 'pie' | 'bar' | 'line'
    valueSuffix?: string
    title?: string
  }
  debug?: Record<string, unknown>
}

/** Tool Calling 路徑：意圖萃取 → Backend 計算 → 文字生成 */
export async function chatCompletionsComputeTool(req: ChatRequest): Promise<ChatResponseCompute> {
  return apiFetch<ChatResponseCompute>('/chat/completions-compute-tool', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** dev-test-compute-tool 兩步驟：僅意圖萃取 */
export interface ExtractIntentResponse {
  intent: Record<string, unknown> | null
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null
  model: string
  error_message?: string | null
  system_prompt?: string  // 組合好的 system prompt（含 schema/indicator 注入）
}

export async function extractIntentOnly(req: ChatRequest): Promise<ExtractIntentResponse> {
  return apiFetch<ExtractIntentResponse>('/chat/extract-intent-only', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** dev-test-compute-tool 兩步驟：依 intent 執行計算 + 文字生成 */
export interface ComputeFromIntentRequest {
  agent_id?: string
  project_id: string
  content: string
  intent: Record<string, unknown>
  model?: string
}

export async function computeFromIntent(req: ComputeFromIntentRequest): Promise<ChatResponseCompute> {
  return apiFetch<ChatResponseCompute>('/chat/compute-from-intent', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** SSE 串流階段 */
export type ComputeStage = 'intent' | 'compute' | 'text'

/** SSE 串流版：每個階段 emit 進度，onStage 回傳目前階段 */
export async function chatCompletionsComputeToolStream(
  req: ChatRequest,
  onStage: (stage: ComputeStage) => void
): Promise<ChatResponseCompute> {
  const API_BASE = '/api/v1'
  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  const res = await fetch(`${API_BASE}/chat/completions-compute-tool-stream`, {
    method: 'POST',
    headers,
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail: string | undefined
    try {
      const text = await res.text()
      try {
        const body = JSON.parse(text)
        if (typeof body?.detail === 'string') detail = body.detail
        else if (Array.isArray(body?.detail) && body.detail[0]?.msg) detail = body.detail[0].msg
      } catch {
        detail = text || undefined
      }
    } catch {
      /* ignore */
    }
    throw new Error(detail || `API Error: ${res.status}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('無法讀取串流')
  const decoder = new TextDecoder()
  let buffer = ''
  let result: ChatResponseCompute | null = null
  function processBlock(block: string): void {
    const match = block.match(/^data:\s*(.+)$/m)
    if (!match) return
    try {
      const data = JSON.parse(match[1]) as { stage: string; content?: string; chart_data?: unknown; model?: string; usage?: Record<string, number> }
      if (data.stage === 'intent') onStage('intent')
      else if (data.stage === 'compute') onStage('compute')
      else if (data.stage === 'text') onStage('text')
      else if (data.stage === 'done') {
        result = {
          content: data.content ?? '',
          model: data.model ?? '',
          usage: data.usage ?? undefined,
          chart_data: data.chart_data as ChatResponseCompute['chart_data'],
        }
      }
    } catch {
      /* ignore parse error */
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = done ? '' : (parts.pop() ?? '')
    for (const block of parts) {
      processBlock(block)
    }
    if (done) {
      if (buffer.trim()) processBlock(buffer)
      break
    }
  }
  if (!result) throw new Error('串流未回傳完成事件')
  return result
}

/** dev-test-intent-to-data：僅需 project_id，從 DuckDB 載入資料 */
export interface IntentToComputeByProjectRequest {
  project_id: string
  intent: Record<string, unknown>
}

export interface IntentToComputeResponse {
  chart_result: Record<string, unknown> | null
  error_detail?: string | null
}

export async function intentToComputeByProject(
  req: IntentToComputeByProjectRequest
): Promise<IntentToComputeResponse> {
  return apiFetch<IntentToComputeResponse>('/chat/intent-to-compute-by-project', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** 傳入 intent + rows，無需 project（手動貼資料測試用） */
export interface IntentToComputeRawRequest {
  intent: Record<string, unknown>
  rows: Record<string, unknown>[]
}

export async function intentToComputeRaw(req: IntentToComputeRawRequest): Promise<IntentToComputeResponse> {
  return apiFetch<IntentToComputeResponse>('/chat/intent-to-compute-raw', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
