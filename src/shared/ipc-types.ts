// ─────────────────────────────────────────────────────────────────────────────
// Shared IPC contract — imported by main, preload AND renderer.
// Keep this file free of Node.js-only or browser-only imports.
// ─────────────────────────────────────────────────────────────────────────────

// ── Channel names ────────────────────────────────────────────────────────────
export const IPC = {
  // Chat
  CHAT_SEND:       'chat:send',       // invoke(ChatRequest)  → void (streams via CHAT_CHUNK)
  CHAT_CHUNK:      'chat:chunk',      // on     → ChatChunk
  CHAT_RESET:      'chat:reset',      // invoke()             → void
  CHAT_CANCEL:     'chat:cancel',     // invoke()             → void (abort current turn)

  // Conversation history
  HISTORY_LIST:    'history:list',    // invoke()             → ConversationMeta[]
  HISTORY_GET:     'history:get',     // invoke(id: string)   → Message[]
  HISTORY_DELETE:  'history:delete',  // invoke(id: string)   → void

  // Settings
  SETTINGS_GET:    'settings:get',    // invoke()             → AppSettings
  SETTINGS_SET:    'settings:set',    // invoke(Partial<AppSettings>) → void

  // Data ingestion
  DATA_INGEST:     'data:ingest',     // invoke(filePath: string) → IngestResult

  // Status
  STATUS_GET:      'status:get',      // invoke()             → AppStatus
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/**
 * Sentinel value returned to the renderer when a GitHub token is stored but
 * should never be exposed.  The renderer treats any non-empty token as "saved";
 * sending this value back on save tells SettingsService "keep the existing token".
 */
export const TOKEN_MASKED = '__masked__'

// ── Chat ─────────────────────────────────────────────────────────────────────

export interface ChatRequest {
  message:        string
  conversationId: string
  /** Tool names the user has hinted — agent will prefer these but is not restricted. */
  toolHints?:     string[]
}

export type ChatChunkType =
  | 'token'        // partial streamed text from LLM
  | 'tool_call'    // LLM decided to call a tool
  | 'tool_result'  // tool execution finished
  | 'final'        // full assembled reply (also marks end of stream)
  | 'error'        // something went wrong

export interface ChatChunk {
  type:      ChatChunkType
  content:   string
  toolName?: string   // present when type === 'tool_call' | 'tool_result'
}

// ── Messages ──────────────────────────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool'

export interface Message {
  id:        string
  role:      MessageRole
  content:   string
  toolName?: string
  createdAt: string  // ISO-8601
}

// ── Conversation ──────────────────────────────────────────────────────────────

export interface ConversationMeta {
  id:           string
  title:        string
  createdAt:    string
  messageCount: number
}

// ── Settings ──────────────────────────────────────────────────────────────────

/** Per-skill configuration stored in AppSettings. */
export interface SkillConfig {
  enabled:           boolean
  /** Custom instruction text; if empty, the built-in default is used. */
  customInstruction: string
}

export interface AppSettings {
  githubToken:     string
  copilotModel:    string
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | null
  chromaHost:      string
  chromaPort:      number
  theme:           'light' | 'dark' | 'system'
  logLevel:        'debug' | 'info' | 'warn' | 'error'
  // Jira integration
  jiraDomain:      string   // e.g. "mycompany.atlassian.net"
  jiraEmail:       string
  jiraToken:       string
  // Agent skills
  skills:          Record<string, SkillConfig>
}

export const DEFAULT_SETTINGS: AppSettings = {
  githubToken:     '',
  copilotModel:    'gpt-4o',
  reasoningEffort: null,
  chromaHost:      'localhost',
  chromaPort:      8000,
  theme:           'system',
  logLevel:        'info',
  jiraDomain:      '',
  jiraEmail:       '',
  jiraToken:       '',
  skills:          {},
}

// ── Data ingest ───────────────────────────────────────────────────────────────

export interface IngestResult {
  success:  boolean
  inserted: number
  skipped:  number
  errors:   string[]
}

// ── App status ────────────────────────────────────────────────────────────────

export type ConnectionState = 'connected' | 'disconnected' | 'error'

export interface AppStatus {
  llm:     ConnectionState
  chromadb: ConnectionState
  version: string
}

// ── Electron API surface (exposed via contextBridge) ─────────────────────────
// This interface is declared here so both preload (implements it)
// and renderer (consumes window.electronAPI) share the same type.

export interface ElectronAPI {
  // Chat
  sendMessage:   (req: ChatRequest) => Promise<void>
  onChatChunk:   (cb: (chunk: ChatChunk) => void) => () => void
  resetChat:     (conversationId: string) => Promise<void>
  cancelMessage: () => Promise<void>

  // History
  listHistory:   ()              => Promise<ConversationMeta[]>
  getHistory:    (id: string)    => Promise<Message[]>
  deleteHistory: (id: string)    => Promise<void>

  // Settings
  getSettings: ()                          => Promise<AppSettings>
  setSettings: (s: Partial<AppSettings>)   => Promise<void>

  // Data
  ingestData: (filePath: string) => Promise<IngestResult>

  // Status
  getStatus: () => Promise<AppStatus>
}

// Extend the global Window type so TypeScript knows about window.electronAPI
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
