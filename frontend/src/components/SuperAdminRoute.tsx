/** 需 super_admin 權限才能存取，非 super_admin 導向 admin 首頁 */
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { getMe } from '@/api/users'
import type { User } from '@/types'

export default function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMe()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">載入中...</p>
      </div>
    )
  }

  if (!user || user.role !== 'super_admin') {
    return <Navigate to="/admin" replace />
  }

  return <>{children}</>
}
