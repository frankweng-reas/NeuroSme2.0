/**
 * VoiceInput：語音輸入元件
 * 工具列顯示小麥克風按鈕，點擊後開啟 Modal 進行錄音操作。
 *
 * 狀態機：
 *   closed → idle（modal 開啟）→ recording → processing → result → closed
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, Loader2, RotateCcw, Check, X, ChevronDown } from 'lucide-react'
import type { SpeechStatus } from '@/api/speech'
import { ApiError } from '@/api/client'

interface VoiceInputProps {
  /** 錄音完成後的辨識函式（依賴注入），回傳辨識文字 */
  transcribe: (blob: Blob, filename: string, lang?: string) => Promise<string>
  onTranscript: (text: string, autoSend?: boolean) => void
  onError?: (msg: string) => void
  disabled?: boolean
  /** 可選：查詢語音服務狀態（提供時顯示 provider badge） */
  checkStatus?: () => Promise<SpeechStatus>
  /** 觸發按鈕的自訂 className */
  buttonClassName?: string
  /** 隱藏語言選單，固定使用自動偵測 */
  hideLangSelector?: boolean
}

type ModalState = 'closed' | 'idle' | 'recording' | 'processing' | 'result'

type LangOption = { value: string; label: string; hint: string }
const LANG_OPTIONS: LangOption[] = [
  { value: '',   label: '自動偵測', hint: '中英混雜' },
  { value: 'zh', label: '中文',     hint: '純中文，準確度最高' },
  { value: 'en', label: 'English',  hint: '英文或技術詞彙' },
]
const LANG_STORAGE_KEY = 'voice-input-lang'

export default function VoiceInput({
  transcribe,
  onTranscript,
  onError,
  disabled,
  checkStatus,
  buttonClassName,
  hideLangSelector = false,
}: VoiceInputProps) {
  const [modalState, setModalState] = useState<ModalState>('closed')
  const [seconds, setSeconds] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [lang, setLang] = useState<string>(() => {
    if (hideLangSelector) return ''
    try { return localStorage.getItem(LANG_STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [langMenuOpen, setLangMenuOpen] = useState(false)
  const [speechStatus, setSpeechStatus] = useState<SpeechStatus | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const langMenuRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 清理
  const clearTimer = useCallback(() => {
    if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null }
  }, [])
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])
  useEffect(() => () => { clearTimer(); stopStream() }, [clearTimer, stopStream])

  // Modal 開啟時取得語音服務狀態（僅在提供 checkStatus 時）
  useEffect(() => {
    if (modalState !== 'idle' || !checkStatus) return
    checkStatus()
      .then((s) => setSpeechStatus(s))
      .catch(() => setSpeechStatus({ enabled: false, reason: '無法取得服務狀態' }))
  }, [modalState, checkStatus])

  // ESC 關閉
  useEffect(() => {
    if (modalState === 'closed') return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [modalState])

  // 點外部關閉語言選單
  useEffect(() => {
    if (!langMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node))
        setLangMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [langMenuOpen])

  // result 狀態時自動聚焦 textarea
  useEffect(() => {
    if (modalState === 'result') {
      setTimeout(() => textareaRef.current?.focus(), 50)
    }
  }, [modalState])

  const handleClose = useCallback(() => {
    clearTimer()
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    stopStream()
    chunksRef.current = []
    setModalState('closed')
    setSeconds(0)
    setTranscript('')
    setLangMenuOpen(false)
  }, [clearTimer, stopStream])

  const handleStartRecording = useCallback(async () => {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      })
    } catch (e) {
      const msg = e instanceof Error && e.name === 'NotAllowedError'
        ? '請允許瀏覽器使用麥克風' : '無法存取麥克風'
      onError?.(msg)
      handleClose()
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
    setModalState('recording')
    setSeconds(0)
    timerRef.current = window.setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [onError, handleClose])

  const handleStopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    setModalState('processing')
    clearTimer()
    await new Promise<void>((resolve) => { recorder.onstop = () => resolve(); recorder.stop() })
    stopStream()

    const chunks = chunksRef.current
    if (chunks.length === 0) { setModalState('idle'); return }

    const mimeType = recorder.mimeType || 'audio/webm'
    const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
    const blob = new Blob(chunks, { type: mimeType })
    chunksRef.current = []

    try {
      const text = (await transcribe(blob, `recording.${ext}`, lang || undefined)).trim()
      if (text) {
        setTranscript(text)
        setModalState('result')
      } else {
        setModalState('idle')
        onError?.('未能辨識語音，請靠近麥克風再試一次')
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '語音轉文字失敗'
      setModalState('idle')
      onError?.(msg)
    }
  }, [clearTimer, stopStream, lang, onError])

  const handleConfirm = useCallback(() => {
    const text = transcript.trim()
    if (text) onTranscript(text, true)
    handleClose()
  }, [transcript, onTranscript, handleClose])

  const handleRetry = useCallback(() => {
    setTranscript('')
    setModalState('idle')
  }, [])

  const selectLang = useCallback((value: string) => {
    setLang(value)
    setLangMenuOpen(false)
    try { localStorage.setItem(LANG_STORAGE_KEY, value) } catch { /* ignore */ }
  }, [])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const currentLang = LANG_OPTIONS.find((o) => o.value === lang) ?? LANG_OPTIONS[0]!

  return (
    <>
      {/* 工具列小按鈕 */}
      <button
        type="button"
        onClick={() => setModalState('idle')}
        disabled={disabled}
        aria-label="語音輸入"
        title="語音輸入"
        className={buttonClassName ?? 'rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50'}
      >
        <Mic className="h-5 w-5" />
      </button>

      {/* Modal */}
      {modalState !== 'closed' && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="presentation"
          onMouseDown={(e) => {
            // 點 overlay 且非 recording/processing 時關閉
            if (e.target === e.currentTarget && modalState !== 'recording' && modalState !== 'processing')
              handleClose()
          }}
        >
          <div
            className="relative flex w-full max-w-sm flex-col rounded-2xl bg-white shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="語音輸入"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* 關閉按鈕 */}
            {(modalState === 'idle' || modalState === 'result') && (
              <button
                type="button"
                onClick={handleClose}
                className="absolute right-4 top-4 rounded-full p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                aria-label="關閉"
              >
                <X className="h-5 w-5" />
              </button>
            )}

            <div className="flex flex-col items-center px-8 pb-8 pt-7">

              {/* ── IDLE：等待錄音 ── */}
              {modalState === 'idle' && (
                <>
                  <p className="mb-6 text-base font-medium text-gray-500">語音輸入</p>

                  {/* 語言選擇（widget 隱藏，固定自動偵測） */}
                  {!hideLangSelector && <div className="relative mb-8" ref={langMenuRef}>
                    <button
                      type="button"
                      onClick={() => setLangMenuOpen((o) => !o)}
                      className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-100"
                    >
                      <span>{currentLang.label}</span>
                      <span className="text-gray-400">·</span>
                      <span className="text-gray-400 text-xs">{currentLang.hint}</span>
                      <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                    </button>
                    {langMenuOpen && (
                      <div className="absolute left-1/2 top-full z-10 mt-2 w-52 -translate-x-1/2 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl">
                        {LANG_OPTIONS.map((o) => (
                          <button
                            key={o.value}
                            type="button"
                            onClick={() => selectLang(o.value)}
                            className={`flex w-full items-start gap-2 px-4 py-2.5 text-left transition-colors hover:bg-gray-50 ${lang === o.value ? 'text-[#1C3939]' : 'text-gray-700'}`}
                          >
                            <div>
                              <p className={`text-sm font-medium ${lang === o.value ? 'text-[#1C3939]' : ''}`}>{o.label}</p>
                              <p className="text-xs text-gray-400">{o.hint}</p>
                            </div>
                            {lang === o.value && (
                              <Check className="ml-auto mt-0.5 h-4 w-4 shrink-0 text-[#AE924C]" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>}

                  {/* 大麥克風按鈕 */}
                  <button
                    type="button"
                    onClick={() => void handleStartRecording()}
                    disabled={checkStatus !== undefined && speechStatus !== null && !speechStatus.enabled}
                    className="group relative flex h-28 w-28 items-center justify-center rounded-full bg-[#1C3939] shadow-lg transition-all hover:scale-105 hover:bg-[#163130] active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                    aria-label="開始錄音"
                  >
                    <Mic className="h-12 w-12 text-white" />
                  </button>
                  <p className="mt-5 text-sm text-gray-400">點按開始錄音</p>

                  {/* Provider badge */}
                  {speechStatus && (
                    <div className={`mt-4 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                      speechStatus.enabled
                        ? 'bg-gray-100 text-gray-500'
                        : 'bg-red-50 text-red-500'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${speechStatus.enabled ? 'bg-green-400' : 'bg-red-400'}`} />
                      {speechStatus.enabled
                        ? `${speechStatus.provider === 'openai' ? 'OpenAI Whisper' : '本機 Whisper'}`
                        : (speechStatus.reason ?? '語音服務未啟用')}
                    </div>
                  )}
                </>
              )}

              {/* ── RECORDING：錄音中 ── */}
              {modalState === 'recording' && (
                <>
                  <p className="mb-6 text-base font-medium text-gray-500">錄音中</p>

                  {/* 計時器 */}
                  <div className="mb-6 flex items-center gap-2">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-red-500">
                      <span className="inline-flex h-2.5 w-2.5 animate-ping rounded-full bg-red-400 opacity-75" />
                    </span>
                    <span className="font-mono text-2xl font-semibold tabular-nums text-gray-800">
                      {formatTime(seconds)}
                    </span>
                  </div>

                  {/* 波紋動畫 + 停止按鈕 */}
                  <div className="relative flex h-28 w-28 items-center justify-center">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-100" style={{ animationDuration: '1.4s' }} />
                    <span className="absolute inline-flex h-[85%] w-[85%] animate-ping rounded-full bg-red-100" style={{ animationDuration: '1.4s', animationDelay: '0.3s' }} />
                    <button
                      type="button"
                      onClick={() => void handleStopRecording()}
                      className="relative flex h-28 w-28 items-center justify-center rounded-full bg-red-500 shadow-lg transition-all hover:scale-105 hover:bg-red-600 active:scale-95"
                      aria-label="停止錄音"
                    >
                      <MicOff className="h-12 w-12 text-white" />
                    </button>
                  </div>
                  <p className="mt-5 text-sm text-gray-400">點按停止錄音</p>

                  <button
                    type="button"
                    onClick={handleClose}
                    className="mt-6 text-sm text-gray-400 underline-offset-2 hover:text-gray-600 hover:underline"
                  >
                    取消
                  </button>
                </>
              )}

              {/* ── PROCESSING：辨識中 ── */}
              {modalState === 'processing' && (
                <>
                  <p className="mb-6 text-base font-medium text-gray-500">語音辨識中</p>
                  <div className="flex h-28 w-28 items-center justify-center rounded-full bg-gray-100">
                    <Loader2 className="h-12 w-12 animate-spin text-[#1C3939]" />
                  </div>
                  <p className="mt-5 text-sm text-gray-400">請稍候…</p>
                </>
              )}

              {/* ── RESULT：辨識結果 ── */}
              {modalState === 'result' && (
                <>
                  <p className="mb-4 self-start text-base font-medium text-gray-500">辨識結果</p>

                  <textarea
                    ref={textareaRef}
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-base leading-relaxed text-gray-800 focus:border-[#1C3939] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#1C3939]"
                    placeholder="辨識結果…"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleConfirm()
                    }}
                  />
                  <p className="mt-1.5 self-start text-xs text-gray-400">可直接修改文字後確認，或重新錄音</p>

                  <div className="mt-6 flex w-full gap-3">
                    <button
                      type="button"
                      onClick={handleRetry}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      重新錄音
                    </button>
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={!transcript.trim()}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#AE924C] py-3 text-sm font-medium text-white transition-colors hover:bg-[#9a7e42] disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      使用此文字
                    </button>
                  </div>
                </>
              )}

            </div>
          </div>
        </div>
      )}
    </>
  )
}
