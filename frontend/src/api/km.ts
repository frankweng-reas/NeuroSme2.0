import { apiFetch } from './client'
import { TOKEN_KEY } from '@/contexts/AuthContext'

export interface KmDocument {
  id: number
  filename: string
  content_type: string | null
  size_bytes: number | null
  scope: 'private' | 'public'
  status: 'pending' | 'processing' | 'ready' | 'error'
  error_message: string | null
  chunk_count: number | null
  tags: string[]
  knowledge_base_id: number | null
  doc_type: string
  created_at: string
}

export type KbScope = 'personal' | 'company'

export interface KmKnowledgeBase {
  id: number
  name: string
  description: string | null
  model_name: string | null
  system_prompt: string | null
  scope: KbScope
  answer_mode: 'rag' | 'direct'
  created_by: number | null
  doc_count: number
  ready_count: number
  bot_count: number
  created_at: string
}

export async function listKnowledgeBases(): Promise<KmKnowledgeBase[]> {
  return apiFetch<KmKnowledgeBase[]>('/km/knowledge-bases')
}

export interface KmKnowledgeBaseAdmin extends KmKnowledgeBase {
  created_by_name: string | null
}

export async function adminListKnowledgeBases(): Promise<KmKnowledgeBaseAdmin[]> {
  return apiFetch<KmKnowledgeBaseAdmin[]>('/km/admin/knowledge-bases')
}

export async function createKnowledgeBase(data: {
  name: string
  description?: string
  model_name?: string
  system_prompt?: string
  answer_mode?: 'rag' | 'direct'
  scope?: KbScope
}): Promise<KmKnowledgeBase> {
  return apiFetch<KmKnowledgeBase>('/km/knowledge-bases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function updateKnowledgeBase(
  id: number,
  data: {
    name?: string
    description?: string
    model_name?: string
    system_prompt?: string
    scope?: KbScope
    answer_mode?: 'rag' | 'direct'
  }
): Promise<KmKnowledgeBase> {
  return apiFetch<KmKnowledgeBase>(`/km/knowledge-bases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}


export async function deleteKnowledgeBase(id: number): Promise<void> {
  return apiFetch<void>(`/km/knowledge-bases/${id}`, { method: 'DELETE' })
}

export async function listKmDocuments(scope?: 'private' | 'public', noKb?: boolean): Promise<KmDocument[]> {
  const params = new URLSearchParams()
  if (scope) params.set('scope', scope)
  if (noKb) params.set('no_kb', 'true')
  const qs = params.toString()
  return apiFetch<KmDocument[]>(`/km/documents${qs ? `?${qs}` : ''}`)
}

export async function listKbDocuments(kbId: number): Promise<KmDocument[]> {
  return apiFetch<KmDocument[]>(`/km/documents?knowledge_base_id=${kbId}`)
}

export async function deleteKmDocument(docId: number): Promise<void> {
  return apiFetch<void>(`/km/documents/${docId}`, { method: 'DELETE' })
}

export async function uploadKmDocument(
  file: File,
  scope: 'private' | 'public',
  onProgress?: (percent: number) => void,
  tags?: string[],
  knowledgeBaseId?: number,
  docType?: string,
): Promise<KmDocument> {
  const form = new FormData()
  form.append('file', file)
  form.append('scope', scope)
  if (tags && tags.length > 0) {
    form.append('tags', JSON.stringify(tags))
  }
  if (knowledgeBaseId != null) {
    form.append('knowledge_base_id', String(knowledgeBaseId))
  }
  if (docType) {
    form.append('doc_type', docType)
  }

  // 使用 XMLHttpRequest 支援進度回報
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const token = localStorage.getItem(TOKEN_KEY)

    xhr.open('POST', '/api/v1/km/documents')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as KmDocument)
        } catch {
          reject(new Error('回應解析失敗'))
        }
      } else {
        let detail = `HTTP ${xhr.status}`
        try {
          const body = JSON.parse(xhr.responseText) as { detail?: string }
          if (typeof body?.detail === 'string') detail = body.detail
        } catch {
          /* ignore */
        }
        reject(new Error(detail))
      }
    }
    xhr.onerror = () => reject(new Error('網路錯誤'))
    xhr.send(form)
  })
}

// ── 查詢統計 ──────────────────────────────────────────────────────────────────

export interface QueryStatsSummary {
  total_queries: number
  hit_count: number
  zero_hit_count: number
  hit_rate: number  // 0.0 ~ 1.0
}

export interface QueryItem {
  query: string
  count: number
  hit: boolean
  last_asked_at: string
}

export interface QueryStatsResponse {
  summary: QueryStatsSummary
  queries: QueryItem[]
  total: number
  has_more: boolean
}

export type QueryStatsView = 'top_queries' | 'zero_hit'

export async function getKbQueryStats(
  kbId: number,
  options: {
    days?: number
    view?: QueryStatsView
    limit?: number
    offset?: number
  } = {},
): Promise<QueryStatsResponse> {
  const { days = 30, view = 'top_queries', limit = 20, offset = 0 } = options
  const params = new URLSearchParams({
    days: String(days),
    view,
    limit: String(limit),
    offset: String(offset),
  })
  return apiFetch<QueryStatsResponse>(`/km/knowledge-bases/${kbId}/query-stats?${params}`)
}
