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
  created_by: number | null
  doc_count: number
  ready_count: number
  bot_count: number
  created_at: string
  // Widget
  public_token: string | null
  widget_title: string | null
  widget_logo_url: string | null
  widget_color: string | null
  widget_lang: string | null
  widget_voice_enabled: boolean
  widget_voice_prompt: string | null
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
    widget_title?: string
    widget_logo_url?: string
    widget_color?: string
    widget_lang?: string
    widget_voice_enabled?: boolean
    widget_voice_prompt?: string
  }
): Promise<KmKnowledgeBase> {
  return apiFetch<KmKnowledgeBase>(`/km/knowledge-bases/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function generateWidgetToken(id: number): Promise<KmKnowledgeBase> {
  return apiFetch<KmKnowledgeBase>(`/km/knowledge-bases/${id}/generate-token`, {
    method: 'POST',
  })
}

export async function revokeWidgetToken(id: number): Promise<KmKnowledgeBase> {
  return apiFetch<KmKnowledgeBase>(`/km/knowledge-bases/${id}/token`, {
    method: 'DELETE',
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
