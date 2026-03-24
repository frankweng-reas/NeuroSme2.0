import { apiFetch } from './client'

export interface BiSchemaItem {
  id: string
  name: string
  desc?: string | null
  is_template: boolean
}

export interface BiSchemaDetail extends BiSchemaItem {
  schema_json: Record<string, unknown>
}

export async function listBiSchemas(): Promise<BiSchemaItem[]> {
  return apiFetch<BiSchemaItem[]>('/bi-schemas/')
}

export async function getBiSchema(schemaId: string): Promise<BiSchemaDetail> {
  return apiFetch<BiSchemaDetail>(`/bi-schemas/${encodeURIComponent(schemaId)}`)
}

export async function createBiSchema(body: {
  id?: string
  name: string
  desc?: string
  schema_json: Record<string, unknown>
}): Promise<{ id: string; name: string }> {
  return apiFetch<{ id: string; name: string }>('/bi-schemas/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function updateBiSchema(
  schemaId: string,
  body: { name?: string; desc?: string; schema_json?: Record<string, unknown> }
): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/bi-schemas/${encodeURIComponent(schemaId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteBiSchema(schemaId: string): Promise<void> {
  return apiFetch<void>(`/bi-schemas/${encodeURIComponent(schemaId)}`, {
    method: 'DELETE',
  })
}
