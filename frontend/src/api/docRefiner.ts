import { ApiError, apiFetch } from './client'
import { TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'

export interface QAItem {
  id: number
  question: string
  answer: string
}

export interface SummaryItem {
  id: number
  heading: string
  content: string
}

export type RefinerMode = 'qa' | 'summary'
export type RefinerItem = QAItem | SummaryItem

export interface ProcessResponse {
  mode: RefinerMode
  title: string
  items: RefinerItem[]
  page_count: number
  char_count: number
}

export async function processDocument(
  file: File,
  mode: RefinerMode,
  model?: string,
): Promise<ProcessResponse> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mode', mode)
  if (model) fd.append('model', model)
  return apiFetch<ProcessResponse>('/doc-refiner/process', {
    method: 'POST',
    body: fd,
    timeout: 300_000,
  })
}

export interface ExportRequest {
  mode: RefinerMode
  title: string
  items: RefinerItem[]
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
