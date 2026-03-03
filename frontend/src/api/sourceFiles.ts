import { apiFetch } from './client'

export interface SourceFileItem {
  id: number
  file_name: string
  is_selected: boolean
  created_at: string
}

export interface SourceFileDetail extends SourceFileItem {
  content: string
}

/** 取得該 agent 的來源檔案列表 */
export async function listSourceFiles(agentId: string): Promise<SourceFileItem[]> {
  return apiFetch<SourceFileItem[]>(`/source-files/?agent_id=${encodeURIComponent(agentId)}`)
}

/** 取得單一來源檔案（含 content，供編輯用） */
export async function getSourceFile(fileId: number): Promise<SourceFileDetail> {
  return apiFetch<SourceFileDetail>(`/source-files/${fileId}`)
}

/** 更新來源檔案內容 */
export async function updateSourceFileContent(
  fileId: number,
  content: string
): Promise<SourceFileItem> {
  return apiFetch<SourceFileItem>(`/source-files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ content }),
  })
}

/** 從文字建立來源檔案 */
export async function createSourceFileFromText(
  agentId: string,
  file_name: string,
  content: string
): Promise<SourceFileItem> {
  return apiFetch<SourceFileItem>('/source-files/', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: agentId,
      file_name,
      content,
    }),
  })
}

/** 上傳來源檔案 */
export async function uploadSourceFile(
  agentId: string,
  file: File
): Promise<SourceFileItem> {
  const content = await file.text()
  return apiFetch<SourceFileItem>('/source-files/', {
    method: 'POST',
    body: JSON.stringify({
      agent_id: agentId,
      file_name: file.name,
      content,
    }),
  })
}

/** 更新來源檔案選用狀態 */
export async function updateSourceFileSelected(
  fileId: number,
  isSelected: boolean
): Promise<SourceFileItem> {
  return apiFetch<SourceFileItem>(`/source-files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_selected: isSelected }),
  })
}

/** 重新命名來源檔案 */
export async function renameSourceFile(
  fileId: number,
  file_name: string
): Promise<SourceFileItem> {
  return apiFetch<SourceFileItem>(`/source-files/${fileId}`, {
    method: 'PATCH',
    body: JSON.stringify({ file_name }),
  })
}

/** 刪除來源檔案 */
export async function deleteSourceFile(fileId: number): Promise<void> {
  await apiFetch<undefined>(`/source-files/${fileId}`, {
    method: 'DELETE',
  })
}
