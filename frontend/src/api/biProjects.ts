import { apiFetch } from './client'

export interface BiProjectItem {
  project_id: string
  project_name: string
  project_desc: string | null
  created_at: string
  conversation_data?: MessageStored[] | null
  /** 與匯入模板／分析意圖對齊的 bi_schemas id */
  schema_id?: string | null
}

/** 儲存於 DB 的訊息格式（與 Message 相容） */
export interface MessageStored {
  role: 'user' | 'assistant'
  content: string
  meta?: { model: string; usage: Record<string, number>; finish_reason: string | null }
  chartData?: unknown
}

export async function createBiProject(params: {
  agent_id: string
  project_name: string
  project_desc?: string | null
}): Promise<BiProjectItem> {
  return apiFetch<BiProjectItem>('/bi-projects/', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function listBiProjects(agentId: string): Promise<BiProjectItem[]> {
  return apiFetch<BiProjectItem[]>(
    `/bi-projects/?agent_id=${encodeURIComponent(agentId)}`
  )
}

export async function updateBiProject(
  agentId: string,
  projectId: string,
  params: {
    project_name?: string
    project_desc?: string | null
    conversation_data?: MessageStored[]
  }
): Promise<BiProjectItem> {
  return apiFetch<BiProjectItem>(
    `/bi-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(params),
    }
  )
}

export async function deleteBiProject(agentId: string, projectId: string): Promise<void> {
  await apiFetch(
    `/bi-projects/${encodeURIComponent(projectId)}?agent_id=${encodeURIComponent(agentId)}`,
    { method: 'DELETE' }
  )
}

/** 手動同步專案 CSV 至 DuckDB */
export async function syncDuckdb(
  agentId: string,
  projectId: string
): Promise<{ ok: boolean; message: string; row_count?: number }> {
  return apiFetch(
    `/bi-projects/${encodeURIComponent(projectId)}/sync-duckdb?agent_id=${encodeURIComponent(agentId)}`,
    { method: 'POST' }
  )
}

/** 取得專案 DuckDB 資料筆數 */
export async function getDuckdbStatus(
  agentId: string,
  projectId: string
): Promise<{ row_count: number; has_data: boolean }> {
  return apiFetch(
    `/bi-projects/${encodeURIComponent(projectId)}/duckdb-status?agent_id=${encodeURIComponent(agentId)}`
  )
}

/** 依 bi_schema 或 mapping template 將 CSV 匯入 DuckDB */
export async function importCsvToDuckdb(
  agentId: string,
  projectId: string,
  blocks: { schema_id?: string; template_name?: string; files: { file_name: string; content: string }[] }[]
): Promise<{ ok: boolean; message: string; row_count?: number; schema_id?: string }> {
  return apiFetch<{ ok: boolean; message: string; row_count?: number; schema_id?: string }>(
    `/bi-projects/${encodeURIComponent(projectId)}/import-csv?agent_id=${encodeURIComponent(agentId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ blocks }),
    }
  )
}
