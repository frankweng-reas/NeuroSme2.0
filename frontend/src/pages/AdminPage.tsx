/** 管理頁面：admin 專用，含 sidebar 導航 */
import { Link, NavLink, Outlet } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Users } from 'lucide-react'

const SIDEBAR_ITEMS = [
  { to: '/admin/agent-permissions', label: 'Agent 權限設定', icon: ShieldCheck },
  { to: '/admin/users', label: '會員管理', icon: Users },
] as const

export default function AdminPage() {
  return (
    <div className="flex h-full flex-col p-4">
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
          className="flex-shrink-0 w-56 rounded-l-lg border-2 border-r-0 border-gray-200 shadow-sm"
          style={{ backgroundColor: '#4b5563' }}
        >
          <nav className="flex flex-col py-4">
            {SIDEBAR_ITEMS.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-3 text-white transition-colors ${
                    isActive ? 'bg-white/20 font-semibold' : 'hover:bg-white/10'
                  }`
                }
              >
                <Icon className="h-5 w-5 flex-shrink-0" />
                <span>{label}</span>
              </NavLink>
            ))}
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
