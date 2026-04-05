import { create } from 'zustand'
import { Message, ConversationMeta, ChatChunk } from '@shared/ipc-types'
import { nanoid } from 'nanoid'
import { buildToolHintPrefix } from '../constants/tools'

// ── Token batching — accumulate tokens and flush once per animation frame ────
// Calling set() on every token triggers a full React re-render; batching
// reduces it to ~60 renders/sec regardless of how fast tokens arrive.
let _tokenBuffer  = ''
let _rafHandle:   number | null = null
let _flushFn:     (() => void) | null = null

function scheduleFlush(): void {
  if (_rafHandle !== null) return
  _rafHandle = requestAnimationFrame(() => {
    _rafHandle = null
    if (_flushFn && _tokenBuffer) {
      _flushFn()
      _tokenBuffer = ''
    }
  })
}

interface ChatState {
  // Conversations
  conversations:       ConversationMeta[]
  activeConversationId: string | null

  // Messages for the active conversation
  messages:  Message[]
  isLoading: boolean
  isThinking: boolean   // LLM is reasoning (before first token)

  // Streaming buffer
  streamingContent: string

  // Tool selection (user hint — 'auto' when empty)
  selectedTools: string[]
  setSelectedTools: (tools: string[]) => void

  // Actions
  newConversation: ()                                   => string
  setActiveConversation: (id: string)                   => Promise<void>
  sendMessage: (text: string)                          => Promise<void>
  cancelMessage: ()                                    => Promise<void>
  appendChunk: (chunk: ChatChunk)                      => void
  loadHistory: ()                                       => Promise<void>
  deleteConversation: (id: string)                     => Promise<void>
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations:        [],
  activeConversationId: null,
  messages:             [],
  isLoading:            false,
  isThinking:           false,
  streamingContent:     '',
  selectedTools:        [],

  setSelectedTools: (tools) => set({ selectedTools: tools }),

  // ── Create a new blank conversation ────────────────────────────────────────
  newConversation: () => {
    // Reset token batch state for the new conversation
    _tokenBuffer = ''
    _flushFn     = null
    if (_rafHandle !== null) { cancelAnimationFrame(_rafHandle); _rafHandle = null }
    const id = nanoid()
    set({
      activeConversationId: id,
      messages:             [],
      streamingContent:     '',
      isLoading:            false,
      isThinking:           false,
    })
    // Refresh sidebar so the just-finished conversation appears immediately
    window.electronAPI.listHistory().then(conversations => set({ conversations })).catch(() => {})
    return id
  },

  // ── Cancel / stop the active agent turn ──────────────────────────────────────────────
  cancelMessage: async () => {
    await window.electronAPI.cancelMessage()
    // Clear batch state so the next sendMessage starts fresh
    if (_rafHandle !== null) { cancelAnimationFrame(_rafHandle); _rafHandle = null }
    _tokenBuffer = ''
    _flushFn     = null
    const { streamingContent } = get()
    set(s => {
      if (!s.isLoading) return s
      const partialMsg: Message = {
        id:        `${Date.now()}-assistant`,
        role:      'assistant',
        content:   streamingContent ? `${streamingContent}\n\n*[Stopped]*` : '*[Stopped]*',
        createdAt: new Date().toISOString(),
      }
      return {
        ...s,
        messages:         [...s.messages, partialMsg],
        isLoading:        false,
        isThinking:       false,
        streamingContent: '',
      }
    })
  },

  // ── Load an existing conversation from history ──────────────────────────────
  setActiveConversation: async (id: string) => {
    const messages = await window.electronAPI.getHistory(id)
    set({ activeConversationId: id, messages, streamingContent: '' })
  },

  // ── Send a user message ─────────────────────────────────────────────────────
  sendMessage: async (text: string) => {
    // Always start a new turn with a clean token-batch slate so stale state
    // from the previous turn (e.g. a late final chunk) never silently breaks
    // the next response's streaming.
    if (_rafHandle !== null) { cancelAnimationFrame(_rafHandle); _rafHandle = null }
    _tokenBuffer = ''
    _flushFn     = null

    const { activeConversationId, newConversation, selectedTools } = get()
    const convId = activeConversationId ?? newConversation()

    const userMsg: Message = {
      id:        nanoid(),
      role:      'user',
      content:   text,   // show original text in UI (without the hint prefix)
      createdAt: new Date().toISOString(),
    }

    set(s => ({
      messages:         [...s.messages, userMsg],
      isLoading:        true,
      isThinking:       true,
      streamingContent: '',
    }))

    // Register streaming listener BEFORE invoke so we don't miss early chunks
    const cleanup = window.electronAPI.onChatChunk((chunk) => {
      get().appendChunk(chunk)
    })

    // Prepend tool-hint prefix so the agent renders it in the system context,
    // but also pass the raw list for IPC so the main process can log/act on it.
    const hintPrefix = buildToolHintPrefix(selectedTools)
    const messageWithHint = hintPrefix + text

    try {
      await window.electronAPI.sendMessage({
        message:       messageWithHint,
        conversationId: convId,
        toolHints:     selectedTools.length > 0 ? selectedTools : undefined,
      })
    } finally {
      // Keep the listener alive briefly so any in-flight chunks (especially
      // 'final') that are still in the IPC queue can be processed before we
      // tear down.  After the micro-task queue drains, remove the listener and
      // ensure the input is always unlocked regardless of chunk ordering.
      await new Promise<void>(r => setTimeout(r, 80))
      cleanup()
      // If appendChunk('final'/'error') already ran, isLoading is false — skip.
      // If the final chunk was still lost, commit whatever was buffered.
      set(s => {
        if (!s.isLoading) return s
        const content = s.streamingContent || '(no response received)'
        const assistantMsg: Message = {
          id:        nanoid(),
          role:      'assistant',
          content,
          createdAt: new Date().toISOString(),
        }
        return {
          ...s,
          messages:         [...s.messages, assistantMsg],
          isLoading:        false,
          isThinking:       false,
          streamingContent: '',
        }
      })
      // Refresh sidebar so this conversation's title appears without needing to click New Chat
      window.electronAPI.listHistory().then(conversations => set({ conversations })).catch(() => {})
    }
  },

  // ── Handle a streamed chunk ─────────────────────────────────────────────────
  appendChunk: (chunk: ChatChunk) => {
    if (chunk.type === 'token') {
      // Register flush function once
      if (!_flushFn) {
        _flushFn = () => {
          const captured = _tokenBuffer
          set(s => ({
            isThinking:       false,
            streamingContent: s.streamingContent + captured,
          }))
        }
      }
      _tokenBuffer += chunk.content
      scheduleFlush()
      return
    }

    if (chunk.type === 'tool_call') {
      const toolMsg: Message = {
        id:        nanoid(),
        role:      'tool',
        content:   `Calling tool: **${chunk.toolName}**\n${chunk.content}`,
        toolName:  chunk.toolName,
        createdAt: new Date().toISOString(),
      }
      set(s => ({ messages: [...s.messages, toolMsg], isThinking: true }))
    }

    if (chunk.type === 'final' || chunk.type === 'error') {
      // Flush any buffered tokens before committing the final message
      if (_rafHandle !== null) {
        cancelAnimationFrame(_rafHandle)
        _rafHandle = null
      }
      if (_tokenBuffer) {
        set(s => ({ streamingContent: s.streamingContent + _tokenBuffer }))
        _tokenBuffer = ''
      }
      _flushFn = null

      const { streamingContent } = get()
      // Use streamingContent if tokens streamed in real-time; fall back to
      // chunk.content (= fullReply from agent) when no delta events fired.
      const assistantMsg: Message = {
        id:        nanoid(),
        role:      'assistant',
        content:   chunk.type === 'error' ? `⚠️ ${chunk.content}` : (streamingContent || chunk.content),
        createdAt: new Date().toISOString(),
      }
      set(s => ({
        messages:         [...s.messages, assistantMsg],
        isLoading:        false,
        isThinking:       false,
        streamingContent: '',
      }))
    }
  },

  // ── Load conversation list ──────────────────────────────────────────────────
  loadHistory: async () => {
    const conversations = await window.electronAPI.listHistory()
    set({ conversations })
  },

  // ── Delete a conversation ───────────────────────────────────────────────────
  deleteConversation: async (id: string) => {
    await window.electronAPI.deleteHistory(id)
    const { activeConversationId, newConversation } = get()
    if (activeConversationId === id) newConversation()
    await get().loadHistory()
  },
}))
