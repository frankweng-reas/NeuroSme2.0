/** 管理頁面：admin 專用，含 sidebar 導航（可折疊） */
import React, { useEffect, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import {
  ArrowLeft,
  BarChart3,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  KeyRound,
  KeySquare,
  Lock,
  UserCircle,
  Users,
  Wifi,
} from 'lucide-react'
import { getMe } from '@/api/users'
import type { User } from '@/types'
import ActivationDialog from '@/components/ActivationDialog'
import { AvatarCircle } from '@/components/AvatarCircle'
import ProfileModal from '@/components/ProfileModal'

const SIDEBAR_ITEMS = [
  { to: '/admin/tenant-settings', label: 'REAS-系統 Tenants 設定', icon: Building2, superAdminOnly: true },
  { to: '/admin/llm-settings', label: 'LLM 設定', icon: KeyRound, superAdminOnly: false },
  { to: '/admin/users', label: '使用者管理', icon: Users, superAdminOnly: false },
  { to: '/admin/user-permissions', label: '使用者權限設定', icon: Lock, superAdminOnly: false },
  { to: '/admin/agent-insights', label: 'Agents 用量洞察', icon: BarChart3, superAdminOnly: false },
  { to: '/admin/widget-management', label: 'Widget 管理', icon: Wifi, superAdminOnly: false },
] as const

const SIDEBAR_ITEMS_SECONDARY: Array<{
  to: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  superAdminOnly: boolean
}> = [
  // { to: '/admin/companies', label: '公司資訊', icon: Building, superAdminOnly: false },
]

const SIDEBAR_COLLAPSED_KEY = 'neurosme-admin-sidebar-collapsed'

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeSidebarCollapsed(v: boolean) {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, v ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [showActivation, setShowActivation] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
  }, [])

  const toggleSidebar = () => {
    setSidebarCollapsed((c) => {
      const next = !c
      writeSidebarCollapsed(next)
      return next
    })
  }

  const visibleItems = SIDEBAR_ITEMS.filter(
    (item) => !item.superAdminOnly || user?.role === 'super_admin'
  )
  const visibleSecondaryItems = SIDEBAR_ITEMS_SECONDARY.filter(
    (item) => !item.superAdminOnly || user?.role === 'super_admin'
  )
  return (
    <div className="flex h-full flex-col p-4">
      {showActivation && (
        <ActivationDialog
          onActivated={() => { setShowActivation(false); window.location.reload() }}
          onClose={() => setShowActivation(false)}
        />
      )}
      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
      {/* Header 容器 - 與既有風格一致 */}
      <header
        className="flex-shrink-0 rounded-lg border-b border-gray-200 px-6 py-4 shadow-sm"
        style={{ backgroundColor: '#4b5563' }}
      >
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="flex items-center text-white transition-opacity hover:opacity-80"
            aria-label="返回"
          >
            <ArrowLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-2xl font-bold text-white">管理工具</h1>
        </div>
      </header>

      {/* 主體：Sidebar + Content */}
      <div className="mt-4 flex flex-1 min-h-0 overflow-hidden">
        {/* Sidebar - 與 header 同色系 */}
        <aside
          className={`flex-shrink-0 rounded-l-lg border-2 border-r-0 border-gray-200 shadow-sm transition-[width] duration-200 ease-out ${
            sidebarCollapsed ? 'w-14' : 'w-72'
          }`}
          style={{ backgroundColor: '#4b5563' }}
        >
          <nav className={`flex h-full flex-col py-2 ${sidebarCollapsed ? 'items-center' : ''}`}>
            <div className={`mb-1 flex w-full ${sidebarCollapsed ? 'justify-center px-1' : 'justify-end px-2 pr-3'}`}>
              <button
                type="button"
                onClick={toggleSidebar}
                className="rounded-md p-2 text-white/90 transition-colors hover:bg-white/15 hover:text-white"
                aria-label={sidebarCollapsed ? '展開側邊選單' : '收合側邊選單'}
                title={sidebarCollapsed ? '展開選單' : '收合選單'}
              >
                {sidebarCollapsed ? (
                  <ChevronsRight className="h-5 w-5" />
                ) : (
                  <ChevronsLeft className="h-5 w-5" />
                )}
              </button>
            </div>
            {visibleItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center text-white transition-colors ${
                    sidebarCollapsed ? 'justify-center px-2 py-4' : 'gap-3 px-5 py-4'
                  } ${isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`
                }
              >
                <Icon className="h-6 w-6 flex-shrink-0" />
                {!sidebarCollapsed && <span className="min-w-0 text-lg">{label}</span>}
              </NavLink>
            ))}
            <div
              className={`my-4 border-t border-white/20 ${sidebarCollapsed ? 'mx-2 w-8' : 'mx-4'}`}
            />
            {/* 啟用授權：admin only（非 super_admin） */}
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setShowActivation(true)}
                title={sidebarCollapsed ? '啟用授權' : undefined}
                className={`flex items-center text-white transition-colors hover:bg-white/10 ${
                  sidebarCollapsed ? 'justify-center px-2 py-4' : 'gap-3 px-5 py-4'
                }`}
              >
                <KeySquare className="h-6 w-6 flex-shrink-0" />
                {!sidebarCollapsed && <span className="min-w-0 text-lg">啟用授權</span>}
              </button>
            )}
            {visibleSecondaryItems.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                title={sidebarCollapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center text-white transition-colors ${
                    sidebarCollapsed ? 'justify-center px-2 py-4' : 'gap-3 px-5 py-4'
                  } ${isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'}`
                }
              >
                <Icon className="h-6 w-6 flex-shrink-0" />
                {!sidebarCollapsed && <span className="min-w-0 text-lg">{label}</span>}
              </NavLink>
            ))}

            {/* 底部分隔 + 個人設定 */}
            <div className="flex-1" />
            <div className={`my-2 border-t border-white/20 ${sidebarCollapsed ? 'mx-2 w-8' : 'mx-4'}`} />
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              title={sidebarCollapsed ? '個人設定' : undefined}
              className={`flex w-full items-center text-white transition-colors hover:bg-white/10 ${
                sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-4 py-3'
              }`}
            >
              {user?.avatar_b64
                ? <AvatarCircle avatarB64={user.avatar_b64} name={user.display_name || user.username} size={24} />
                : <UserCircle className="h-5 w-5 flex-shrink-0" />
              }
              {!sidebarCollapsed && (
                <span className="min-w-0 truncate text-sm">
                  {user?.display_name || user?.username || '個人設定'}
                </span>
              )}
            </button>
          </nav>
        </aside>

        {/* Content 容器 - 與既有風格一致 */}
        <div className="flex-1 overflow-y-auto rounded-r-lg border-2 border-l-0 border-gray-200 bg-white p-8 shadow-sm">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
