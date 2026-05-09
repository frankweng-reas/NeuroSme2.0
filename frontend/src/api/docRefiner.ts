import { apiFetch } from './client'

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

export function exportDocUrl(): string {
  return '/api/v1/doc-refiner/export'
}
