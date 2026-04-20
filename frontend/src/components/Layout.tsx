/** 共用版面：Header（含 NeuroSme 品牌、用戶區）+ Outlet；agent、admin 頁面隱藏 Header */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getMe } from '@/api/users'
import { useAuth } from '@/contexts/AuthContext'
import type { User } from '@/types'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  /** 網址列為 //path 時子路由對不到，Outlet 空白；導回單一前導 slash。 */
  useLayoutEffect(() => {
    const p = location.pathname
    if (p.length > 1 && p.startsWith('//')) {
      navigate(p.replace(/^\/+/, '/') || '/', { replace: true })
    }
  }, [location.pathname, navigate])
  const { user: authUser, logout } = useAuth()
  const hideHeader =
    location.pathname.startsWith('/agent/') ||
    location.pathname.startsWith('/admin') ||
    location.pathname === '/dev-test-chat' ||
    location.pathname === '/dev-test-compute-tool' ||
    location.pathname === '/dev-test-compute-engine' ||
    location.pathname === '/dev-pipeline-inspector'
  const [user, setUser] = useState<User | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authUser) return
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
  }, [authUser])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  const emailInitial = ((authUser?.email ?? user?.email ?? '') || 'U')[0].toUpperCase()

  return (
    <div
      className="flex h-screen flex-col"
      style={{
        backgroundImage: `linear-gradient(160deg, #cdd5d9 0%, #d8e0e3 100%)`,
      }}
    >
      {/* Header - 在 agent 頁面隱藏 */}
      {!hideHeader && (
      <header className="flex-shrink-0 px-2 pt-3 pb-2">
        <div
          className="rounded-3xl border-b border-black/10 shadow-sm"
          style={{ backgroundColor: '#18333D' }}
        >
        <div className="container mx-auto px-4">
          <div className="flex h-20 items-center justify-between">
            {/* 應用名稱 - 點擊回到首頁 */}
            <Link to="/" className="flex items-center hover:opacity-90">
              <h1
                className="text-2xl font-bold text-white"
                style={{
                  letterSpacing: '-0.5px',
                  fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                  fontStyle: 'italic',
                }}
              >
                <span style={{ fontWeight: 700 }}>Neuro</span>
                <span style={{ fontWeight: 700 }}>Sme</span>
                <span style={{ fontWeight: 300, fontStyle: 'normal', fontSize: '0.8em', opacity: 0.7 }}>{' \u00a0| On-Premise'}</span>
                <span style={{ fontWeight: 300, fontStyle: 'normal', fontSize: '0.65em', opacity: 0.5, marginLeft: '0.6em', letterSpacing: '0.02em' }}>
                  {import.meta.env.VITE_APP_VERSION ?? 'dev'}
                </span>
              </h1>
            </Link>

            {/* 右側：管理工具、用戶資訊 */}
            <div className="flex items-center gap-3">
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className="rounded-full border border-white/30 bg-white/10 px-5 py-2 text-base font-medium text-white transition-colors hover:bg-white/20"
                  style={{
                    fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                  }}
                >
                  管理工具
                </button>
              )}
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 transition-colors hover:bg-white/30"
                  aria-label="使用者選單"
                >
                  <span className="text-base font-semibold text-white">{emailInitial}</span>
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-lg border border-gray-200 bg-white py-3 px-4 shadow-lg"
                    style={{
                      fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                    }}
                  >
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{authUser?.email ?? user?.email ?? '-'}</p>
                    <Link
                      to="/change-password"
                      onClick={() => setUserMenuOpen(false)}
                      className="mt-3 block w-full rounded border border-gray-200 px-3 py-1.5 text-center text-sm text-gray-600 hover:bg-gray-50"
                    >
                      修改密碼
                    </Link>
                    <button
                      type="button"
                      onClick={() => { logout(); navigate('/login'); setUserMenuOpen(false); }}
                      className="mt-2 w-full rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                    >
                      登出
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        </div>
      </header>
      )}

      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
