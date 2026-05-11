import { ApiError } from './client'
import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'

// ── KB 相關型別 ──────────────────────────────────────────────────────────────

export interface KBOption {
  id: number
  name: string
  scope: string
}

export interface ImportToKBRequest {
  title: string
  items: QAItem[]
  kb_id?: number
  new_kb_name?: string
}

export interface ImportToKBResponse {
  kb_id: number
  kb_name: string
  doc_id: number
  imported_count: number
}

export interface QAItem {
  id: number
  question: string
  answer: string
}

export interface TokenUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

// SSE event types from /process endpoint
export type StreamEvent =
  | { type: 'meta'; page_count: number; char_count: number; chunk_total: number }
  | { type: 'items'; chunk: number; chunk_total: number; items: QAItem[] }
  | { type: 'done'; usage: TokenUsage; model: string }
  | { type: 'error'; detail: string }
  | { type: 'chunk_error'; chunk: number; detail: string }

export async function* processDocumentStream(
  file: File,
  model?: string,
  signal?: AbortSignal,
  sourceType: 'doc' | 'note' | 'sop' = 'doc',
): AsyncGenerator<StreamEvent> {
  const token = localStorage.getItem(TOKEN_KEY) ?? ''
  const fd = new FormData()
  fd.append('file', file)
  if (model) fd.append('model', model)
  fd.append('source_type', sourceType)

  const res = await fetch(`${API_BASE}/doc-refiner/process`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
    signal,
  })

  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    yield { type: 'error', detail }
    return
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // SSE blocks are separated by \n\n
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() ?? ''
    for (const block of blocks) {
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
      if (!dataLine) continue
      try {
        yield JSON.parse(dataLine.slice(6)) as StreamEvent
      } catch { /* skip malformed */ }
    }
  }
}

export interface ExportRequest {
  title: string
  items: QAItem[]
}

export async function listKBs(): Promise<KBOption[]> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/km/knowledge-bases`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new ApiError('取得知識庫列表失敗', res.status, '')
  const data = (await res.json()) as { id: number; name: string; scope: string }[]
  return data.map((kb) => ({ id: kb.id, name: kb.name, scope: kb.scope }))
}

export async function importToKB(req: ImportToKBRequest): Promise<ImportToKBResponse> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/doc-refiner/import-to-kb`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    throw new ApiError(detail || '匯入失敗', res.status, detail)
  }
  return res.json() as Promise<ImportToKBResponse>
}

export async function exportTxt(req: ExportRequest): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/doc-refiner/export-txt`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    throw new ApiError(detail || '匯出失敗', res.status, detail)
  }
  return res.blob()
}

export interface RewriteItemRequest {
  question: string
  answer: string
  instruction: string
  model?: string
}

export interface RewriteItemResponse {
  question: string
  answer: string
}

export async function rewriteQAItem(req: RewriteItemRequest): Promise<RewriteItemResponse> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/doc-refiner/rewrite-item`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    throw new ApiError(detail || '改寫失敗', res.status, detail)
  }
  return res.json() as Promise<RewriteItemResponse>
}

export async function exportDocument(req: ExportRequest): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(`${API_BASE}/doc-refiner/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch { /* ignore */ }
    throw new ApiError(detail || '匯出失敗', res.status, detail)
  }
  return res.blob()
}
