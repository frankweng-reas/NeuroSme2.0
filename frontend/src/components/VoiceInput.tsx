/**
 * VoiceInput：麥克風錄音按鈕元件（含語言選擇）
 *
 * 用法：
 *   <VoiceInput onTranscript={(text) => setInput(text)} disabled={isLoading} />
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Loader2, ChevronDown } from 'lucide-react'
import { transcribeAudio } from '@/api/speech'
import { ApiError } from '@/api/client'

interface VoiceInputProps {
  onTranscript: (text: string) => void
  onError?: (msg: string) => void
  disabled?: boolean
  className?: string
}

type RecordState = 'idle' | 'recording' | 'processing'

type LangOption = { value: string; label: string }
const LANG_OPTIONS: LangOption[] = [
  { value: '',   label: '自動' },
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
]
const LANG_STORAGE_KEY = 'voice-input-lang'

export default function VoiceInput({ onTranscript, onError, disabled, className }: VoiceInputProps) {
  const [state, setState] = useState<RecordState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [lang, setLang] = useState<string>(() => {
    try { return localStorage.getItem(LANG_STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const langMenuRef = useRef<HTMLDivElement>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => { clearTimer(); stopStream() }, [clearTimer, stopStream])

  useEffect(() => {
    if (!langMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) setLangMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [langMenuOpen])

  const handleStop = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    setState('processing')
    clearTimer()
    await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop() })
    stopStream()

    const chunks = chunksRef.current
    if (chunks.length === 0) { setState('idle'); setSeconds(0); return }

    const mimeType = recorder.mimeType || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    const blob = new Blob(chunks, { type: mimeType })
    chunksRef.current = []

    try {
      const result = await transcribeAudio(blob, `recording.${ext}`, lang || undefined)
      const text = (result.text || '').trim()
      if (text) { onTranscript(text) } else { onError?.('未能辨識語音，請再試一次') }
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '語音轉文字失敗'
      onError?.(msg)
    } finally {
      setState('idle')
      setSeconds(0)
    }
  }, [clearTimer, stopStream, onTranscript, onError, lang])

  const handleStart = useCallback(async () => {
    if (disabled || state !== 'idle') return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (e) {
      onError?.(e instanceof Error && e.name === 'NotAllowedError' ? '請允許瀏覽器使用麥克風' : '無法存取麥克風')
      return
    }
    streamRef.current = stream
    chunksRef.current = []
    const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
    const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mediaRecorderRef.current = recorder
    recorder.start(200)
    setState('recording')
    setSeconds(0)
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [disabled, state, onError])

  const handleMicClick = useCallback(() => {
    if (state === 'idle') void handleStart()
    else if (state === 'recording') void handleStop()
  }, [state, handleStart, handleStop])

  const selectLang = useCallback((value: string) => {
    setLang(value)
    setLangMenuOpen(false)
    try { localStorage.setItem(LANG_STORAGE_KEY, value) } catch { /* ignore */ }
  }, [])

  const isRecording = state === 'recording'
  const isProcessing = state === 'processing'
  const currentLangLabel = LANG_OPTIONS.find((o) => o.value === lang)?.label ?? '自動'

  return (
    <div className={`flex items-center ${className ?? ''}`}>
      {/* 麥克風按鈕 */}
      <button
        type="button"
        onClick={handleMicClick}
        disabled={disabled || isProcessing}
        aria-label={isRecording ? `停止錄音（${seconds}s）` : isProcessing ? '轉換中…' : '語音輸入'}
        title={isRecording ? `停止錄音（${seconds}s）` : isProcessing ? '轉換中…' : `語音輸入（${currentLangLabel}）`}
        className={[
          'relative rounded-l-lg border p-2 transition-colors',
          isRecording ? 'border-red-400 bg-red-50 text-red-600 hover:bg-red-100'
            : isProcessing ? 'border-gray-300 bg-gray-50 text-gray-400'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
          'disabled:opacity-50',
        ].join(' ')}
      >
        {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" />
          : isRecording ? (
            <>
              <MicOff className="h-5 w-5" />
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500 m-auto" />
              </span>
            </>
          ) : <Mic className="h-5 w-5" />}
      </button>

      {/* 語言選擇下拉 */}
      <div className="relative" ref={langMenuRef}>
        <button
          type="button"
          onClick={() => !isRecording && !isProcessing && setLangMenuOpen((o) => !o)}
          disabled={disabled || isRecording || isProcessing}
          title={`目前：${currentLangLabel}`}
          className="flex items-center gap-0.5 rounded-r-lg border border-l-0 border-gray-300 bg-white px-1.5 py-2 text-[11px] text-gray-500 transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          <span className="leading-none">{currentLangLabel}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
        {langMenuOpen && (
          <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[88px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
            {LANG_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => selectLang(o.value)}
                className={`w-full px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-50 ${lang === o.value ? 'font-medium text-gray-900' : 'text-gray-700'}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
