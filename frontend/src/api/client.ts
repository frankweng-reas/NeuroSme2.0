const API_BASE = '/api/v1'

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

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(rest.headers as Record<string, string>),
    },
    signal: controller.signal,
  })
  clearTimeout(id)

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
