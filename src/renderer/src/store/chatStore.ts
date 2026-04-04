import { create } from 'zustand'
import { Message, ConversationMeta, ChatChunk } from '@shared/ipc-types'
import { nanoid } from 'nanoid'

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

  // Actions
  newConversation: ()                                   => string
  setActiveConversation: (id: string)                   => Promise<void>
  sendMessage: (text: string)                          => Promise<void>
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

  // ── Create a new blank conversation ────────────────────────────────────────
  newConversation: () => {
    const id = nanoid()
    set({
      activeConversationId: id,
      messages:             [],
      streamingContent:     '',
      isLoading:            false,
      isThinking:           false,
    })
    return id
  },

  // ── Load an existing conversation from history ──────────────────────────────
  setActiveConversation: async (id: string) => {
    const messages = await window.electronAPI.getHistory(id)
    set({ activeConversationId: id, messages, streamingContent: '' })
  },

  // ── Send a user message ─────────────────────────────────────────────────────
  sendMessage: async (text: string) => {
    const { activeConversationId, newConversation } = get()
    const convId = activeConversationId ?? newConversation()

    const userMsg: Message = {
      id:        nanoid(),
      role:      'user',
      content:   text,
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

    try {
      await window.electronAPI.sendMessage({ message: text, conversationId: convId })
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
    }
  },

  // ── Handle a streamed chunk ─────────────────────────────────────────────────
  appendChunk: (chunk: ChatChunk) => {
    if (chunk.type === 'token') {
      set(s => ({
        isThinking:       false,
        streamingContent: s.streamingContent + chunk.content,
      }))
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
