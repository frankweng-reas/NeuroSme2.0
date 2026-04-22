import { apiFetch } from './client'

export interface TranscribeResult {
  text: string
  language: string
  duration: number
}

export interface SpeechStatus {
  enabled: boolean
  base_url?: string
  reason?: string
}

export async function transcribeAudio(audioBlob: Blob, filename = 'audio.webm', language?: string): Promise<TranscribeResult> {
  const form = new FormData()
  form.append('file', audioBlob, filename)
  if (language) form.append('language', language)
  return apiFetch<TranscribeResult>('/speech/transcribe', {
    method: 'POST',
    body: form,
    timeout: 60_000,
  })
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  return apiFetch<SpeechStatus>('/speech/status')
}
