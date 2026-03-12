import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/contexts/AuthContext'

const API_BASE = '/api/v1'
const AUTH_BASE = import.meta.env.VITE_AUTH_API_URL?.replace(/\/$/, '') || ''

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

let refreshPromise: Promise<string | null> | null = null

async function tryRefreshToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY)
    if (!refreshToken) return null
    try {
      const res = await fetch(`${AUTH_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (!res.ok) return null
      const data = await res.json()
      localStorage.setItem(TOKEN_KEY, data.access_token)
      if (data.refresh_token) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
      }
      return data.access_token
    } catch {
      return null
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

function clearAuthAndRedirect(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_TOKEN_KEY)
  localStorage.removeItem('neurosme_user')
  const returnPath = window.location.pathname + window.location.search
  if (returnPath && returnPath !== '/login' && returnPath !== '/register') {
    sessionStorage.setItem('login_return_url', returnPath)
  }
  window.location.href = '/login?expired=1'
}

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

  let response = await fetch(`${API_BASE}${endpoint}`, {
    ...rest,
    headers,
    signal: controller.signal,
  })
  clearTimeout(id)

  if (response.status === 401) {
    const newToken = await tryRefreshToken()
    if (newToken) {
      const retryHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${newToken}`,
        ...(rest.headers as Record<string, string>),
      }
      const retryController = new AbortController()
      const retryId = setTimeout(() => retryController.abort(), timeout)
      response = await fetch(`${API_BASE}${endpoint}`, {
        ...rest,
        headers: retryHeaders,
        signal: retryController.signal,
      })
      clearTimeout(retryId)
    }
    if (response.status === 401) {
      clearAuthAndRedirect()
      throw new ApiError('未授權，請重新登入', 401)
    }
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
