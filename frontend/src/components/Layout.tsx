/** 共用版面：Header（含 NeuroSme 品牌、用戶區）+ Outlet；agent、admin 頁面隱藏 Header */
import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getUserByEmail } from '@/api/users'
import { getCurrentUserEmail } from '@/utils/auth'
import type { User } from '@/types'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
  const hideHeader = location.pathname.startsWith('/agent/') || location.pathname === '/admin'
  const [user, setUser] = useState<User | null>(null)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getUserByEmail(getCurrentUserEmail())
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    if (userMenuOpen) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [userMenuOpen])

  return (
    <div className="flex h-screen flex-col bg-gray-50">
      {/* Header - 在 agent 頁面隱藏 */}
      {!hideHeader && (
      <header
        className="flex-shrink-0 border-b border-gray-200 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex h-32 items-center justify-between">
            {/* 應用名稱 - 點擊回到首頁 */}
            <Link to="/" className="flex flex-col items-center hover:opacity-90">
              <h1
                className="text-4xl font-bold text-white"
                style={{
                  letterSpacing: '-1px',
                  fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                  fontStyle: 'italic',
                }}
              >
                <span style={{ fontWeight: 700 }}>Neuro</span>
                <span style={{ fontWeight: 700 }}>Sme</span>
              </h1>
            </Link>

            {/* 右側：管理工具、用戶資訊 */}
            <div className="flex items-center gap-4">
              {user?.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className="rounded-3xl border border-white/30 bg-white/10 px-6 py-2 text-sm font-medium text-white transition-opacity hover:bg-white/20"
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
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/20 transition-opacity hover:bg-white/30"
                  aria-label="使用者選單"
                >
                  <span className="text-sm font-semibold text-white">U</span>
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 min-w-[200px] rounded-lg border border-gray-200 bg-white py-3 px-4 shadow-lg"
                    style={{
                      fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
                    }}
                  >
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{getCurrentUserEmail()}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>
      )}

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
