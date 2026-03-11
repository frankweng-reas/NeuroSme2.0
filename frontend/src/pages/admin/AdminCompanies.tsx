/** Admin：公司資訊維護 */
import { useCallback, useEffect, useState } from 'react'
import { createCompany, deleteCompany, listCompanies, updateCompany } from '@/api/companies'
import { ApiError } from '@/api/client'
import ConfirmModal from '@/components/ConfirmModal'
import InputModal from '@/components/InputModal'
import { useToast } from '@/contexts/ToastContext'
import type { Company } from '@/types'

/** 將大圖縮小為 maxSize 內，輸出 jpeg base64（Logo 用） */
async function resizeImageToDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      if (width <= maxSize && height <= maxSize) {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
        return
      }
      if (width > height) {
        height = Math.round((height * maxSize) / width)
        width = maxSize
      } else {
        width = Math.round((width * maxSize) / height)
        height = maxSize
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.src = url
  })
}

const EMPTY_FORM: Record<string, string> = {
  legal_name: '',
  tax_id: '',
  logo_url: '',
  address: '',
  phone: '',
  email: '',
  contact: '',
  sort_order: '',
  quotation_terms: '',
}

export default function AdminCompanies() {
  const { showToast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Record<string, string>>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<Company | null>(null)

  const loadCompanies = useCallback(() => {
    setError(null)
    setLoading(true)
    listCompanies()
      .then(setCompanies)
      .catch((err) => {
        setCompanies([])
        setError(err instanceof ApiError && err.status === 403 ? '需 admin 權限' : '無法載入公司列表')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadCompanies()
  }, [loadCompanies])

  const handleAddClick = useCallback(() => {
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
    setFormOpen(true)
  }, [])

  const handleEditClick = useCallback((c: Company) => {
    setEditingId(c.id)
    setForm({
      legal_name: c.legal_name ?? '',
      tax_id: c.tax_id ?? '',
      logo_url: c.logo_url ?? '',
      address: c.address ?? '',
      phone: c.phone ?? '',
      email: c.email ?? '',
      contact: c.contact ?? '',
      sort_order: c.sort_order ?? '',
      quotation_terms: c.quotation_terms ?? '',
    })
    setFormOpen(true)
  }, [])

  const handleFormClose = useCallback(() => {
    setFormOpen(false)
    setEditingId(null)
    setForm({ ...EMPTY_FORM })
  }, [])

  const handleFormSubmit = useCallback(async () => {
    const data: Partial<Company> = {
      legal_name: form.legal_name.trim() || null,
      tax_id: form.tax_id.trim() || null,
      logo_url: form.logo_url.trim() || null,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      contact: form.contact.trim() || null,
      sort_order: form.sort_order.trim() || null,
      quotation_terms: form.quotation_terms?.trim() || null,
    }
    setSaving(true)
    try {
      if (editingId) {
        const updated = await updateCompany(editingId, data)
        setCompanies((prev) => prev.map((c) => (c.id === editingId ? updated : c)))
        showToast('已更新')
      } else {
        const created = await createCompany(data)
        setCompanies((prev) => [...prev, created].sort((a, b) => (a.sort_order ?? '').localeCompare(b.sort_order ?? '')))
        showToast('已新增')
      }
      handleFormClose()
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '儲存失敗'
      showToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }, [editingId, form, handleFormClose, showToast])

  const handleDeleteClick = useCallback((c: Company) => {
    setDeleteConfirm(c)
  }, [])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return
    const id = deleteConfirm.id
    setDeleteConfirm(null)
    try {
      await deleteCompany(id)
      setCompanies((prev) => prev.filter((c) => c.id !== id))
      showToast('已刪除')
    } catch (err) {
      const msg = err instanceof ApiError && err.detail ? err.detail : '刪除失敗'
      showToast(msg, 'error')
    }
  }, [deleteConfirm, showToast])

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  const updateForm = useCallback((key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  return (
    <div className="text-[18px]">
      <h2 className="mb-6 text-xl font-semibold text-gray-800">公司資訊</h2>

      <div className="mb-4">
        <button
          type="button"
          onClick={handleAddClick}
          className="rounded-lg px-4 py-2 text-[18px] font-medium text-white shadow-sm"
          style={{ backgroundColor: '#4b5563' }}
        >
          新增公司
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
        </div>
      ) : error ? (
        <p className="text-[18px] text-red-600">{error}</p>
      ) : companies.length === 0 ? (
        <p className="text-[18px] text-gray-500">尚無公司資料</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full border-collapse text-[18px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-100">
                <th className="px-4 py-3 text-left font-semibold text-gray-800">法定名稱</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">統編</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">聯絡人</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">電話</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-800">排序</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-800">操作</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 text-gray-900">{c.legal_name ?? '-'}</td>
                  <td className="px-4 py-3 font-mono text-gray-700">{c.tax_id ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{c.contact ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{c.phone ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-700">{c.email ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.sort_order ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleEditClick(c)}
                      className="mr-2 text-[18px] text-blue-600 hover:underline"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(c)}
                      className="text-[18px] text-red-600 hover:underline"
                    >
                      刪除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InputModal
        open={formOpen}
        title={editingId ? '編輯公司' : '新增公司'}
        submitLabel="儲存"
        loading={saving}
        onSubmit={handleFormSubmit}
        onClose={handleFormClose}
        contentClassName="min-w-[640px]"
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">法定名稱</label>
            <input
              type="text"
              value={form.legal_name}
              onChange={(e) => updateForm('legal_name', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="公司法定名稱"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">統編</label>
            <input
              type="text"
              value={form.tax_id}
              onChange={(e) => updateForm('tax_id', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="統一編號"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Logo</label>
            <div className="flex flex-wrap items-start gap-4">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                    上傳圖片
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file && file.type.startsWith('image/')) {
                          resizeImageToDataUrl(file)
                            .then((dataUrl) => updateForm('logo_url', dataUrl))
                            .catch(() => showToast('圖片載入失敗', 'error'))
                        }
                        e.target.value = ''
                      }}
                    />
                  </label>
                  <span className="text-sm text-gray-500">或輸入 URL</span>
                </div>
                <input
                  type="text"
                  value={form.logo_url?.startsWith('data:') ? '' : form.logo_url}
                  onChange={(e) => updateForm('logo_url', e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
                  placeholder="https://... 或上傳圖片"
                />
              </div>
              {(form.logo_url && (form.logo_url.startsWith('data:') || form.logo_url.startsWith('http'))) && (
                <div className="flex flex-shrink-0 flex-col items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-2">
                  <img
                    src={form.logo_url}
                    alt="Logo 預覽"
                    className="h-20 w-20 object-contain"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => updateForm('logo_url', '')}
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    清除
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">地址</label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => updateForm('address', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="公司地址"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">電話</label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => updateForm('phone', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="聯絡電話"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => updateForm('email', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="email@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">聯絡人</label>
            <input
              type="text"
              value={form.contact}
              onChange={(e) => updateForm('contact', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="聯絡人姓名"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">報價預設條款</label>
            <textarea
              value={form.quotation_terms}
              onChange={(e) => updateForm('quotation_terms', e.target.value)}
              rows={6}
              className="w-full resize-y rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="選用此公司時，報價單條款說明會自動帶入此內容"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">排序</label>
            <input
              type="text"
              value={form.sort_order}
              onChange={(e) => updateForm('sort_order', e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-400"
              placeholder="數字或字串，越小越前面"
            />
          </div>
        </div>
      </InputModal>

      <ConfirmModal
        open={!!deleteConfirm}
        title="確認刪除"
        message={deleteConfirm ? `確定要刪除「${deleteConfirm.legal_name ?? '未命名'}」嗎？` : ''}
        confirmText="刪除"
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </div>
  )
}
