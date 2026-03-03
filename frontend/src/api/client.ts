const API_BASE = '/api/v1'

const TOKEN_KEY = 'neurosme_access_token'

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const DEFAULT_TIMEOUT_MS = 90_000

export async function apiFetch<T>(
  endpoint: string,
  options?: RequestInit & { timeout?: number }
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT_MS, ...rest } = options ?? {}
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)

  const token = localStorage.getItem(TOKEN_KEY)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...rest,
    headers,
    signal: controller.signal,
  })
  clearTimeout(id)

  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem('neurosme_user')
    // 儲存當前路徑，登入後可導回
    const returnPath = window.location.pathname + window.location.search
    if (returnPath && returnPath !== '/login' && returnPath !== '/register') {
      sessionStorage.setItem('login_return_url', returnPath)
    }
    window.location.href = '/login?expired=1'
    throw new ApiError('未授權，請重新登入', 401)
  }

  if (response.status === 204) {
    return undefined as T
  }

  if (!response.ok) {
    let detail: string | undefined
    try {
      const text = await response.text()
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
    throw new ApiError(`API Error: ${response.status}`, response.status, detail)
  }

  return response.json()
}
