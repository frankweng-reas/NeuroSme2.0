/** AuthContext：管理 LocalAuth 登入狀態與 token */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

export const TOKEN_KEY = 'neurosme_access_token'
export const REFRESH_TOKEN_KEY = 'neurosme_refresh_token'
const USER_KEY = 'neurosme_user'

/** LocalAuth API 位址。開發時用 /auth（Vite proxy）；正式環境可設 VITE_AUTH_API_URL */
const AUTH_BASE = import.meta.env.VITE_AUTH_API_URL?.replace(/\/$/, '') || ''

export interface AuthUser {
  id: string
  email: string
  name?: string
}

interface AuthState {
  user: AuthUser | null
  token: string | null
  loading: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name?: string) => Promise<void>
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    loading: true,
  })

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setState({ user: null, token: null, loading: false })
  }, [])

  const loadStored = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    const userStr = localStorage.getItem(USER_KEY)
    if (!token || !userStr) {
      localStorage.removeItem(REFRESH_TOKEN_KEY)
      setState({ user: null, token: null, loading: false })
      return
    }
    try {
      const user = JSON.parse(userStr) as AuthUser
      setState({ user, token, loading: false })
    } catch {
      logout()
    }
  }, [logout])

  useEffect(() => {
    loadStored()
  }, [loadStored])

  const login = useCallback(async (email: string, password: string) => {
    setState((s) => ({ ...s, loading: true }))
    const url = `${AUTH_BASE}/auth/login`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false }))
      throw new Error(
        '無法連線至認證服務，請確認 LocalAuth 是否已啟動（預設 port 4000）'
      )
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.message || '登入失敗')
    }
    const data = await res.json()
    const token = data.access_token
    const refreshToken = data.refresh_token
    const user: AuthUser = data.user
      ? { id: data.user.id, email: data.user.email, name: data.user.name }
      : { id: '', email, name: '' }
    localStorage.setItem(TOKEN_KEY, token)
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    setState({ user, token, loading: false })
  }, [])

  const register = useCallback(async (email: string, password: string, name?: string) => {
    setState((s) => ({ ...s, loading: true }))
    const url = `${AUTH_BASE}/auth/register`
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name || undefined }),
      })
    } catch (e) {
      setState((s) => ({ ...s, loading: false }))
      throw new Error(
        '無法連線至認證服務，請確認 LocalAuth 是否已啟動（預設 port 4000）'
      )
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message
      throw new Error(msg || '註冊失敗')
    }
    const data = await res.json()
    const token = data.access_token
    const refreshToken = data.refresh_token
    const user: AuthUser = data.user
      ? { id: data.user.id, email: data.user.email, name: data.user.name }
      : { id: '', email, name: name || '' }
    localStorage.setItem(TOKEN_KEY, token)
    if (refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
    setState({ user, token, loading: false })
  }, [])

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    isAuthenticated: !!state.token,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
