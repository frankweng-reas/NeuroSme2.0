import { TOKEN_KEY } from '@/contexts/AuthContext'
import { apiFetch } from './client'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  agent_id?: string // chat.py 必填；chat_dev 不填
  project_id?: string // quotation_parse 時可填，改從 qtn_sources 取參考資料
  prompt_type?: string // chat_agent → system_prompt_chat_agent.md；空或 analysis → system_prompt_analysis.md；quotation_parse → …
  schema_id?: string // dev-test-compute-tool：覆寫專案 schema
  /** 若有值，後端會寫入 chat_llm_requests 並在回應帶回 llm_request_id */
  chat_thread_id?: string
  /** 可選，貫穿觀測／稽核 */
  trace_id?: string
  /** 本輪 user 訊息 id；有圖附件時後端會組多模態送視覺模型 */
  user_message_id?: string
  system_prompt: string
  user_prompt: string
  /** Chat Agent：本頁上傳檔之純文字參考；與後端來源合併，受 CHAT_DATA_MAX_CHARS 限制 */
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
  /** 有傳 chat_thread_id 且寫入觀測成功時為 UUID 字串 */
  llm_request_id?: string | null
}

export async function chatCompletions(req: ChatRequest): Promise<ChatResponse> {
  return apiFetch<ChatResponse>('/chat/completions', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

export interface ChatStreamDone {
  content: string
  model: string
  usage: ChatUsage | null
  finish_reason: string | null
  llm_request_id: string | null
}

const CHAT_STREAM_TIMEOUT_MS = 300_000

/** SSE：`/chat/completions-stream`，事件 event 為 delta | done | error */
export async function chatCompletionsStream(
  req: ChatRequest,
  callbacks: {
    onDelta: (text: string) => void
    onDone: (done: ChatStreamDone) => void | Promise<void>
    onError: (message: string) => void | Promise<void>
  }
): Promise<void> {
  const API_BASE = '/api/v1'
  const token = localStorage.getItem(TOKEN_KEY)
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), CHAT_STREAM_TIMEOUT_MS)

  async function processSseBlock(block: string): Promise<boolean> {
    const line = block.trim()
    if (!line.startsWith('data:')) return false
    const jsonStr = line.slice(5).trim()
    if (!jsonStr) return false
    let data: {
      event?: string
      text?: string
      message?: string
      content?: string
      model?: string
      usage?: ChatUsage | null
      finish_reason?: string | null
      llm_request_id?: string | null
    }
    try {
      data = JSON.parse(jsonStr) as typeof data
    } catch {
      return false
    }
    if (data.event === 'delta' && typeof data.text === 'string') {
      callbacks.onDelta(data.text)
      return false
    }
    if (data.event === 'done') {
      await Promise.resolve(
        callbacks.onDone({
          content: data.content ?? '',
          model: data.model ?? '',
          usage: data.usage ?? null,
          finish_reason: data.finish_reason ?? null,
          llm_request_id: data.llm_request_id ?? null,
        })
      )
      return true
    }
    if (data.event === 'error') {
      const raw =
        typeof data.message === 'string'
          ? data.message.trim()
          : typeof (data as { detail?: unknown }).detail === 'string'
            ? (data as { detail: string }).detail.trim()
            : ''
      const fallback =
        '串流失敗（伺服器未提供說明）。若為台智雲，常見原因：請求逾時、連線中斷、或模型回傳異常，請看後端日誌。'
      await Promise.resolve(callbacks.onError(raw || fallback))
      return true
    }
    return false
  }

  try {
    const res = await fetch(`${API_BASE}/chat/completions-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(req),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const text = await res.text()
        try {
          const body = JSON.parse(text) as { detail?: unknown }
          if (typeof body?.detail === 'string') detail = body.detail
          else if (Array.isArray(body?.detail) && body.detail[0] && typeof (body.detail[0] as { msg?: string }).msg === 'string') {
            detail = (body.detail[0] as { msg: string }).msg
          }
        } catch {
          if (text) detail = text
        }
      } catch {
        /* ignore */
      }
      callbacks.onError(detail)
      return
    }

    const reader = res.body?.getReader()
    if (!reader) {
      callbacks.onError('無法讀取回應串流')
      return
    }

    const decoder = new TextDecoder()
    let buffer = ''
    let finished = false

    while (true) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = done ? '' : (chunks.pop() ?? '')
      for (const block of chunks) {
        if (await processSseBlock(block)) {
          finished = true
          break
        }
      }
      if (finished) break
      if (done) {
        if (buffer.trim()) {
          for (const block of buffer.split('\n\n')) {
            if (await processSseBlock(block)) {
              finished = true
              break
            }
          }
        }
        break
      }
    }

    if (!finished) {
      callbacks.onError('串流未正常結束')
    }
  } catch (e) {
    clearTimeout(timeoutId)
    if (e instanceof DOMException && e.name === 'AbortError') {
      callbacks.onError('請求逾時')
      return
    }
    callbacks.onError(e instanceof Error ? e.message : '串流失敗')
  }
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

/** Test compute_engine：DuckDB 名稱 + intent（不含 rows，由後端讀檔） */
export interface ComputeEngineRequest {
  duckdb_name: string
  intent: Record<string, unknown>
  schema_id?: string
}

export interface ComputeEngineResponse {
  chart_result: Record<string, unknown> | null
  error_detail?: string | null
  /** 後端除錯資訊，含 sql、sql_params、sql_pushdown 等 */
  debug?: Record<string, unknown>
  /** 與 debug.sql 相同 */
  generated_sql?: string | null
}

export async function computeEngine(req: ComputeEngineRequest): Promise<ComputeEngineResponse> {
  return apiFetch<ComputeEngineResponse>('/chat/compute-engine', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}

/** Pipeline Inspector（開發用）：一次跑完 intent / SQL / result，回傳所有中間值 */
export interface PipelineInspectRequest {
  question: string
  project_id: string
  schema_id?: string
  model?: string
  user_prompt?: string
}

export interface PipelineInspectResponse {
  injected_prompt: string
  user_content: string
  intent_raw: string
  intent: Record<string, unknown> | null
  intent_usage: Record<string, number> | null
  sql: string | null
  sql_params: unknown[] | null
  chart_result: Record<string, unknown> | null
  error: string | null
  stage_failed: string | null
}

export async function pipelineInspect(req: PipelineInspectRequest): Promise<PipelineInspectResponse> {
  return apiFetch<PipelineInspectResponse>('/chat/pipeline-inspect', {
    method: 'POST',
    body: JSON.stringify(req),
  })
}
