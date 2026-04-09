import { TOKEN_KEY } from '@/contexts/AuthContext'
import { ApiError, apiFetch } from './client'

const API_BASE = '/api/v1'

export interface ChatThreadItem {
  id: string
  tenant_id: string
  agent_id: string
  title: string | null
  status: string
  last_message_at: string | null
  created_at: string
  updated_at: string
}

export interface ChatMessageAttachmentMeta {
  file_id: string
  original_filename: string
  size_bytes: number
  content_type?: string | null
}

export interface ChatMessageItem {
  id: string
  thread_id: string
  sequence: number
  role: string
  content: string
  llm_request_id: string | null
  created_at: string
  attachments?: ChatMessageAttachmentMeta[]
  /** 非 null：該則 user 錨定附件集合；null：沿用上一錨點 */
  context_file_ids?: string[] | null
}

export interface ThreadFileItem {
  file_id: string
  original_filename: string
  size_bytes: number
  content_type?: string | null
}

export async function listChatThreads(agentId: string): Promise<ChatThreadItem[]> {
  return apiFetch<ChatThreadItem[]>(`/chat/threads?agent_id=${encodeURIComponent(agentId)}`)
}

export async function createChatThread(body: { agent_id: string; title?: string | null }): Promise<ChatThreadItem> {
  return apiFetch<ChatThreadItem>('/chat/threads', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function deleteChatThread(threadId: string): Promise<void> {
  await apiFetch<void>(`/chat/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' })
}

export async function patchChatThread(
  threadId: string,
  body: { title?: string | null; status?: string | null }
): Promise<ChatThreadItem> {
  return apiFetch<ChatThreadItem>(`/chat/threads/${encodeURIComponent(threadId)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

export async function listChatMessages(threadId: string): Promise<ChatMessageItem[]> {
  return apiFetch<ChatMessageItem[]>(`/chat/threads/${encodeURIComponent(threadId)}/messages`)
}

export async function listThreadFiles(threadId: string): Promise<ThreadFileItem[]> {
  return apiFetch<ThreadFileItem[]>(`/chat/threads/${encodeURIComponent(threadId)}/files`)
}

/** 取得本對話附件二進位（須 Bearer；供圖片顯示等） */
export async function fetchChatThreadFileBlob(threadId: string, fileId: string): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(
    `${API_BASE}/chat/threads/${encodeURIComponent(threadId)}/files/${encodeURIComponent(fileId)}/content`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  )
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      /* ignore */
    }
    throw new ApiError(detail || '無法載入附件', res.status, detail)
  }
  return res.blob()
}

export async function appendChatMessage(
  threadId: string,
  body: {
    role: string
    content: string
    llm_request_id?: string | null
    context_file_ids?: string[] | null
  }
): Promise<ChatMessageItem> {
  return apiFetch<ChatMessageItem>(`/chat/threads/${encodeURIComponent(threadId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function patchChatMessage(
  threadId: string,
  messageId: string,
  body: { context_file_ids?: string[] | null }
): Promise<ChatMessageItem> {
  return apiFetch<ChatMessageItem>(
    `/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'PATCH', body: JSON.stringify(body) }
  )
}

export async function deleteChatMessage(threadId: string, messageId: string): Promise<void> {
  await apiFetch<void>(
    `/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' }
  )
}

export type ChatAttachmentUploadPart =
  | { name: string; content: string }
  | { name: string; blob: Blob }

/** 須先建立 user 訊息并取得 message_id，再附加檔案（與該則訊息一併送出流程搭配） */
export async function uploadChatMessageAttachments(
  threadId: string,
  messageId: string,
  items: ChatAttachmentUploadPart[]
): Promise<{ uploaded: number }> {
  if (items.length === 0) return { uploaded: 0 }
  const fd = new FormData()
  for (const it of items) {
    if ('blob' in it) {
      fd.append('files', it.blob, it.name)
    } else {
      const blob = new Blob([it.content], { type: 'text/plain;charset=utf-8' })
      fd.append('files', blob, it.name)
    }
  }
  return apiFetch<{ uploaded: number }>(
    `/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/attachments`,
    { method: 'POST', body: fd }
  )
}

export async function getChatMessageAttachmentReferenceText(
  threadId: string,
  messageId: string
): Promise<string> {
  const r = await apiFetch<{ text: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/attachment-reference-text`
  )
  return r.text ?? ''
}

/** 依附件窗口規則（錨點 + 最多 N 次 user 發言，N 與後端 ATTACHMENT_CONTEXT_USER_ROUNDS 對齊）回傳應注入 LLM 之參考全文 */
export async function getLlmAttachmentReferenceText(
  threadId: string,
  messageId: string
): Promise<string> {
  const r = await apiFetch<{ text: string }>(
    `/chat/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(messageId)}/llm-attachment-reference-text`
  )
  return r.text ?? ''
}
