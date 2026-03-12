import {
  createBiSource,
  deleteBiSource,
  listBiSources,
  updateBiSource,
} from '@/api/biSources'
import type { SourceListAdapter } from './sourceListAdapter'

export function createBiSourceAdapter(projectId: string): SourceListAdapter {
  return {
    config: {
      supportsCheckbox: true,
      fileAccept: '.csv,.txt,.md,.json',
      fileUploadLabel: '選擇 CSV 檔案（可多選）',
      emptyMessage: '尚無來源檔案',
    },
    list: async () => {
      const items = await listBiSources(projectId)
      return items.map((s) => ({
        id: s.source_id,
        file_name: s.file_name,
        is_selected: s.is_selected,
        content: s.content,
      }))
    },
    createFromText: async ({ file_name, content }) => {
      const item = await createBiSource({
        project_id: projectId,
        file_name,
        content,
      })
      return {
        id: item.source_id,
        file_name: item.file_name,
        is_selected: item.is_selected,
        content: item.content,
      }
    },
    uploadFile: async (file) => {
      const content = await file.text()
      const item = await createBiSource({
        project_id: projectId,
        file_name: file.name,
        content,
      })
      return {
        id: item.source_id,
        file_name: item.file_name,
        is_selected: item.is_selected,
        content: item.content,
      }
    },
    update: async ({ id, file_name, content, is_selected }) => {
      const updates: { file_name?: string; content?: string; is_selected?: boolean } = {}
      if (file_name !== undefined) updates.file_name = file_name
      if (content !== undefined) updates.content = content
      if (is_selected !== undefined) updates.is_selected = is_selected
      const item = await updateBiSource(id, updates)
      return {
        id: item.source_id,
        file_name: item.file_name,
        is_selected: item.is_selected,
        content: item.content,
      }
    },
    delete: (id) => deleteBiSource(id),
    getContent: undefined,
  }
}
