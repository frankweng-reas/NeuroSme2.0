import { apiFetch } from './client'

export interface SchemaField {
  field: string
  type: string
  attr?: string
  aliases?: string[]
  required?: boolean
  default?: string | number
}

export interface MappingTemplateItem {
  template_name: string
  csv_headers: string[] | null
}

export interface MappingTemplateDetail {
  template_name: string
  mapping: Record<string, string>
  csv_headers: string[] | null
}

export async function getBiSalesSchema(): Promise<SchemaField[]> {
  return apiFetch<SchemaField[]>('/test01/schema')
}

export async function listMappingTemplates(): Promise<MappingTemplateItem[]> {
  return apiFetch<MappingTemplateItem[]>('/test01/mapping-templates')
}

export async function getMappingTemplate(templateName: string): Promise<MappingTemplateDetail> {
  return apiFetch<MappingTemplateDetail>(`/test01/mapping-templates/${encodeURIComponent(templateName)}`)
}

export async function saveMappingTemplate(params: {
  template_name: string
  mapping: Record<string, string>
  csv_headers?: string[] | null
}): Promise<MappingTemplateDetail> {
  return apiFetch('/test01/mapping-templates', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function transformCsv(params: {
  csv_content: string
  mapping: Record<string, string>
}): Promise<{ rows: Record<string, unknown>[]; row_count: number }> {
  return apiFetch('/test01/transform', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

export async function syncToDuckdb(params: {
  csv_content: string
  mapping: Record<string, string>
  template_name?: string | null
  csv_headers?: string[] | null
}): Promise<{ ok: boolean; message: string; row_count: number }> {
  return apiFetch('/test01/sync-duckdb', {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/** 使用 LLM 建議 CSV 欄位與 Schema 的對應 */
export async function suggestMapping(params: {
  csv_headers: string[]
  model?: string
}): Promise<{
  mapping: Record<string, string>
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
}> {
  return apiFetch('/test01/suggest-mapping', {
    method: 'POST',
    body: JSON.stringify({ csv_headers: params.csv_headers, model: params.model ?? 'gpt-4o-mini' }),
  })
}
