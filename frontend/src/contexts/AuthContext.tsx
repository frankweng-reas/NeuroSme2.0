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

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    /* 無痕 / iframe / 禁用儲存時可能拋錯，勿讓 bootstrap 崩潰 */
    return null
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* quota / denied */
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

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
  changePassword: (old_password: string, new_password: string) => Promise<void>
  changePasswordExpired: (email: string, old_password: string, new_password: string) => Promise<void>
  forgotPassword: (email: string) => Promise<void>
  resetPassword: (token: string, new_password: string) => Promise<void>
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
    lsRemove(TOKEN_KEY)
    lsRemove(REFRESH_TOKEN_KEY)
    lsRemove(USER_KEY)
    setState({ user: null, token: null, loading: false })
  }, [])

  const loadStored = useCallback(async () => {
    const token = lsGet(TOKEN_KEY)
    const userStr = lsGet(USER_KEY)
    if (!token || !userStr) {
      lsRemove(REFRESH_TOKEN_KEY)
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
    lsSet(TOKEN_KEY, token)
    if (refreshToken) lsSet(REFRESH_TOKEN_KEY, refreshToken)
    lsSet(USER_KEY, JSON.stringify(user))
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
    // 註冊成功後不自動登入：需先完成 email 確認，再透過登入頁登入
    setState((s) => ({ ...s, loading: false }))
  }, [])

  const changePassword = useCallback(async (old_password: string, new_password: string) => {
    const token = lsGet(TOKEN_KEY)
    if (!token) throw new Error('請先登入')
    const url = `${AUTH_BASE}/auth/password`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ old_password, new_password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message
      throw new Error(msg || '修改密碼失敗')
    }
  }, [])

  const changePasswordExpired = useCallback(
    async (email: string, old_password: string, new_password: string) => {
      const url = `${AUTH_BASE}/auth/change-password-expired`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, old_password, new_password }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message
        throw new Error(msg || '修改密碼失敗')
      }
    },
    []
  )

  const forgotPassword = useCallback(async (email: string) => {
    const url = `${AUTH_BASE}/auth/forgot-password`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message
      throw new Error(msg || '寄送失敗')
    }
  }, [])

  const resetPassword = useCallback(async (token: string, new_password: string) => {
    const url = `${AUTH_BASE}/auth/reset-password`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, new_password }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      const msg = Array.isArray(err.message) ? err.message.join(', ') : err.message
      throw new Error(msg || '重設密碼失敗')
    }
  }, [])

  const value: AuthContextValue = {
    ...state,
    login,
    register,
    logout,
    changePassword,
    changePasswordExpired,
    forgotPassword,
    resetPassword,
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
  return lsGet(TOKEN_KEY)
}
