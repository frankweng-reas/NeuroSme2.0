/** Admin：知識庫管理 — 列出所有 KB、修改 scope、刪除 */
import { useCallback, useEffect, useState } from 'react'
import { BookOpen, Pencil, Trash2, X } from 'lucide-react'
import { ApiError } from '@/api/client'
import {
  adminListKnowledgeBases,
  deleteKnowledgeBase,
  updateKnowledgeBase,
  type KmKnowledgeBaseAdmin,
  type KbScope,
} from '@/api/km'
import { useToast } from '@/contexts/ToastContext'

const SCOPE_BADGE: Record<KbScope, string> = {
  company: 'bg-teal-100 text-teal-700',
  personal: 'bg-gray-100 text-gray-600',
}
const SCOPE_LABEL: Record<KbScope, string> = {
  company: '公司共用',
  personal: '個人',
}

export default function AdminKbManagement() {
  const [kbs, setKbs] = useState<KmKnowledgeBaseAdmin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<KmKnowledgeBaseAdmin | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const [editTarget, setEditTarget] = useState<KmKnowledgeBaseAdmin | null>(null)
  const [editName, setEditName] = useState('')
  const [editScope, setEditScope] = useState<KbScope>('personal')
  const [editError, setEditError] = useState('')
  const [editLoading, setEditLoading] = useState(false)

  const { showToast } = useToast()

  const loadKbs = useCallback(() => {
    setLoading(true)
    setError(null)
    adminListKnowledgeBases()
      .then(setKbs)
      .catch((err) => {
        setError(err instanceof ApiError && err.status === 403 ? '需要 admin 權限' : '載入失敗')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadKbs() }, [loadKbs])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteKnowledgeBase(deleteTarget.id)
      setKbs((prev) => prev.filter((k) => k.id !== deleteTarget.id))
      showToast(`已刪除：${deleteTarget.name}`)
      setDeleteTarget(null)
    } catch (err) {
      const msg = err instanceof ApiError && (err as ApiError).detail ? (err as ApiError).detail : '刪除失敗'
      showToast(String(msg), 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  function openEditModal(kb: KmKnowledgeBaseAdmin) {
    setEditTarget(kb)
    setEditName(kb.name)
    setEditScope(kb.scope)
    setEditError('')
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault()
    if (!editTarget) return
    if (!editName.trim()) { setEditError('名稱不可為空'); return }
    setEditLoading(true)
    try {
      const updated = await updateKnowledgeBase(editTarget.id, {
        name: editName.trim(),
        scope: editScope,
      })
      setKbs((prev) =>
        prev.map((k) => (k.id === editTarget.id ? { ...k, ...updated } : k)),
      )
      showToast('已儲存')
      setEditTarget(null)
    } catch (err) {
      const msg = err instanceof ApiError && (err as ApiError).detail ? (err as ApiError).detail : '儲存失敗'
      setEditError(String(msg))
    } finally {
      setEditLoading(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-gray-600" />
          <h2 className="text-lg font-bold text-gray-800">知識庫管理</h2>
        </div>
      </div>

      <p className="mb-4 text-base text-gray-500">
        以下列出本租戶所有知識庫，管理員可修改名稱、範圍或刪除任意知識庫。
      </p>

      {/* Table */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : error ? (
        <p className="text-base text-red-600">{error}</p>
      ) : kbs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 bg-gray-50">
          <p className="text-base text-gray-500">尚無知識庫</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full text-base">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">名稱</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">範圍</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">建立者</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">文件</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Bot 使用</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">建立時間</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {kbs.map((kb) => (
                <tr key={kb.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{kb.name}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-base font-medium ${SCOPE_BADGE[kb.scope]}`}>
                      {SCOPE_LABEL[kb.scope]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {kb.created_by_name ?? <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {kb.ready_count} / {kb.doc_count}
                  </td>
                  <td className="px-4 py-3">
                    {kb.bot_count > 0 ? (
                      <span className="inline-block rounded-full bg-emerald-100 px-2.5 py-0.5 text-base font-medium text-emerald-700">
                        {kb.bot_count} 個
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(kb.created_at).toLocaleDateString('zh-TW')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEditModal(kb)}
                        className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-base text-gray-600 transition-colors hover:bg-gray-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        修改
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(kb)}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-base text-red-600 transition-colors hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 刪除確認 Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white shadow-xl">
            <div className="px-6 py-5">
              <h3 className="mb-2 text-lg font-semibold text-gray-800">確認刪除</h3>
              <p className="text-base text-gray-600">
                確定要刪除知識庫{' '}
                <span className="font-medium text-gray-800">「{deleteTarget.name}」</span>？
              </p>
              <p className="mt-1 text-base text-gray-400">此操作不可復原，所有相關文件與向量資料亦將一併移除。</p>
              {deleteTarget.bot_count > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-base font-medium text-amber-700">
                  ⚠ 此知識庫目前被 {deleteTarget.bot_count} 個 Bot 使用中，刪除後這些 Bot 將失去此知識來源。
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deleteLoading}
                className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteLoading}
                className="rounded-lg bg-red-600 px-4 py-2 text-base font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading ? '刪除中...' : '確認刪除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 修改 Modal */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-800">修改知識庫</h3>
              <button type="button" onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEdit} className="space-y-4 px-6 py-5">
              <div>
                <label className="mb-1 block text-base font-medium text-gray-700">
                  名稱 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-base font-medium text-gray-700">範圍</label>
                <select
                  value={editScope}
                  onChange={(e) => setEditScope(e.target.value as KbScope)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-base focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                >
                  <option value="personal">個人 (personal)</option>
                  <option value="company">公司共用 (company)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-base font-medium text-gray-500">建立者</label>
                <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-base text-gray-500">
                  {editTarget.created_by_name ?? '—'}
                </p>
              </div>
              {editError && <p className="text-base text-red-600">{editError}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-base text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="rounded-lg px-4 py-2 text-base font-medium text-white disabled:opacity-50"
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
