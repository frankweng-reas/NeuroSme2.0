/** Admin：會員管理 — 列表、新增、修改、刪除 */
import { useCallback, useEffect, useState } from 'react'
import { Pencil, Trash2, UserPlus, X } from 'lucide-react'
import { ApiError } from '@/api/client'
import { createUser, deleteUser, listUsers, updateUser } from '@/api/users'
import { useToast } from '@/contexts/ToastContext'
import type { User } from '@/types'

const ROLE_BADGE: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin:       'bg-blue-100 text-blue-700',
  manager:     'bg-teal-100 text-teal-700',
  member:      'bg-gray-100 text-gray-600',
}

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin:       'Admin',
  manager:     'Manager',
  member:      'Member',
}

interface AddUserForm {
  email: string
  username: string
  password: string
  role: 'admin' | 'manager' | 'member'
  must_change_password: boolean
}

const EMPTY_FORM: AddUserForm = {
  email: '',
  username: '',
  password: '',
  role: 'member',
  must_change_password: true,
}

export default function AdminUsers() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAddModal, setShowAddModal] = useState(false)
  const [form, setForm] = useState<AddUserForm>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [formLoading, setFormLoading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [editUsername, setEditUsername] = useState('')
  const [editRole, setEditRole] = useState<'admin' | 'manager' | 'member'>('member')
  const [editError, setEditError] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const { showToast } = useToast()

  const loadUsers = useCallback(() => {
    setLoading(true)
    setError(null)
    listUsers()
      .then(setUsers)
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 403 ? '需要 admin 權限' : '載入失敗')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  function openAddModal() {
    setForm(EMPTY_FORM)
    setFormError('')
    setShowAddModal(true)
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault()
    if (!form.email.trim() || !form.username.trim() || !form.password.trim()) {
      setFormError('請填寫所有必填欄位')
      return
    }
    setFormError('')
    setFormLoading(true)
    try {
      const newUser = await createUser({
        email: form.email.trim(),
        username: form.username.trim(),
        password: form.password,
        role: form.role,
        must_change_password: form.must_change_password,
      })
      setUsers((prev) => [...prev, newUser])
      setShowAddModal(false)
      showToast(`已新增使用者：${newUser.username}`)
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '新增失敗'
      setFormError(msg)
    } finally {
      setFormLoading(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteUser(deleteTarget.id)
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id))
      showToast(`已刪除：${deleteTarget.username}`)
      setDeleteTarget(null)
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '刪除失敗'
      showToast(msg, 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  function openEditModal(u: User) {
    setEditTarget(u)
    setEditUsername(u.username)
    setEditRole((u.role === 'super_admin' ? 'admin' : u.role) as 'admin' | 'manager' | 'member')
    setEditError('')
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    if (!editUsername.trim()) { setEditError('顯示名稱不可為空'); return }
    setEditLoading(true)
    try {
      const updated = await updateUser(editTarget.id, {
        username: editUsername.trim(),
        role: editRole,
      })
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)))
      showToast('已儲存')
      setEditTarget(null)
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      setEditError(msg)
    } finally {
      setEditLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-800">會員管理</h2>
        <button
          type="button"
          onClick={openAddModal}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white shadow-sm transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#4b5563' }}
        >
          <UserPlus className="h-4 w-4" />
          新增使用者
        </button>
      </div>

      {/* 提示 */}
      <p className="mb-4 text-sm text-gray-500">
        如需設定各使用者可存取的 Agent，請至「Agent 權限設定」頁面。
      </p>

      {/* Table */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : error ? (
        <p className="text-red-600">{error}</p>
      ) : users.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
          <p className="text-gray-500">尚無使用者</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">顯示名稱</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">角色</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{u.username}</td>
                  <td className="px-4 py-3 text-gray-600">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${ROLE_BADGE[u.role] ?? ROLE_BADGE.member}`}>
                      {ROLE_LABEL[u.role] ?? u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {u.role !== 'super_admin' && (
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(u)}
                          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          修改
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(u)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-600 transition-colors hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          刪除
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 新增使用者 Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">新增使用者</h3>
              <button type="button" onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  顯示名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  初始密碼 <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  required
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">角色</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as AddUserForm['role'] }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.must_change_password}
                  onChange={(e) => setForm((f) => ({ ...f, must_change_password: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-gray-600"
                />
                首次登入時強制變更密碼
              </label>
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#4b5563' }}
                >
                  {formLoading ? '建立中...' : '建立使用者'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
            <div className="px-6 py-5">
              <h3 className="mb-2 text-lg font-semibold text-gray-800">確認刪除</h3>
              <p className="text-sm text-gray-600">
                確定要刪除使用者{' '}
                <span className="font-medium text-gray-800">{deleteTarget.username}</span>（{deleteTarget.email}）？
              </p>
              <p className="mt-1 text-xs text-gray-400">此操作不可復原，認證帳號亦將一併移除。</p>
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteLoading}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改使用者 Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">修改使用者</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-500">Email（不可修改）</label>
                <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                  {editTarget.email}
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  顯示名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">角色</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as typeof editRole)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {editError && <p className="text-sm text-red-600">{editError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#4b5563' }}
                >
                  {editLoading ? '儲存中...' : '儲存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
