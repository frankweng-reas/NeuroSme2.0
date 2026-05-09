import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { getMe } from '@/api/users'
import { useAuth } from '@/contexts/AuthContext'
import { AvatarCircle } from '@/components/AvatarCircle'
import ProfileModal from '@/components/ProfileModal'
import type { User } from '@/types'
import { APP_VERSION } from '@/version'

export default function Layout() {
  const location = useLocation()
  const navigate = useNavigate()
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
  const [profileOpen, setProfileOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authUser) return
    getMe().then(setUser).catch(() => setUser(null))
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

  const displayName = user?.display_name || user?.username || authUser?.email?.split('@')[0] || 'U'

  return (
    <div
      className="flex h-screen flex-col"
      style={{ backgroundImage: `linear-gradient(160deg, #cdd5d9 0%, #d8e0e3 100%)` }}
    >
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />

      {/* Header - 在 agent 頁面隱藏 */}
      {!hideHeader && (
      <header className="flex-shrink-0 px-2 pt-3 pb-2">
        <div className="rounded-3xl border-b border-black/10 shadow-sm" style={{ backgroundColor: '#18333D' }}>
        <div className="container mx-auto px-4">
          <div className="flex h-20 items-center justify-between">
            <Link to="/" className="flex items-center hover:opacity-90">
              <h1
                className="text-2xl font-bold text-white"
                style={{ letterSpacing: '-0.5px', fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif", fontStyle: 'italic' }}
              >
                <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '32px' }}>Neuro</span>
                <span style={{ fontWeight: 700, fontSize: '32px', background: 'linear-gradient(90deg, #60d0f0 0%, #7c6ff7 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', paddingRight: '8px' }}>SME</span>
                <span style={{ fontWeight: 300, fontStyle: 'normal', fontSize: '24px', opacity: 0.7 }}>{' \u00a0| Private Hub'}</span>
                <span style={{ fontWeight: 300, fontStyle: 'normal', fontSize: '20px', opacity: 0.3, marginLeft: '0.6em', letterSpacing: '0.02em' }}>
                  {APP_VERSION}
                </span>
              </h1>
            </Link>
            <div className="flex items-center gap-3">
              {(user?.role === 'admin' || user?.role === 'super_admin') && (
                <button
                  type="button"
                  onClick={() => navigate('/admin')}
                  className="rounded-full border border-white/30 bg-white/10 px-5 py-2 text-base font-medium text-white transition-colors hover:bg-white/20"
                  style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  管理工具
                </button>
              )}
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/30 overflow-hidden ring-1 ring-gray-400/40 transition-all hover:opacity-80 hover:ring-gray-300/60"
                  aria-label="使用者選單"
                >
                  <AvatarCircle avatarB64={user?.avatar_b64} name={displayName} size={40} />
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-2 min-w-[220px] rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden"
                    style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}
                  >
                    <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 border-b border-gray-100">
                      <AvatarCircle avatarB64={user?.avatar_b64} name={displayName} size={36} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{displayName}</p>
                        <p className="truncate text-xs text-gray-500">{authUser?.email ?? user?.email ?? '-'}</p>
                      </div>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => { setProfileOpen(true); setUserMenuOpen(false) }}
                        className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                      >
                        個人設定
                      </button>
                    </div>
                    <div className="border-t border-gray-100 py-1">
                      <button
                        type="button"
                        onClick={() => { logout(); navigate('/login'); setUserMenuOpen(false) }}
                        className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                      >
                        登出
                      </button>
                    </div>
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
