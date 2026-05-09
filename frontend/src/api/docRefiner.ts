import { apiFetch } from './client'
import { TOKEN_KEY } from '@/contexts/AuthContext'

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
  const token = localStorage.getItem(TOKEN_KEY) || ''
  const res = await fetch('/api/v1/doc-refiner/export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { detail?: string }).detail || `匯出失敗（${res.status}）`)
  }
  return res.blob()
}
