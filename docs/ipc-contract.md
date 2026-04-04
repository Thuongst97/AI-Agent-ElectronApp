# IPC Contract

All renderer ↔ main communication is defined in `src/shared/ipc-types.ts`. This file is imported by **main, preload, and renderer** — it is the single source of truth.

---

## Transport Rules

- Renderer→Main requests use `ipcRenderer.invoke()` (request/response)
- Main→Renderer push events use `win.webContents.send()` / `ipcRenderer.on()` (one-way streaming)
- No raw `ipcRenderer` is exposed to the renderer — all calls go through `window.electronAPI` (contextBridge)

---

## Channel Reference

### Chat

#### `chat:send` — `invoke(ChatRequest) → void`

Initiates a streamed agent response. Response chunks arrive via `chat:chunk` pushes.

**Request:**

```typescript
interface ChatRequest {
  message: string // user message text
  conversationId: string // UUID for the current conversation
}
```

**Side effects:** streams `ChatChunk` events back via `chat:chunk`

---

#### `chat:chunk` — `on → ChatChunk` (push, renderer listens)

Receives one chunk per event. Renderer assembles the full response from the sequence.

```typescript
interface ChatChunk {
  type: 'token' | 'tool_call' | 'tool_result' | 'final' | 'error'
  content: string
  toolName?: string // present when type is 'tool_call' or 'tool_result'
}
```

| `type`        | Meaning                                                  |
| ------------- | -------------------------------------------------------- |
| `token`       | Partial streamed text — append to last assistant message |
| `tool_call`   | Agent is invoking a tool — show tool call card           |
| `tool_result` | Tool returned a result — show result card                |
| `final`       | Stream is complete — set `isLoading = false`             |
| `error`       | An error occurred — display error message                |

---

#### `chat:reset` — `invoke(conversationId: string) → void`

Clears the in-memory sliding window for the given conversation. Does **not** delete the persisted history.

---

### Conversation History

#### `history:list` — `invoke() → ConversationMeta[]`

Returns all stored conversations, sorted newest-first.

```typescript
interface ConversationMeta {
  id: string
  title: string // first user message, truncated
  createdAt: string // ISO 8601
  messageCount: number
}
```

---

#### `history:get` — `invoke(id: string) → Message[]`

Returns all messages for a specific conversation.

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: string
  toolName?: string
}
```

---

#### `history:delete` — `invoke(id: string) → void`

Permanently deletes a conversation (removes JSON file from disk).

---

### Settings

#### `settings:get` — `invoke() → AppSettings`

Returns current app settings. The `githubToken` field is always returned as `"__masked__"` — the real value is never exposed to the renderer.

```typescript
interface AppSettings {
  githubToken: string // always "__masked__" in renderer
  llmBaseUrl: string
  llmModel: string
  llmMaxTokens: number
  llmTemperature: number
  chromaHost: string
  chromaPort: number
  theme: 'light' | 'dark' | 'system'
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
```

---

#### `settings:set` — `invoke(Partial<AppSettings>) → void`

Persists updated settings. If `githubToken` equals `"__masked__"`, the existing stored token is preserved (not overwritten).

**Side effects:**

- Rebuilds the LangChain `ChatOpenAI` client
- Re-probes LLM connection

---

### Data Ingestion

#### `data:ingest` — `invoke(filePath: string) → IngestResult`

Reads a CSV or JSON requirements file, generates embeddings, and upserts them into the vector store.

```typescript
interface IngestResult {
  success: boolean
  inserted: number
  skipped: number // duplicates (already in DB by ID)
  errors: string[]
}
```

---

### Status

#### `status:get` — `invoke() → AppStatus`

Re-probes both external services and returns their current state.

```typescript
type ConnectionState = 'connected' | 'disconnected' | 'error'

interface AppStatus {
  llm: ConnectionState // GitHub Copilot endpoint
  chromadb: ConnectionState // ChromaDB / Vectra
  version: string // app version from package.json
}
```

---

### Window Controls

Exposed separately as `window.windowControls` (one-way sends, no response):

| Method       | IPC channel       | Description             |
| ------------ | ----------------- | ----------------------- |
| `minimize()` | `window:minimize` | Minimize window         |
| `maximize()` | `window:maximize` | Toggle maximize/restore |
| `close()`    | `window:close`    | Close window            |

---

## Token Security

The GitHub token security model:

```
Renderer            Preload / Main           Disk
────────            ──────────────           ────
"__masked__"  ←──  SettingsService  ──►  safeStorage.encryptString(token)
                         │
"__masked__"  ──►  if token === "__masked__": skip write (keep existing)
                   else: safeStorage.encryptString(newToken)
```

`safeStorage` uses OS-level encryption (DPAPI on Windows, Keychain on macOS, libsecret on Linux).

---

## Full TypeScript Type Source

See [`src/shared/ipc-types.ts`](../src/shared/ipc-types.ts) for the authoritative type definitions.
