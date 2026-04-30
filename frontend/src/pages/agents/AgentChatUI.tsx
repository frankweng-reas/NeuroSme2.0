/** agent_id 為 chat 時使用：通用對話（ChatAgent），對話紀錄存 DB（chat_threads / chat_messages） */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import {
  ChevronRight,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  Paperclip,
  Search,
} from 'lucide-react'
import NsChat, { type NsChatMessage } from '@/components/NsChat'
import VoiceInput from '@/components/VoiceInput'
import { transcribeAudio, getSpeechStatus } from '@/api/speech'
import ErrorModal from '@/components/ErrorModal'
import HelpModal from '@/components/HelpModal'
import AgentHeader from '@/components/AgentHeader'
import LLMModelSelect from '@/components/LLMModelSelect'
import {
  appendChatMessage,
  createChatThread,
  deleteChatMessage,
  deleteChatThread,
  fetchChatThreadFileBlob,
  getLlmAttachmentReferenceText,
  listChatMessages,
  listChatThreads,
  listThreadFiles,
  patchChatMessage,
  patchChatThread,
  uploadChatMessageAttachments,
  type ChatMessageAttachmentMeta,
  type ChatMessageItem,
  type ChatThreadItem,
  type ThreadFileItem,
} from '@/api/chatThreads'
import { chatCompletionsStream } from '@/api/chat'
import { ApiError } from '@/api/client'
import { useToast } from '@/contexts/ToastContext'
import type { Agent } from '@/types'

const HISTORY_ROUNDS = 8
const STORAGE_KEY_PREFIX = 'agent-chat-ui'
const THREAD_SESSION_PREFIX = 'agent-chat-active-thread'
/** 與 backend CHAT_AGENT_REFERENCE_MAX_CHARS 對齊（約 32K context 之參考注入上限） */
const CHAT_REFERENCE_MAX_CHARS = 24_000
/** 與後端 chat_attachment_service.ATTACHMENT_CONTEXT_USER_ROUNDS 對齊 */
const ATTACHMENT_CONTEXT_USER_ROUNDS = 2 // 測試用；上線請與後端改回 5
/** 與 backend CHAT_ATTACH_MAX_BYTES 對齊（純文字） */
const CHAT_ATTACH_MAX_FILE_BYTES = 30 * 1024
/** 與 backend CHAT_ATTACH_PDF_MAX_BYTES 對齊 */
const CHAT_ATTACH_PDF_MAX_FILE_BYTES = 4 * 1024 * 1024
/** 與後端 persist_chat_uploads 拒絕單檔 ValueError 文案一致 */
const CHAT_ATTACH_TOO_LARGE_MESSAGE = '檔案過大，請節錄重點後再上傳。'
const CHAT_ATTACHMENT_EXT = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.tsv',
  '.log',
  '.text',
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
])
/** 與後端 CHAT_INLINE_IMAGE_MAX_BYTES 對齊（圖片附件單檔） */
const CHAT_ATTACH_IMAGE_MAX_FILE_BYTES = 4 * 1024 * 1024

function isChatAttachmentTooLargeApiError(e: unknown): boolean {
  if (!(e instanceof ApiError)) return false
  const d = e.detail?.trim() ?? ''
  return d === CHAT_ATTACH_TOO_LARGE_MESSAGE.trim() || d.includes('檔案過大')
}
/** 串流中助理訊息暫存列 id（非 DB） */
const CHAT_AGENT_STREAMING_MSG_ID = '__chat_agent_streaming__'
/** 側欄顯示用：首句濃縮為標題（不另呼叫 LLM） */
const CHAT_THREAD_TITLE_PLACEHOLDER = '（請參考附加檔案）'
const CHAT_THREAD_TITLE_MAX_LEN = 80

function suggestChatThreadTitle(userText: string, attachmentNames: string[]): string {
  const t = userText.trim()
  let core = t
  if (t === CHAT_THREAD_TITLE_PLACEHOLDER && attachmentNames.length > 0) {
    const names = attachmentNames
      .slice(0, 4)
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    core = names.join('、')
    if (attachmentNames.length > 4) core = `${core}…`
  }
  const firstLine = core.split(/\r?\n/)[0] ?? ''
  let out = firstLine.replace(/\s+/g, ' ').trim()
  if (!out) out = core.replace(/\s+/g, ' ').trim()
  if (!out) {
    out =
      attachmentNames.length > 0
        ? attachmentNames[0].replace(/\s+/g, ' ').trim() || '附件'
        : '新對話'
  }
  if (out.length > CHAT_THREAD_TITLE_MAX_LEN) {
    out = `${out.slice(0, CHAT_THREAD_TITLE_MAX_LEN - 1)}…`
  }
  return out
}

interface ChatAttachmentItem {
  id: string
  name: string
  /** 純文字附件；PDF 為空，改以上傳之二進位送後端擷取 */
  content: string
  sizeBytes?: number
  kind?: 'text' | 'pdf' | 'image'
  binary?: ArrayBuffer
  /** 圖片上傳時之 MIME，供 FormData */
  mimeType?: string
}

type AttachPanelFeedback = { text: string }

function attachmentExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i).toLowerCase() : ''
}

function isChatImageFile(file: File): boolean {
  const t = (file.type || '').toLowerCase()
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') {
    return true
  }
  const ext = attachmentExt(file.name)
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
}

function isPdfFile(file: File): boolean {
  return attachmentExt(file.name) === '.pdf' || (file.type || '').toLowerCase() === 'application/pdf'
}

function isChatAttachmentFileAllowed(file: File): boolean {
  if (isPdfFile(file)) return true
  if (isChatImageFile(file)) return true
  if (CHAT_ATTACHMENT_EXT.has(attachmentExt(file.name))) return true
  const t = (file.type || '').toLowerCase()
  if (t.startsWith('text/')) return true
  if (t === 'application/csv' || t === 'application/json') return true
  /** 無副檔名時：部分瀏覽器只給 octet-stream，仍允許嘗試以 UTF-8 讀取（PDF 須有 .pdf） */
  if (attachmentExt(file.name) === '' && (t === '' || t === 'application/octet-stream')) return true
  return false
}

async function readFileAsUtf8Text(file: File): Promise<string> {
  if (typeof file.text === 'function') {
    return file.text()
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
    r.onerror = () => reject(new Error('無法讀取檔案'))
    r.readAsText(file, 'UTF-8')
  })
}

/** 僅純文字：PDF／圖片由後端處理或占位，不併入前端 data 字串 */
function buildAttachmentPayload(items: ChatAttachmentItem[]): string {
  const textOnly = items.filter((a) => a.kind !== 'pdf' && a.kind !== 'image')
  if (textOnly.length === 0) return ''
  return textOnly.map((a) => `=== 檔案：${a.name} ===\n${a.content}`).join('\n\n')
}

/** 由後往前找最近一則帶 context_file_ids（含空陣列）之 user，供還原勾選與錨點比對 */
function lastContextFileIdsFromRows(rows: ChatMessageItem[]): string[] {
  const userMsgs = rows.filter((r) => r.role === 'user')
  for (let i = userMsgs.length - 1; i >= 0; i--) {
    const c = userMsgs[i]!.context_file_ids
    if (c != null) return c.map(String)
  }
  return []
}

function sortedIdsKey(ids: string[]): string {
  return [...ids].sort().join(',')
}

/** 若目前「最後一則 user」相對於錨點已超過 ATTACHMENT_CONTEXT_USER_ROUNDS，後端不再注入附檔參考 */
function isAttachmentWindowExpiredForLastUser(rows: ChatMessageItem[]): boolean {
  const userMsgs = rows.filter((r) => r.role === 'user')
  if (userMsgs.length === 0) return false
  const idxLast = userMsgs.length - 1
  let anchorIdx: number | null = null
  for (let i = idxLast; i >= 0; i--) {
    if (userMsgs[i]!.context_file_ids != null) {
      anchorIdx = i
      break
    }
  }
  if (anchorIdx === null) return false
  const rounds = idxLast - anchorIdx + 1
  return rounds > ATTACHMENT_CONTEXT_USER_ROUNDS
}

/** 載入／更新列表後：窗口已過期則清空勾選，避免與實際是否注入 LLM 不一致 */
function threadFileSelectionStateFromRows(rows: ChatMessageItem[]): { ids: string[]; key: string } {
  if (isAttachmentWindowExpiredForLastUser(rows)) {
    return { ids: [], key: '' }
  }
  const anchorIds = lastContextFileIdsFromRows(rows)
  return { ids: anchorIds, key: sortedIdsKey(anchorIds) }
}

interface AgentChatUIProps {
  agent: Agent
}

function storageKey(agentCompositeId: string) {
  return `${STORAGE_KEY_PREFIX}-${agentCompositeId}`
}

function threadSessionKey(agentCompositeId: string) {
  return `${THREAD_SESSION_PREFIX}-${agentCompositeId}`
}

function isImageAttachmentMeta(a: ChatMessageAttachmentMeta): boolean {
  const t = (a.content_type || '').toLowerCase()
  if (t === 'image/jpeg' || t === 'image/png' || t === 'image/webp' || t === 'image/gif') return true
  const ext = attachmentExt(a.original_filename)
  return ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)
}

/** 側欄與搜尋：與列表顯示標題一致 */
function chatThreadSidebarLabel(t: ChatThreadItem): string {
  if (t.title?.trim()) return t.title.trim()
  const d = t.last_message_at || t.updated_at
  try {
    const date = new Date(d)
    return `對話 ${date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
  } catch {
    return '新對話'
  }
}

function mapApiMessagesToNs(rows: ChatMessageItem[]): NsChatMessage[] {
  return rows
    .filter((r) => r.role === 'user' || r.role === 'assistant')
    .map((r) => {
      let content = r.content
      const att = r.attachments ?? []
      if (r.role === 'user' && att.length > 0) {
        const nonImg = att.filter((a) => !isImageAttachmentMeta(a))
        if (nonImg.length > 0) {
          content = `${content}\n\n（附件：${nonImg.map((a) => a.original_filename).join('、')}）`
        }
      }
      const meta =
        r.role === 'assistant' && r.llm_meta?.model
          ? {
              model: r.llm_meta.model ?? '',
              usage:
                r.llm_meta.prompt_tokens != null
                  ? {
                      prompt_tokens: r.llm_meta.prompt_tokens ?? 0,
                      completion_tokens: r.llm_meta.completion_tokens ?? 0,
                      total_tokens: r.llm_meta.total_tokens ?? 0,
                    }
                  : null,
              finish_reason: null,
            }
          : undefined
      return {
        id: r.id,
        role: r.role as 'user' | 'assistant',
        content,
        attachments: att.length > 0 ? att : undefined,
        meta,
      }
    })
}

export default function AgentChatUI({ agent }: AgentChatUIProps) {
  const { showToast } = useToast()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [threads, setThreads] = useState<ChatThreadItem[]>([])
  const [threadsLoading, setThreadsLoading] = useState(true)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [messages, setMessages] = useState<NsChatMessage[]>([])
  const [model, setModel] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey(agent.id))
      if (!raw) return ''
      const parsed = JSON.parse(raw) as { model?: string }
      return typeof parsed.model === 'string' && parsed.model ? parsed.model : ''
    } catch {
      return ''
    }
  })
  const [isLoading, setIsLoading] = useState(false)
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null)
  const threadMenuWrapRef = useRef<HTMLLIElement | null>(null)
  const [renameTarget, setRenameTarget] = useState<ChatThreadItem | null>(null)
  const [renameTitleDraft, setRenameTitleDraft] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)
  const [threadFilesModalOpen, setThreadFilesModalOpen] = useState(false)
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState('')
  const threadSearchInputRef = useRef<HTMLInputElement>(null)
  const [chatAttachments, setChatAttachments] = useState<ChatAttachmentItem[]>([])
  const [threadFiles, setThreadFiles] = useState<ThreadFileItem[]>([])
  const [selectedThreadFileIds, setSelectedThreadFileIds] = useState<string[]>([])
  const [attachPanelFeedback, setAttachPanelFeedback] = useState<AttachPanelFeedback | null>(null)
  const [errorModal, setErrorModal] = useState<{ title: string; message: string } | null>(null)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const [voiceAutoSendText, setVoiceAutoSendText] = useState('')
  const [showHelpModal, setShowHelpModal] = useState(false)
  const chatFileInputRef = useRef<HTMLInputElement>(null)
  const attachFileOpIdRef = useRef(0)
  /** stored_file id → 預覽用 object URL（對話內圖片附件） */
  const [attachmentBlobUrls, setAttachmentBlobUrls] = useState<Record<string, string>>({})
  /** 與上一則成功寫入後端之錨點一致時，新訊息可省略 context_file_ids（沿用窗口） */
  const lastCommittedAnchorKeyRef = useRef<string>('')
  /** 防雙擊送出：在 React state 尚未把 isLoading 設為 true 前即擋下第二則送出（含 POST→上傳→PATCH 與串流整段） */
  const userTurnLockRef = useRef(false)
  /** 與 chatAttachments 同步，避免在 setState updater 內做副作用（Strict Mode 會 double-invoke updater 導致重複 toast） */
  const chatAttachmentsRef = useRef<ChatAttachmentItem[]>([])

  useEffect(() => {
    chatAttachmentsRef.current = chatAttachments
  }, [chatAttachments])

  const dismissErrorModal = useCallback(() => setErrorModal(null), [])
  const showErrorModal = useCallback((message: string, title = '發生錯誤') => {
    setErrorModal({ title, message })
  }, [])

  const userImageAttachmentKey = useMemo(() => {
    return messages
      .filter((m) => m.role === 'user' && m.attachments?.some(isImageAttachmentMeta))
      .map(
        (m) =>
          `${m.id ?? ''}:${[...(m.attachments ?? [])].filter(isImageAttachmentMeta).map((a) => a.file_id).sort().join(',')}`
      )
      .sort()
      .join('|')
  }, [messages])

  useEffect(() => {
    if (!selectedThreadId) {
      setAttachmentBlobUrls((prev) => {
        for (const u of Object.values(prev)) {
          try {
            URL.revokeObjectURL(u)
          } catch {
            /* ignore */
          }
        }
        return {}
      })
      return
    }
    const ids = new Set<string>()
    for (const m of messages) {
      if (m.role !== 'user' || !m.attachments) continue
      for (const a of m.attachments) {
        if (isImageAttachmentMeta(a)) ids.add(a.file_id)
      }
    }
    const idList = [...ids]
    if (idList.length === 0) {
      setAttachmentBlobUrls((prev) => {
        for (const u of Object.values(prev)) {
          try {
            URL.revokeObjectURL(u)
          } catch {
            /* ignore */
          }
        }
        return {}
      })
      return
    }

    let cancelled = false
    ;(async () => {
      const next: Record<string, string> = {}
      try {
        for (const fid of idList) {
          if (cancelled) return
          const blob = await fetchChatThreadFileBlob(selectedThreadId, fid)
          if (cancelled) return
          next[fid] = URL.createObjectURL(blob)
        }
      } catch {
        if (!cancelled) {
          setAttachmentBlobUrls((prev) => {
            for (const u of Object.values(prev)) {
              try {
                URL.revokeObjectURL(u)
              } catch {
                /* ignore */
              }
            }
            return {}
          })
        }
        return
      }
      if (cancelled) {
        for (const u of Object.values(next)) {
          try {
            URL.revokeObjectURL(u)
          } catch {
            /* ignore */
          }
        }
        return
      }
      setAttachmentBlobUrls((prev) => {
        for (const u of Object.values(prev)) {
          try {
            URL.revokeObjectURL(u)
          } catch {
            /* ignore */
          }
        }
        return next
      })
    })()
    return () => {
      cancelled = true
    }
  }, [selectedThreadId, userImageAttachmentKey])

  useEffect(() => {
    if (!attachPanelFeedback) return
    const t = window.setTimeout(() => setAttachPanelFeedback(null), 12_000)
    return () => window.clearTimeout(t)
  }, [attachPanelFeedback])

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true)
    setThreadsError(null)
    try {
      const list = await listChatThreads(agent.id)
      setThreads(list)
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '無法載入對話列表'
      setThreadsError(msg)
      setThreads([])
    } finally {
      setThreadsLoading(false)
    }
  }, [agent.id])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(threadSessionKey(agent.id))
      if (saved) setSelectedThreadId(saved)
    } catch {
      /* ignore */
    }
  }, [agent.id])

  useEffect(() => {
    if (!selectedThreadId) return
    try {
      sessionStorage.setItem(threadSessionKey(agent.id), selectedThreadId)
    } catch {
      /* ignore */
    }
  }, [agent.id, selectedThreadId])

  useEffect(() => {
    setThreadFilesModalOpen(false)
    if (!selectedThreadId) {
      setMessages([])
      setThreadFiles([])
      setSelectedThreadFileIds([])
      lastCommittedAnchorKeyRef.current = ''
      return
    }
    let cancelled = false
    setMessagesLoading(true)
    Promise.all([listChatMessages(selectedThreadId), listThreadFiles(selectedThreadId)])
      .then(([rows, files]) => {
        if (!cancelled) {
          setMessages(mapApiMessagesToNs(rows))
          setThreadFiles(files)
          const tfState = threadFileSelectionStateFromRows(rows)
          setSelectedThreadFileIds(tfState.ids)
          lastCommittedAnchorKeyRef.current = tfState.key
          setChatAttachments([])
          setAttachPanelFeedback(null)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessages([])
          showErrorModal('無法載入此對話的訊息，請重新整理或稍後再試。', '載入失敗')
        }
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedThreadId, showErrorModal])

  useEffect(() => {
    if (!selectedThreadId || threads.length === 0) return
    if (!threads.some((t) => t.id === selectedThreadId)) {
      setSelectedThreadId(null)
      try {
        sessionStorage.removeItem(threadSessionKey(agent.id))
      } catch {
        /* ignore */
      }
    }
  }, [threads, selectedThreadId, agent.id])

  useEffect(() => {
    if (!threadMenuId) return
    const onDocMouseDown = (e: MouseEvent) => {
      const el = threadMenuWrapRef.current
      if (el && !el.contains(e.target as Node)) setThreadMenuId(null)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [threadMenuId])

  useEffect(() => {
    if (!renameTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRenameTarget(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [renameTarget])

  useEffect(() => {
    if (!threadFilesModalOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThreadFilesModalOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [threadFilesModalOpen])

  useEffect(() => {
    if (!threadSearchOpen) return
    const t = window.setTimeout(() => threadSearchInputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [threadSearchOpen])

  const displayedThreads = useMemo(() => {
    const q = threadSearchQuery.trim().toLowerCase()
    if (!q) return threads
    return threads.filter((t) => chatThreadSidebarLabel(t).toLowerCase().includes(q))
  }, [threads, threadSearchQuery])

  const persistModel = useCallback(
    (m: string) => {
      setModel(m)
      try {
        localStorage.setItem(storageKey(agent.id), JSON.stringify({ model: m }))
      } catch {
        /* ignore */
      }
    },
    [agent.id]
  )

  /** 不切換 DB：只清空選取，下一則送出時再自動建立新 thread */
  const handleStartFreshConversation = useCallback(() => {
    setSelectedThreadId(null)
    setMessages([])
    setThreadFiles([])
    setSelectedThreadFileIds([])
    lastCommittedAnchorKeyRef.current = ''
    setChatAttachments([])
    setAttachPanelFeedback(null)
    try {
      sessionStorage.removeItem(threadSessionKey(agent.id))
    } catch {
      /* ignore */
    }
  }, [agent.id])

  const handleSelectThread = useCallback((id: string) => {
    setThreadMenuId(null)
    setSelectedThreadId((prev) => {
      if (prev !== null && prev !== id) {
        setThreadFiles([])
        setSelectedThreadFileIds([])
        lastCommittedAnchorKeyRef.current = ''
        setChatAttachments([])
        setAttachPanelFeedback(null)
      }
      return id
    })
  }, [])

  const removeChatAttachment = useCallback((id: string) => {
    setChatAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const toggleThreadFileSelection = useCallback((fileId: string) => {
    setSelectedThreadFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((x) => x !== fileId) : [...prev, fileId]
    )
  }, [])

  const pickChatAttachments = useCallback(() => {
    try {
      chatFileInputRef.current?.click()
    } catch {
      showErrorModal(
        '無法開啟檔案選擇視窗。請檢查瀏覽器是否阻擋快顯視窗，或重新開啟本視窗再試。',
        '無法選擇檔案'
      )
    }
  }, [showErrorModal])

  const onChatFileInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const inputEl = e.target
      const opId = ++attachFileOpIdRef.current
      /** 須先拷貝再清空 value，否則部分瀏覽器會讓 FileList 失效，導致加不進列表 */
      const files = inputEl.files?.length ? Array.from(inputEl.files) : []
      inputEl.value = ''
      if (!files.length) return

      const additions: ChatAttachmentItem[] = []
      try {
        for (const file of files) {
          if (!isChatAttachmentFileAllowed(file)) {
            const msg = `無法加入「${file.name}」：僅支援純文字、PDF、或圖片（JPEG／PNG／WebP／GIF）。Word 請勿用此上傳。`
            showErrorModal(msg, '無法加入附件')
            return
          }
          const id =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `${Date.now()}-${Math.random().toString(36).slice(2)}`
          const name = file.name || '(未命名)'
          if (isPdfFile(file)) {
            if (file.size > CHAT_ATTACH_PDF_MAX_FILE_BYTES) {
              showErrorModal(CHAT_ATTACH_TOO_LARGE_MESSAGE, '無法加入附件')
              return
            }
            const binary = await file.arrayBuffer()
            additions.push({ id, name, content: '', kind: 'pdf', binary, sizeBytes: file.size })
            continue
          }
          if (isChatImageFile(file)) {
            if (file.size > CHAT_ATTACH_IMAGE_MAX_FILE_BYTES) {
              showErrorModal('圖片超過 4MB，請壓縮後再上傳。', '無法加入附件')
              return
            }
            const binary = await file.arrayBuffer()
            additions.push({
              id,
              name,
              content: '',
              kind: 'image',
              binary,
              sizeBytes: file.size,
              mimeType: (file.type || 'application/octet-stream').toLowerCase(),
            })
            continue
          }
          if (file.size > CHAT_ATTACH_MAX_FILE_BYTES) {
            showErrorModal(CHAT_ATTACH_TOO_LARGE_MESSAGE, '無法加入附件')
            return
          }
          const content = await readFileAsUtf8Text(file)
          additions.push({ id, name, content, kind: 'text', sizeBytes: file.size })
        }

        if (opId !== attachFileOpIdRef.current) return

        const namesJoined = additions.map((a) => a.name).join('、')
        const prev = chatAttachmentsRef.current
        const merged = [...prev, ...additions]
        const payload = buildAttachmentPayload(merged)
        if (payload.length > CHAT_REFERENCE_MAX_CHARS) {
          showErrorModal(
            `合計超過 ${CHAT_REFERENCE_MAX_CHARS.toLocaleString()} 字元，請刪除部分檔案或縮短內容後再試。`,
            '附加內容過長'
          )
          return
        }
        setChatAttachments(merged)
        setAttachPanelFeedback(null)
        showToast(`已加入：${namesJoined}`)
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : typeof err === 'string' ? err : '讀取檔案時發生錯誤'
        showErrorModal(msg, '讀取檔案失敗')
      }
    },
    [showErrorModal, showToast]
  )

  const openRenameThread = useCallback((t: ChatThreadItem) => {
    setThreadMenuId(null)
    setRenameTarget(t)
    setRenameTitleDraft(t.title?.trim() ?? '')
  }, [])

  const submitRenameThread = useCallback(async () => {
    if (!renameTarget || renameSaving) return
    setRenameSaving(true)
    try {
      const title = renameTitleDraft.trim() || null
      const updated = await patchChatThread(renameTarget.id, { title })
      setThreads((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
      setRenameTarget(null)
      showToast('已更新名稱')
    } catch (e) {
      const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '更新失敗'
      showErrorModal(msg, '無法更新名稱')
    } finally {
      setRenameSaving(false)
    }
  }, [renameTarget, renameSaving, renameTitleDraft, showToast, showErrorModal])

  const handleDeleteThreadById = useCallback(
    async (tid: string) => {
      if (isLoading) return
      if (!window.confirm('確定刪除此對話？訊息將一併刪除且無法復原。')) return
      setThreadMenuId(null)
      try {
        await deleteChatThread(tid)
        if (selectedThreadId === tid) {
          setSelectedThreadId(null)
          setMessages([])
          setThreadFiles([])
          setSelectedThreadFileIds([])
          lastCommittedAnchorKeyRef.current = ''
          setChatAttachments([])
          setAttachPanelFeedback(null)
          try {
            sessionStorage.removeItem(threadSessionKey(agent.id))
          } catch {
            /* ignore */
          }
        }
        setThreads((prev) => prev.filter((t) => t.id !== tid))
        showToast('已刪除對話')
      } catch (e) {
        const msg = e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '刪除失敗'
        showErrorModal(msg, '無法刪除對話')
      }
    },
    [agent.id, isLoading, selectedThreadId, showToast, showErrorModal]
  )

  /** 以最後一則為 user 的 DB 列為準，呼叫 LLM 並 append assistant（內含錯誤時寫入錯誤助理訊息） */
  const completeAssistantAfterUserMessage = useCallback(
    async (
      threadId: string,
      rowsWithTrailingUser: ChatMessageItem[],
      /** 本輪要送 LLM 的 user 訊息 id（通常即列表最後一則 user） */
      userMessageId: string
    ) => {
      const hist = rowsWithTrailingUser
        .filter((r) => r.role === 'user' || r.role === 'assistant')
        .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
      if (hist.length === 0 || hist[hist.length - 1].role !== 'user') return

      const prior = hist.slice(0, -1).slice(-(HISTORY_ROUNDS * 2))
      const content = hist[hist.length - 1].content

      let data = ''
      try {
        data = (await getLlmAttachmentReferenceText(threadId, userMessageId)).trim()
      } catch (e) {
        const msg =
          e instanceof ApiError
            ? e.detail ?? e.message
            : e instanceof Error
              ? e.message
              : '無法載入附件參考'
        showErrorModal(String(msg).trim() || '無法載入附件參考', '無法載入附件內容')
        return
      }

      const traceId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', id: CHAT_AGENT_STREAMING_MSG_ID, streaming: true },
      ])

      const streamReq = {
        agent_id: agent.id,
        project_id: '',
        prompt_type: 'chat_agent',
        chat_thread_id: threadId,
        trace_id: traceId,
        user_message_id: userMessageId,
        system_prompt: '',
        user_prompt: '',
        data,
        model,
        messages: prior,
        content,
      }

      await chatCompletionsStream(streamReq, {
        onDelta: (text) => {
          setMessages((prev) => {
            const next = [...prev]
            const idx = next.findIndex((m) => m.id === CHAT_AGENT_STREAMING_MSG_ID)
            if (idx < 0) return prev
            const cur = next[idx]!
            next[idx] = { ...cur, content: cur.content + text, streaming: true }
            return next
          })
        },
        onDone: async (done) => {
          try {
            await appendChatMessage(threadId, {
              role: 'assistant',
              content: done.content ?? '',
              ...(done.llm_request_id ? { llm_request_id: done.llm_request_id } : {}),
            })
            const finalRows = await listChatMessages(threadId)
            setMessages(
              mapApiMessagesToNs(finalRows).map((m, i, arr) => {
                if (m.role !== 'assistant' || i !== arr.length - 1) return m
                // 串流即時值包含 finish_reason，優先用；DB 值作備援
                return {
                  ...m,
                  meta: {
                    model: done.model ?? m.meta?.model ?? '',
                    usage: done.usage ?? m.meta?.usage ?? null,
                    finish_reason: done.finish_reason ?? null,
                  },
                }
              })
            )
          } catch (e) {
            setMessages((prev) => prev.filter((m) => m.id !== CHAT_AGENT_STREAMING_MSG_ID))
            const raw =
              e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '儲存助理訊息失敗'
            const msg =
              typeof raw === 'string' && raw.trim() ? raw.trim() : '儲存助理訊息失敗（無詳細說明）'
            showErrorModal(msg, '儲存失敗')
            try {
              await appendChatMessage(threadId, { role: 'assistant', content: `錯誤：${msg}` })
              const finalRows = await listChatMessages(threadId)
              setMessages(mapApiMessagesToNs(finalRows))
            } catch {
              /* ignore */
            }
          }
        },
        onError: async (message) => {
          const safe =
            typeof message === 'string' && message.trim()
              ? message.trim()
              : '未知錯誤（無詳細說明）。若為台智雲，請檢查後端日誌或改為較短提問／較小參考內容。'
          setMessages((prev) => prev.filter((m) => m.id !== CHAT_AGENT_STREAMING_MSG_ID))
          try {
            await appendChatMessage(threadId, { role: 'assistant', content: `錯誤：${safe}` })
            const finalRows = await listChatMessages(threadId)
            setMessages(mapApiMessagesToNs(finalRows))
          } catch {
            showErrorModal(safe, '儲存失敗')
          }
        },
      })
    },
    [agent.id, model, showErrorModal]
  )

  const handleRetryLastAssistant = useCallback(async () => {
    if (!selectedThreadId || isLoading || !model.trim()) return
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.id) return

    const threadId = selectedThreadId
    const assistantMessageId = last.id
    setIsLoading(true)
    try {
      await deleteChatMessage(threadId, assistantMessageId)
      const rowsAfterDelete = await listChatMessages(threadId)
      setMessages(mapApiMessagesToNs(rowsAfterDelete))
      const tail = rowsAfterDelete.filter((r) => r.role === 'user' || r.role === 'assistant')
      if (tail.length === 0 || tail[tail.length - 1].role !== 'user') {
        showErrorModal('無法再試一次：對話順序異常。', '再試一次失敗')
        return
      }
      const lastUser = tail[tail.length - 1]!
      await completeAssistantAfterUserMessage(threadId, rowsAfterDelete, lastUser.id)
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '再試一次失敗'
      showErrorModal(msg, '再試一次失敗')
    } finally {
      setIsLoading(false)
      loadThreads()
    }
  }, [
    selectedThreadId,
    isLoading,
    model,
    messages,
    completeAssistantAfterUserMessage,
    loadThreads,
    showErrorModal,
  ])

  const handleSubmit = useCallback(
    async (text: string) => {
      const filesSnapshot = chatAttachments.map((a) => {
        if (a.kind === 'pdf' && a.binary) {
          return { name: a.name, blob: new Blob([a.binary], { type: 'application/pdf' }) }
        }
        if (a.kind === 'image' && a.binary) {
          return {
            name: a.name,
            blob: new Blob([a.binary], { type: a.mimeType || 'application/octet-stream' }),
          }
        }
        return { name: a.name, content: a.content }
      })
      const trimmedInput = text.trim()
      const trimmed =
        trimmedInput ||
        (filesSnapshot.length > 0 || selectedThreadFileIds.length > 0 ? CHAT_THREAD_TITLE_PLACEHOLDER : '')
      if (!trimmed || isLoading || !model.trim()) return
      if (userTurnLockRef.current) return

      const priorThreadId = selectedThreadId
      const priorHadTitle =
        priorThreadId != null &&
        Boolean(threads.find((x) => x.id === priorThreadId)?.title?.trim())
      const shouldSuggestTitle = !priorHadTitle

      let threadId = selectedThreadId
      userTurnLockRef.current = true
      setIsLoading(true)
      try {
        if (!threadId) {
          const t = await createChatThread({ agent_id: agent.id, title: null })
          threadId = t.id
          setThreads((prev) => [t, ...prev])
          setSelectedThreadId(t.id)
        }

        const selectionKey = sortedIdsKey(selectedThreadFileIds)
        const selectionChanged = selectionKey !== lastCommittedAnchorKeyRef.current
        const hasLocal = filesSnapshot.length > 0
        const explicitAnchor = hasLocal || selectionChanged

        const postBody: {
          role: string
          content: string
          context_file_ids?: string[]
        } = { role: 'user', content: trimmed }
        if (explicitAnchor) {
          postBody.context_file_ids = [...selectedThreadFileIds]
        }

        const userRow = await appendChatMessage(threadId, postBody)
        if (!userRow?.id) {
          throw new Error('伺服器未回傳訊息 id，無法上傳附件')
        }
        if (filesSnapshot.length > 0) {
          await uploadChatMessageAttachments(threadId, userRow.id, filesSnapshot)
        }

        let rowsAfterUser = await listChatMessages(threadId)
        if (filesSnapshot.length > 0) {
          const selfRow = rowsAfterUser.find((r) => r.id === userRow.id)
          const attIds = (selfRow?.attachments ?? []).map((a) => a.file_id)
          const finalContextIds = [...new Set([...selectedThreadFileIds.map(String), ...attIds])].sort()
          await patchChatMessage(threadId, userRow.id, { context_file_ids: finalContextIds })
          rowsAfterUser = await listChatMessages(threadId)
        }

        setMessages(mapApiMessagesToNs(rowsAfterUser))
        const tfAfter = threadFileSelectionStateFromRows(rowsAfterUser)
        setSelectedThreadFileIds(tfAfter.ids)
        lastCommittedAnchorKeyRef.current = tfAfter.key

        void listThreadFiles(threadId)
          .then(setThreadFiles)
          .catch(() => {
            /* 列表為加分項 */
          })

        const userMsgCount = rowsAfterUser.filter((r) => r.role === 'user').length
        if (shouldSuggestTitle && threadId && userMsgCount === 1) {
          const attachmentNames = [
            ...filesSnapshot.map((f) => f.name),
            ...selectedThreadFileIds
              .map((id) => threadFiles.find((tf) => tf.file_id === id)?.original_filename)
              .filter((x): x is string => Boolean(x)),
          ]
          const suggested = suggestChatThreadTitle(trimmed, attachmentNames)
          try {
            const updated = await patchChatThread(threadId, { title: suggested })
            setThreads((prev) => {
              const i = prev.findIndex((x) => x.id === threadId)
              if (i === -1) return [updated, ...prev]
              const next = [...prev]
              next[i] = updated
              return next
            })
          } catch {
            /* 標題為加分項，失敗不阻斷對話 */
          }
        }

        await completeAssistantAfterUserMessage(threadId, rowsAfterUser, userRow.id)
        setChatAttachments([])
        setAttachPanelFeedback(null)
      } catch (e) {
        const msg =
          e instanceof ApiError ? e.detail ?? e.message : e instanceof Error ? e.message : '發生錯誤'
        const title = isChatAttachmentTooLargeApiError(e) ? '無法加入附件' : '發生錯誤'
        showErrorModal(msg, title)
      } finally {
        userTurnLockRef.current = false
        setIsLoading(false)
        loadThreads()
      }
    },
    [
      agent.id,
      isLoading,
      model,
      selectedThreadId,
      loadThreads,
      completeAssistantAfterUserMessage,
      showErrorModal,
      chatAttachments,
      selectedThreadFileIds,
      threadFiles,
      threads,
    ]
  )

  const chatComposerAbove = useMemo(() => {
    if (!attachPanelFeedback && chatAttachments.length === 0) return undefined
    return (
      <>
        {attachPanelFeedback ? (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-900 ring-1 ring-red-200"
          >
            {attachPanelFeedback.text}
          </p>
        ) : null}
        {chatAttachments.length > 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-gray-700">
                與本則一併送出（{chatAttachments.length} 個檔）
              </span>
              <button
                type="button"
                className="text-sm font-medium text-amber-800 underline-offset-2 hover:underline"
                onClick={() => {
                  setChatAttachments([])
                  setAttachPanelFeedback(null)
                }}
              >
                全部清除
              </button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {chatAttachments.map((a) => (
                <li
                  key={a.id}
                  className="flex max-w-full items-center gap-1 rounded-md bg-white px-2 py-1 text-sm text-gray-800 ring-1 ring-gray-200"
                >
                  <span className="truncate" title={a.name}>
                    {a.name}
                  </span>
                  <span className="shrink-0 text-gray-500">
                    （
                    {a.kind === 'pdf'
                      ? `PDF · ${(a.sizeBytes ?? 0).toLocaleString()} bytes`
                      : a.kind === 'image'
                        ? `圖片 · ${(a.sizeBytes ?? 0).toLocaleString()} bytes`
                        : a.content.length > 0
                          ? `約 ${a.content.length.toLocaleString()} 字`
                          : `約 ${(a.sizeBytes ?? 0).toLocaleString()} bytes`}
                    ）
                  </span>
                  <button
                    type="button"
                    className="shrink-0 rounded px-1 text-gray-500 hover:bg-gray-100 hover:text-red-600"
                    aria-label={`移除 ${a.name}`}
                    onClick={() => removeChatAttachment(a.id)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </>
    )
  }, [attachPanelFeedback, chatAttachments, removeChatAttachment])

  const chatComposerLeading = useMemo(
    () => (
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative">
          <button
            type="button"
            onClick={pickChatAttachments}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            aria-label={
              chatAttachments.length > 0 ? `附加檔案，已選 ${chatAttachments.length} 個` : '附加檔案'
            }
            title="純文字檔約 30KB；PDF／圖片單檔約 4MB。圖片與其他附件一併儲存，對話中可預覽；餵給模型時僅附檔名與占位說明（不送圖素）。"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          {chatAttachments.length > 0 ? (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-600 px-1 text-[11px] font-semibold text-white">
              {chatAttachments.length > 99 ? '99+' : chatAttachments.length}
            </span>
          ) : null}
        </div>
        {selectedThreadId != null ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setThreadFilesModalOpen(true)}
              disabled={isLoading || threadFiles.length === 0}
              className="rounded-lg border border-gray-300 bg-white p-2 text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
              aria-label={
                selectedThreadFileIds.length > 0
                  ? `本對話檔案，已勾選 ${selectedThreadFileIds.length} 個`
                  : '本對話已出現的檔案'
              }
              title={
                threadFiles.length === 0
                  ? '尚無可引用的對話檔案（先於對話中上傳附件後會出現在此）'
                  : `選擇本對話曾出現的檔案：勾選後與本輪一併餵給模型；變更選取會重新起算 ${ATTACHMENT_CONTEXT_USER_ROUNDS} 次 user 發言窗口。`
              }
            >
              <FolderOpen className="h-5 w-5" />
            </button>
            {selectedThreadFileIds.length > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-emerald-600 px-1 text-[11px] font-semibold text-white">
                {selectedThreadFileIds.length > 99 ? '99+' : selectedThreadFileIds.length}
              </span>
            ) : null}
          </div>
        ) : null}
        <VoiceInput
          transcribe={(blob, filename, lang) =>
            transcribeAudio(blob, filename, lang).then((r) => r.text)
          }
          checkStatus={getSpeechStatus}
          onTranscript={(text, autoSend) => {
            if (autoSend) {
              setVoiceAutoSendText(text)
              setTimeout(() => setVoiceAutoSendText(''), 50)
            } else {
              setVoiceTranscript(text)
              // NsChat 消費後重設，讓下次語音仍可觸發 useEffect
              setTimeout(() => setVoiceTranscript(''), 50)
            }
          }}
          onError={(msg) => showErrorModal(msg, '語音輸入失敗')}
          disabled={isLoading}
        />
      </div>
    ),
    [
      chatAttachments.length,
      isLoading,
      pickChatAttachments,
      selectedThreadFileIds.length,
      selectedThreadId,
      threadFiles.length,
      showErrorModal,
    ]
  )

  return (
    <div className="relative flex h-full flex-col p-4 text-[18px]">
      <ErrorModal
        open={errorModal != null}
        title={errorModal?.title}
        message={errorModal?.message ?? ''}
        onClose={dismissErrorModal}
      />
      {threadFilesModalOpen && selectedThreadId != null ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setThreadFilesModalOpen(false)
          }}
        >
          <div
            className="flex max-h-[min(32rem,85vh)] w-full max-w-lg flex-col rounded-xl border border-gray-200 bg-white shadow-xl"
            role="dialog"
            aria-labelledby="thread-files-modal-title"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="shrink-0 border-b border-gray-100 px-5 py-4">
              <h2 id="thread-files-modal-title" className="text-lg font-semibold text-gray-900">
                本對話已出現的檔
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">
                勾選的檔案將作為附件，有效 {ATTACHMENT_CONTEXT_USER_ROUNDS} 輪對話。
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
              {threadFiles.length === 0 ? (
                <p className="text-sm text-gray-500">尚無可引用的檔案，請先上傳附件。</p>
              ) : (
                <ul className="space-y-2.5">
                  {threadFiles.map((f) => {
                    const checked = selectedThreadFileIds.includes(f.file_id)
                    return (
                      <li key={f.file_id} className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          id={`thread-file-modal-${f.file_id}`}
                          className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                          checked={checked}
                          disabled={isLoading}
                          onChange={() => toggleThreadFileSelection(f.file_id)}
                        />
                        <label
                          htmlFor={`thread-file-modal-${f.file_id}`}
                          className="min-w-0 cursor-pointer text-[15px] leading-snug text-gray-800"
                        >
                          <span className="font-medium break-words">{f.original_filename}</span>
                          <span className="ml-1.5 text-gray-500">
                            （{f.size_bytes.toLocaleString()} bytes）
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-gray-100 px-5 py-4">
              <button
                type="button"
                className="rounded-lg bg-gray-900 px-4 py-2 text-[15px] font-medium text-white transition-colors hover:bg-gray-800"
                onClick={() => setThreadFilesModalOpen(false)}
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {renameTarget != null && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/45 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setRenameTarget(null)
          }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-white/20 bg-[#1C3939] p-5 shadow-xl"
            role="dialog"
            aria-labelledby="rename-thread-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="rename-thread-title" className="text-lg font-medium text-white">
              重新命名對話
            </h2>
            <input
              type="text"
              value={renameTitleDraft}
              onChange={(e) => setRenameTitleDraft(e.target.value)}
              maxLength={512}
              className="mt-4 w-full rounded-lg border border-white/25 bg-white/10 px-3 py-2.5 text-base text-white placeholder:text-white/40 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
              placeholder="留白則恢復為預設時間標題"
              autoFocus
              onKeyDown={(e) => {
                // IME 組字時 Enter 用來確認選字，不可當成送出
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitRenameThread()
              }}
            />
            <p className="mt-2 text-xs text-white/55">名稱會顯示在左側列表；清空並儲存可改回預設日期顯示。</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={renameSaving}
                className="rounded-lg px-4 py-2 text-base text-white/85 transition-colors hover:bg-white/10 disabled:opacity-50"
                onClick={() => setRenameTarget(null)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={renameSaving}
                className="rounded-lg bg-[#AE924C] px-4 py-2 text-base font-medium text-white transition-colors hover:bg-[#9a7e42] disabled:opacity-50"
                onClick={() => void submitRenameThread()}
              >
                {renameSaving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}
      <AgentHeader agent={agent} headerBackgroundColor="#1C3939" onOnlineHelpClick={() => setShowHelpModal(true)} />

      <div className="mt-4 flex min-h-0 flex-1 gap-4 overflow-hidden">
        <div
          className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-300/50 shadow-md transition-[width] duration-200 ${
            sidebarCollapsed ? 'w-12' : 'w-96'
          }`}
          style={{ backgroundColor: '#1C3939' }}
        >
          <div
            className={`flex shrink-0 items-center justify-between border-b border-gray-300/50 py-2.5 ${
              sidebarCollapsed ? 'px-2' : 'pl-6 pr-3'
            }`}
          >
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                className="flex items-center justify-center rounded-2xl p-1.5 text-white/80 transition-colors hover:bg-white/10"
                title="展開對話列表"
                aria-label="展開對話列表"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            ) : (
              <div className="flex w-full min-w-0 justify-end pr-1">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="shrink-0 rounded-2xl px-1.5 py-1 text-white/80 transition-colors hover:bg-white/10"
                  title="折疊"
                  aria-label="折疊"
                >
                  {'<<'}
                </button>
              </div>
            )}
          </div>
          {!sidebarCollapsed && (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="shrink-0 space-y-1.5">
                  <button
                    type="button"
                    onClick={handleStartFreshConversation}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                      selectedThreadId === null
                        ? 'bg-[#AE924C] font-medium text-white'
                        : 'text-white hover:bg-[#AE924C]/10'
                    }`}
                  >
                    <MessageSquarePlus className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                    新對話
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setThreadSearchOpen((open) => {
                        if (open) setThreadSearchQuery('')
                        return !open
                      })
                    }}
                    aria-expanded={threadSearchOpen}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-base transition-colors ${
                      threadSearchOpen
                        ? 'bg-white/12 text-white'
                        : 'text-white hover:bg-[#AE924C]/10'
                    }`}
                  >
                    <Search className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
                    搜尋對話
                  </button>
                  {threadSearchOpen ? (
                    <input
                      ref={threadSearchInputRef}
                      type="search"
                      value={threadSearchQuery}
                      onChange={(e) => setThreadSearchQuery(e.target.value)}
                      placeholder="依標題搜尋…"
                      aria-label="篩選對話標題"
                      autoComplete="off"
                      className="w-full rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-[15px] text-white placeholder:text-white/40 focus:border-[#AE924C] focus:outline-none focus:ring-1 focus:ring-[#AE924C]"
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
                          setThreadSearchOpen(false)
                          setThreadSearchQuery('')
                        }
                      }}
                    />
                  ) : null}
                </div>
                <div
                  className="my-3 h-px shrink-0 bg-white/25"
                  role="separator"
                  aria-hidden="true"
                />
                <p className="shrink-0 text-base font-medium text-gray-300">你的對話</p>
                <div
                  className="mt-2 mb-3 h-px shrink-0 bg-white/25"
                  role="separator"
                  aria-hidden="true"
                />
                {threadsLoading ? (
                  <p className="text-base text-[#AE924C]/80">載入中…</p>
                ) : threadsError ? (
                  <p className="text-base text-red-300">{threadsError}</p>
                ) : (
                  <>
                    {threads.length === 0 ? (
                      <p className="text-base leading-relaxed text-white/85">
                        尚無紀錄。在右側輸入並送出後，會<strong className="font-semibold">自動</strong>建立一則對話並儲存。
                      </p>
                    ) : displayedThreads.length === 0 ? (
                      <p className="text-base leading-relaxed text-white/75">找不到符合的對話。</p>
                    ) : (
                      <ul className="space-y-2">
                        {displayedThreads.map((t) => (
                          <li
                            key={t.id}
                            className="relative"
                            ref={threadMenuId === t.id ? threadMenuWrapRef : undefined}
                          >
                            <div
                              className={`flex min-w-0 items-stretch rounded-lg transition-colors ${
                                selectedThreadId === t.id
                                  ? 'bg-[#AE924C] font-medium text-white'
                                  : 'text-white hover:bg-[#AE924C]/10'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => handleSelectThread(t.id)}
                                className="min-w-0 flex-1 px-2 py-2 text-left text-base"
                              >
                                <span className="line-clamp-2">{chatThreadSidebarLabel(t)}</span>
                              </button>
                              <button
                                type="button"
                                className="shrink-0 px-1.5 text-white/90 transition-colors hover:text-white"
                                aria-label="對話選項"
                                title="對話選項"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setThreadMenuId((id) => (id === t.id ? null : t.id))
                                }}
                              >
                                <MoreHorizontal className="h-5 w-5" />
                              </button>
                            </div>
                            {threadMenuId === t.id && (
                              <div
                                className="absolute right-0 top-full z-30 mt-1 min-w-[9rem] rounded-lg border border-white/15 bg-[#163130] py-1 shadow-lg"
                                role="menu"
                              >
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full px-3 py-2 text-left text-[15px] text-white/95 hover:bg-white/10"
                                  onClick={() => openRenameThread(t)}
                                >
                                  重新命名…
                                </button>
                                <button
                                  type="button"
                                  role="menuitem"
                                  className="flex w-full px-3 py-2 text-left text-[15px] text-red-300 hover:bg-white/10"
                                  onClick={() => void handleDeleteThreadById(t.id)}
                                >
                                  刪除
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-md ring-1 ring-gray-200/50">
          <input
            ref={chatFileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".txt,.md,.csv,.json,.tsv,.log,.text,.pdf,.jpg,.jpeg,.png,.webp,.gif,text/plain,application/pdf,text/csv,application/json,image/jpeg,image/png,image/webp,image/gif"
            onChange={(e) => void onChatFileInputChange(e)}
          />
          {messagesLoading ? (
            <div className="flex flex-1 items-center justify-center text-gray-500">載入訊息…</div>
          ) : (
            <NsChat
              embedded
              messages={messages}
              onSubmit={handleSubmit}
              allowSubmitEmptyInput={
                chatAttachments.length > 0 || selectedThreadFileIds.length > 0
              }
              isLoading={isLoading}
              emptyPlaceholder="輸入訊息開始你的對話，可附加純文字、PDF 或圖片。"
              emptyStateTop={
                selectedThreadId === null ? (
                  <img
                    src="/chatbot_icon.png"
                    alt=""
                    role="presentation"
                    draggable={false}
                    className="pointer-events-none h-auto max-h-full w-auto max-w-full select-none object-contain"
                  />
                ) : undefined
              }
              inputPlaceholder="輸入訊息…"
              composerAboveForm={chatComposerAbove}
              composerLeading={chatComposerLeading}
              appendInputText={voiceTranscript}
              appendAndSendText={voiceAutoSendText}
              attachmentBlobUrls={attachmentBlobUrls}
              onCopySuccess={() => showToast('已複製到剪貼簿')}
              onCopyError={() =>
                showErrorModal('無法複製到剪貼簿，請手動選取文字或檢查瀏覽器權限。', '複製失敗')
              }
              onRetryLastAssistant={selectedThreadId ? handleRetryLastAssistant : undefined}
              submitDisabled={!model.trim()}
              submitDisabledTitle="請在管理後台設定租戶 LLM 與可選模型"
              headerActions={
                <div className="flex w-full min-w-0 flex-wrap items-center justify-start gap-2">
                  <LLMModelSelect value={model} onChange={persistModel} compact labelPosition="inline" />
                </div>
              }
            />
          )}
        </div>
      </div>
      <HelpModal
        open={showHelpModal}
        onClose={() => setShowHelpModal(false)}
        url="/help-chat-agent.md"
        title="通用對話助理使用說明"
      />
    </div>
  )
}
