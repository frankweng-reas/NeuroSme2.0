import { apiFetch } from './client'

export interface BiSourceItem {
  source_id: string
  project_id: string
  source_type: string
  file_name: string
  content: string | null
  is_selected: boolean
  created_at: string
}

const SOURCE_TYPE_DATA = 'DATA'

export async function createBiSource(params: {
  project_id: string
  source_type?: string
  file_name: string
  content?: string | null
  is_selected?: boolean
}): Promise<BiSourceItem> {
  return apiFetch<BiSourceItem>('/bi-sources/', {
    method: 'POST',
    body: JSON.stringify({
      project_id: params.project_id,
      source_type: params.source_type ?? SOURCE_TYPE_DATA,
      file_name: params.file_name,
      content: params.content ?? null,
      is_selected: params.is_selected ?? true,
    }),
  })
}

export async function listBiSources(
  projectId: string,
  sourceType?: string
): Promise<BiSourceItem[]> {
  const params = new URLSearchParams({ project_id: projectId })
  if (sourceType) params.set('source_type', sourceType)
  return apiFetch<BiSourceItem[]>(`/bi-sources/?${params}`)
}

export async function updateBiSource(
  sourceId: string,
  params: { file_name?: string; content?: string; is_selected?: boolean }
): Promise<BiSourceItem> {
  return apiFetch<BiSourceItem>(`/bi-sources/${encodeURIComponent(sourceId)}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  })
}

export async function deleteBiSource(sourceId: string): Promise<void> {
  await apiFetch<undefined>(`/bi-sources/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
  })
}
