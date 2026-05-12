/** Bot Widget 公開 API（以 bot public_token 驗證，不需登入） */

const BASE = '/api/v1/widget/bot'

async function botWidgetFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {}
    throw new Error(detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface BotWidgetInfo {
  bot_id: number
  title: string
  logo_url: string | null
  color: string
  lang: string
  is_active: boolean
  voice_enabled: boolean
}

export async function botWidgetTranscribeAudio(
  token: string,
  audioBlob: Blob,
  filename = 'audio.webm',
  language?: string,
): Promise<string> {
  const form = new FormData()
  form.append('file', audioBlob, filename)
  if (language) form.append('language', language)
  const res = await fetch(`${BASE}/${token}/speech`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {}
    throw new Error(detail)
  }
  const data = await res.json()
  return (data.text as string) ?? ''
}

export interface BotWidgetSessionData {
  session_id: string
  visitor_name: string | null
  visitor_email: string | null
  visitor_phone: string | null
  created_at: string
}

export async function getBotWidgetInfo(token: string): Promise<BotWidgetInfo> {
  return botWidgetFetch<BotWidgetInfo>(`/${token}/info`)
}

export function checkBotWidgetSession(token: string, sessionId: string): Promise<{ valid: boolean }> {
  return botWidgetFetch<{ valid: boolean }>(`/${token}/session/${sessionId}`)
}

export async function createBotWidgetSession(
  token: string,
  data: {
    session_id: string
    visitor_name?: string
    visitor_email?: string
    visitor_phone?: string
  }
): Promise<BotWidgetSessionData> {
  return botWidgetFetch<BotWidgetSessionData>(`/${token}/session`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function botWidgetChatStream(
  token: string,
  body: { session_id: string; messages: { role: string; content: string }[]; content: string },
  callbacks: {
    onDelta: (chunk: string) => void
    onDone: (content?: string) => void
    onError: (msg: string) => void
  }
) {
  const res = await fetch(`${BASE}/${token}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const j = await res.json()
      if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {}
    callbacks.onError(detail)
    return
  }
  const reader = res.body?.getReader()
  if (!reader) { callbacks.onError('無法讀取串流'); return }
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (value) buf += decoder.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = done ? '' : (parts.pop() ?? '')
    for (const part of parts) {
      const line = part.trim()
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      try {
        const ev = JSON.parse(raw)
        if (ev.event === 'delta' && ev.text) {
          callbacks.onDelta(ev.text)
          await Promise.resolve()
        } else if (ev.event === 'done') {
          callbacks.onDone(ev.content)
          return
        } else if (ev.event === 'error') {
          callbacks.onError(ev.message ?? '未知錯誤')
          return
        }
      } catch {
        // 非 JSON 略過
      }
    }
    if (done) break
  }
  callbacks.onDone(undefined)
}
