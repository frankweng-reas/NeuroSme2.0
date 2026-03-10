/** 產品或服務清單：從公司報價清單套用，僅顯示與刪除 */
import { useEffect, useState } from 'react'
import { FileText, Trash2 } from 'lucide-react'
import ConfirmModal from '@/components/ConfirmModal'
import { listQtnCatalogs, type QtnCatalogItem } from '@/api/qtnCatalogs'
import {
  createQtnSource,
  deleteQtnSource,
  listQtnSources,
  type QtnSourceItem,
} from '@/api/qtnSources'
import { ApiError } from '@/api/client'

export interface QtnOfferingListProps {
  projectId: string | null
  /** 是否可摺疊，預設 true */
  collapsible?: boolean
}

function getErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.detail) return err.detail
  if (err instanceof Error) return err.message
  return '操作失敗，請稍後再試'
}

export default function QtnOfferingList({
  projectId,
  collapsible = true,
}: QtnOfferingListProps) {
  const [sources, setSources] = useState<QtnSourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [catalogs, setCatalogs] = useState<QtnCatalogItem[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>('')
  const [applyingCatalog, setApplyingCatalog] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setSources([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    listQtnSources(projectId, 'OFFERING')
      .then(setSources)
      .catch((err) => {
        setSources([])
        setError(getErrorMessage(err))
      })
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => {
    setCatalogsLoading(true)
    listQtnCatalogs()
      .then(setCatalogs)
      .catch(() => setCatalogs([]))
      .finally(() => setCatalogsLoading(false))
  }, [])

  const refresh = () => {
    if (!projectId) return
    listQtnSources(projectId, 'OFFERING').then(setSources).catch(() => {})
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteQtnSource(id)
      refresh()
      setDeleteId(null)
    } catch (err) {
      setError(getErrorMessage(err))
    }
  }

  const selectedCatalog = catalogs.find((c) => c.catalog_id === selectedCatalogId)
  const appliedCatalogNames = new Set(
    sources.filter((s) => s.content === null || s.content === '').map((s) => s.file_name)
  )
  const isAlreadyApplied = selectedCatalog ? appliedCatalogNames.has(selectedCatalog.catalog_name) : false

  const handleApplyCatalog = async () => {
    if (!projectId || !selectedCatalogId || !selectedCatalog) return
    if (isAlreadyApplied) return
    setApplyingCatalog(true)
    setError(null)
    try {
      await createQtnSource({
        project_id: projectId,
        source_type: 'OFFERING',
        file_name: selectedCatalog.catalog_name,
        content: null,
      })
      refresh()
    } catch (err) {
      setError(getErrorMessage(err))
    } finally {
      setApplyingCatalog(false)
    }
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col rounded-xl border border-gray-200 bg-gray-50/50">
        <button
          type="button"
          className={`flex shrink-0 w-full items-center justify-between rounded-t-xl bg-sky-100 px-4 py-3 text-left ${collapsible ? '' : 'cursor-default'}`}
          onClick={collapsible ? () => setCollapsed((c) => !c) : undefined}
        >
          <h4 className="text-base font-medium text-gray-700">產品或服務清單</h4>
        </button>

        {!collapsed && (
          <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-200 px-4 py-3">
            {error && (
              <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-base text-red-700">{error}</div>
            )}
            <div className="mb-3">
              <div className="flex gap-2">
                <select
                  value={selectedCatalogId}
                  onChange={(e) => setSelectedCatalogId(e.target.value)}
                  disabled={catalogsLoading || !projectId}
                  className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-700 focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:opacity-50"
                >
                  <option value="">選擇公司報價清單</option>
                  {catalogs.map((c) => (
                    <option key={c.catalog_id} value={c.catalog_id}>
                      {c.catalog_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleApplyCatalog}
                  disabled={!selectedCatalogId || applyingCatalog || !projectId || isAlreadyApplied}
                  className="shrink-0 rounded-2xl border border-gray-300 bg-white px-3 py-2 text-base text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  {applyingCatalog ? '套用中...' : isAlreadyApplied ? '已套用' : '套用'}
                </button>
              </div>
            </div>
            {loading ? (
              <p className="mt-3 text-base text-gray-500">載入中...</p>
            ) : sources.length === 0 ? (
              <p className="mt-3 text-base text-gray-500">尚無來源</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {sources.map((s) => (
                  <li
                    key={s.source_id}
                    className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-base text-gray-700 ring-1 ring-gray-200/60"
                  >
                    <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="min-w-0 flex-1 truncate">{s.file_name}</span>
                    <button
                      type="button"
                      onClick={() => setDeleteId(s.source_id)}
                      className="shrink-0 rounded-2xl p-1 text-gray-500 hover:bg-red-50 hover:text-red-600"
                      aria-label="刪除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <ConfirmModal
        open={deleteId !== null}
        title="刪除來源"
        message="確定要刪除此來源嗎？"
        confirmText="刪除"
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)}
      />
    </>
  )
}
