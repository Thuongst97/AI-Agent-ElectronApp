# AI Agent Electron App — Implementation Plan

> TypeScript · Electron · React · LangChain.js · ChromaDB

---

## 1. Overview & Goals

Port the **Mimi AI Agent** (Python / Streamlit) into a native cross-platform
desktop application built with **Electron + TypeScript**.

| Capability      | Python (current)               | Electron (target)                       |
| --------------- | ------------------------------ | --------------------------------------- |
| UI              | Streamlit (browser tab)        | React SPA inside Electron window        |
| LLM backend     | GitHub Copilot SDK / LangChain | LangChain.js / OpenAI SDK (Node)        |
| Vector DB       | ChromaDB (Python)              | ChromaDB HTTP client or `chromadb` npm  |
| Tools / skills  | Python `@tool` decorators      | TypeScript tool classes                 |
| Packaging       | PyInstaller `.exe`             | `electron-builder` (NSIS installer)     |
| Offline support | bundled ONNX model             | bundled ONNX via `@xenova/transformers` |

---

## 2. Tech Stack

### Core Runtime

| Layer    | Choice                                     | Reason                                         |
| -------- | ------------------------------------------ | ---------------------------------------------- |
| Shell    | **Electron 30+**                           | Cross-platform native window, Node.js in main  |
| Language | **TypeScript 5** (strict)                  | Full type safety, same language both processes |
| Bundler  | **Vite 5** (renderer) + **esbuild** (main) | Fast HMR in dev, small bundles in prod         |

### AI / Agent

| Layer      | Choice                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------ |
| LLM client | `@langchain/openai` (OpenAI-compatible, targets GitHub Copilot endpoint)                                     |
| Agent loop | LangChain.js `AgentExecutor` with tool-calling                                                               |
| Embeddings | `@xenova/transformers` — `all-MiniLM-L6-v2` (runs fully offline in Node)                                     |
| Vector DB  | `chromadb` npm package (HTTP client → local ChromaDB server) **or** `vectra` (pure JS, zero-server fallback) |
| Memory     | `BufferWindowMemory` (LangChain) for conversation history                                                    |

### UI

| Layer     | Choice                                      |
| --------- | ------------------------------------------- |
| Framework | **React 18**                                |
| Styling   | **Tailwind CSS 3** + `shadcn/ui` components |
| State     | **Zustand** (lightweight, no boilerplate)   |
| Markdown  | `react-markdown` + `rehype-highlight`       |

### Tooling

| Purpose     | Tool                                                     |
| ----------- | -------------------------------------------------------- |
| Linting     | ESLint + `@typescript-eslint`                            |
| Formatting  | Prettier                                                 |
| Testing     | Vitest (unit) + Playwright (e2e)                         |
| Packaging   | `electron-builder`                                       |
| Env secrets | `dotenv` (main process only — never exposed to renderer) |

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────┐
│                    ELECTRON SHELL                      │
│                                                        │
│  ┌─────────────────────┐    ┌───────────────────────┐  │
│  │   RENDERER PROCESS   │    │    MAIN PROCESS        │  │
│  │  (React + Tailwind)  │    │  (Node.js + Agent)     │  │
│  │                     │    │                        │  │
│  │  ChatView            │◄──►│  AgentService          │  │
│  │  HistoryPanel        │IPC │  ToolRegistry          │  │
│  │  SettingsView        │    │  VectorMemoryService    │  │
│  │  StatusBar           │    │  LLMService (Copilot)   │  │
│  └─────────────────────┘    │  IpcHandler            │  │
│                              └───────────────────────┘  │
│                                        │                │
│                              ┌─────────▼─────────┐      │
│                              │  LOCAL STORAGE     │      │
│                              │  chroma_data/      │      │
│                              │  app_config.json   │      │
│                              │  conversation_log/ │      │
│                              └───────────────────┘      │
└────────────────────────────────────────────────────────┘
```

### Process Roles

**Main Process** (`src/main/`)

- Owns all Node.js APIs, file system, env vars, secrets
- Hosts the entire Agent core (LLM, tools, vector DB)
- Exposes typed IPC channels to renderer
- Manages app lifecycle (tray icon, auto-update)

**Preload Script** (`src/preload/`)

- The security bridge between renderer and main
- Exposes a **narrow, typed** `window.electronAPI` surface via `contextBridge`
- No raw Node APIs leak into the renderer

**Renderer Process** (`src/renderer/`)

- Pure React UI — zero Node.js, zero direct LLM calls
- Communicates exclusively via `window.electronAPI`

---

## 4. Folder Structure

```
AI-Agent-ElectronApp/
├── electron-builder.yml          # Packaging config
├── package.json
├── tsconfig.json                  # Shared base TS config
├── tsconfig.main.json             # Main process override
├── tsconfig.renderer.json         # Renderer process override
├── vite.config.ts                 # Renderer Vite config
├── .env.example
│
├── src/
│   ├── main/                      # Node.js / Electron main process
│   │   ├── index.ts               # App entry: BrowserWindow, lifecycle
│   │   ├── ipc/
│   │   │   └── handler.ts         # Registers all ipcMain.handle() channels
│   │   ├── agent/
│   │   │   ├── AgentService.ts    # Orchestrates the tool-calling loop
│   │   │   ├── LLMService.ts      # Wraps LangChain ChatOpenAI (Copilot endpoint)
│   │   │   ├── MemoryService.ts   # BufferWindowMemory + conversation persistence
│   │   │   ├── SemanticGate.ts    # Intent validation before tool dispatch
│   │   │   ├── ToolRegistry.ts    # Registers & resolves tools by name
│   │   │   └── tools/
│   │   │       ├── BaseTool.ts    # Abstract base class
│   │   │       ├── SearchRequirementsTool.ts
│   │   │       ├── GetRequirementDetailsTool.ts
│   │   │       ├── GenerateTestsTool.ts
│   │   │       ├── ListAssigneesTool.ts
│   │   │       └── LogAnalyzerTool.ts
│   │   ├── data/
│   │   │   ├── VectorMemoryService.ts  # ChromaDB CRUD + similarity search
│   │   │   └── DataIngester.ts         # Ingests CSV / JSON requirements
│   │   └── utils/
│   │       ├── logger.ts
│   │       └── config.ts         # Reads .env + persisted settings
│   │
│   ├── preload/
│   │   └── index.ts              # contextBridge — exposes window.electronAPI
│   │
│   └── renderer/                  # React SPA
│       ├── index.html
│       ├── main.tsx               # React root mount
│       ├── App.tsx
│       ├── store/
│       │   ├── chatStore.ts       # Zustand — messages, streaming state
│       │   └── settingsStore.ts
│       ├── views/
│       │   ├── ChatView.tsx
│       │   ├── HistoryView.tsx
│       │   └── SettingsView.tsx
│       ├── components/
│       │   ├── MessageBubble.tsx
│       │   ├── InputBar.tsx
│       │   ├── ThinkingIndicator.tsx
│       │   ├── ToolCallBadge.tsx
│       │   └── StatusBar.tsx
│       └── styles/
│           └── globals.css        # Tailwind base + custom tokens
│
├── resources/
│   ├── icon.ico
│   ├── icon.icns
│   └── icon.png
│
├── data/
│   └── requirements/              # Seed CSV/JSON files
│       ├── core_system_requirement.csv
│       └── tele_application_requirement.csv
│
└── tests/
    ├── unit/
    │   ├── AgentService.test.ts
    │   └── VectorMemoryService.test.ts
    └── e2e/
        └── chat.spec.ts
```

---

## 5. IPC Contract

All renderer ↔ main communication goes through strongly typed channels defined
in a shared `src/shared/ipc-types.ts` file.

```typescript
// src/shared/ipc-types.ts

export interface ChatRequest {
  message: string
  conversationId: string
}

export interface ChatChunk {
  // streaming token
  type: 'token' | 'tool_call' | 'tool_result' | 'final' | 'error'
  content: string
  toolName?: string
}

export interface ConversationMeta {
  id: string
  title: string
  createdAt: string
  messageCount: number
}

// Channels
export const IPC = {
  CHAT_SEND: 'chat:send', // invoke → ChatRequest
  CHAT_STREAM: 'chat:stream', // on     → ChatChunk
  CHAT_RESET: 'chat:reset', // invoke
  HISTORY_LIST: 'history:list', // invoke → ConversationMeta[]
  HISTORY_GET: 'history:get', // invoke(id) → Message[]
  SETTINGS_GET: 'settings:get', // invoke → AppSettings
  SETTINGS_SET: 'settings:set', // invoke(partial) → void
  INGEST_DATA: 'data:ingest', // invoke(filePath) → IngestResult
} as const
```

---

## 6. Agent Core Design

### 6.1 AgentService — Tool-Calling Loop

```
User message
     │
     ▼
SemanticGate.validate()          ← checks completeness, domain, params
     │ PASS
     ▼
MemoryService.buildHistory()     ← last N turns formatted for LLM
     │
     ▼
LLMService.chat(messages, tools) ← streams tokens + may emit tool_call
     │
     ├── tool_call?  YES → ToolRegistry.run(name, args)
     │                         → ToolMessage appended to history
     │                         → loop back to LLMService
     │
     └── final text → stream to renderer via IPC + persist in MemoryService
```

### 6.2 LLMService

```typescript
// Targets GitHub Copilot OpenAI-compatible endpoint
const llm = new ChatOpenAI({
  modelName: 'gpt-4o',
  openAIApiKey: process.env.GITHUB_TOKEN,
  configuration: {
    baseURL: 'https://models.inference.ai.azure.com',
  },
  streaming: true,
})
```

### 6.3 VectorMemoryService

Uses `chromadb` npm package. On first run (or when `chroma_data/` is absent)
it auto-ingests the CSV files via `DataIngester`. Falls back to **Vectra**
(pure-JS in-process vector store) if ChromaDB server is unavailable.

```
startup
  └─ ChromaDB HTTP available?
       YES → use PersistentClient via HTTP (port 8000)
       NO  → spawn bundled ChromaDB binary  OR  fall back to Vectra
```

### 6.4 Tool Interface

```typescript
export interface ToolInput {
  [key: string]: unknown
}
export interface ToolOutput {
  content: string
  metadata?: Record<string, unknown>
}

export abstract class BaseTool {
  abstract name: string
  abstract description: string // read by LLM for routing decisions
  abstract schema: ZodSchema // parameter validation
  abstract run(input: ToolInput): Promise<ToolOutput>
}
```

---

## 7. UI Design

### 7.1 Layout

```
┌─────────────────────────────────────────────────────────┐
│  [≡] Mimi AI Agent                        [–] [□] [✕]   │  ← Frameless title bar
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  HISTORY     │   CHAT AREA                              │
│  ──────────  │   ─────────────────────────────────────  │
│  Today       │   [Assistant bubble]                     │
│  · Chat 1    │   [User bubble]                          │
│  · Chat 2    │   [Tool call badge: search_requirements] │
│              │   [Assistant bubble w/ table]            │
│  Yesterday   │                                          │
│  · Chat 3    │                                          │
│              │   ┌──────────────────────────────────┐   │
│  [+ New]     │   │  Ask Mimi anything...        [▶] │   │
│              │   └──────────────────────────────────┘   │
├──────────────┴──────────────────────────────────────────┤
│  ● Connected to Copilot  │  ChromaDB: online  │ v1.0.0  │  ← Status bar
└─────────────────────────────────────────────────────────┘
```

### 7.2 Key UX Details

- **Streaming tokens** displayed word-by-word as they arrive (no spinner wait)
- **Tool-call badges** show which tool was invoked and collapsible raw args/result
- **Thinking indicator** (animated dots) while LLM is reasoning
- **Keyboard shortcut** `Ctrl+N` = new conversation, `Ctrl+K` = focus input
- **System tray icon** with quick "Ask Mimi" popup

---

## 8. Implementation Phases

### Phase 1 — Scaffold & Dev Environment _(~1 day)_ ✅ COMPLETE

- [x] Initialize repo with `electron-vite` template (TypeScript)
- [x] Configure ESLint, Prettier, `tsconfig` paths
- [x] Set up hot-reload for both main and renderer processes
- [x] Create `src/shared/ipc-types.ts` contract
- [x] Implement `preload/index.ts` with `contextBridge`
- [x] Smoke-test: renderer button → IPC → main → reply back (stub AgentService streams tokens)

### Phase 2 — LLM Integration _(~1–2 days)_ ✅ COMPLETE

- [x] Install `langchain`, `@langchain/openai`, `@langchain/core`
- [x] Implement `LLMService.ts` — streaming + non-streaming + `probe()` health check + `bindTools()` hook
- [x] Implement `MemoryService.ts` — sliding-window (12 turns), JSON persistence to userData
- [x] Implement `SemanticGate.ts` — LLM-based intent validation before tool dispatch
- [x] Implement `AgentService.ts` — full orchestration loop (gate → memory → stream → persist); tool-calling loop stub-ready for Phase 4
- [x] Implement `prompts.ts` — system prompt, semantic gate addendum, concise & full synthesis prompts
- [x] Wire real `AgentService` into IPC `handler.ts` (stub removed)
- [x] `STATUS_GET` now reports live `_llmState` from background probe
- [x] `dotenv` loaded at main process entry so `.env` credentials are injected

### Phase 3 — Vector Memory _(~1–2 days)_

- [ ] Install `chromadb` npm + evaluate `vectra` fallback
- [ ] Implement `VectorMemoryService.ts`
  - Collection creation & retrieval
  - Upsert with metadata
  - Similarity query with threshold
- [ ] Implement `DataIngester.ts` — reads CSV from `data/requirements/`
- [ ] Unit-test: ingest → query → assert top result

### Phase 4 — Agent Tools _(~2 days)_

- [ ] Define `BaseTool` abstract class with Zod schema validation
- [ ] Port all tools from Python → TypeScript:
  - `SearchRequirementsTool`
  - `GetRequirementDetailsTool`
  - `GenerateTestsTool`
  - `ListAssigneesTool`
  - `LogAnalyzerTool`
- [ ] Implement `ToolRegistry.ts`
- [ ] Implement `SemanticGate.ts` (intent validation pre-tool-call)
- [ ] Implement `AgentService.ts` full tool-calling loop
- [ ] Integration test: full message → tool call → final answer

### Phase 5 — React UI _(~2–3 days)_

- [ ] Set up Tailwind + `shadcn/ui` in renderer
- [ ] Implement Zustand stores (`chatStore`, `settingsStore`)
- [ ] Build `ChatView` with streaming message display
- [ ] Build `MessageBubble` (user / assistant / tool-call variants)
- [ ] Build `InputBar` with submit + stop-generation button
- [ ] Build `ThinkingIndicator` + `ToolCallBadge`
- [ ] Build `HistoryView` — list + load past conversations
- [ ] Build `SettingsView` — GitHub token, model, theme

### Phase 6 — Polish _(~1 day)_

- [ ] Frameless window + custom title bar (drag region)
- [ ] System tray icon with quick-chat popup
- [ ] Status bar (LLM connection + ChromaDB status)
- [ ] Keyboard shortcuts (`Ctrl+N`, `Ctrl+K`, `Escape`)
- [ ] Light / dark theme toggle

### Phase 7 — Packaging & Distribution _(~1 day)_

- [ ] Configure `electron-builder.yml` for Windows (NSIS), macOS (dmg), Linux (AppImage)
- [ ] Bundle `chroma_data/` and seed CSVs into app resources
- [ ] Bundle ONNX model via `@xenova/transformers` for offline embeddings
- [ ] Code sign (Windows: self-signed for dev; proper cert for release)
- [ ] Create GitHub Actions CI: build → test → package artifacts

---

## 9. Configuration & Secrets

```ini
# .env  (main process only — NEVER exposed to renderer via preload)
GITHUB_TOKEN=ghp_...
LLM_BASE_URL=https://models.inference.ai.azure.com
LLM_MODEL=gpt-4o
CHROMA_HOST=localhost
CHROMA_PORT=8000
LOG_LEVEL=info
```

Runtime settings (non-secret, user-editable in SettingsView) are persisted to
`%APPDATA%/AI-Agent-ElectronApp/settings.json` via Electron's `app.getPath('userData')`.

---

## 10. Testing Strategy

| Test type     | Tool                   | What it covers                                                     |
| ------------- | ---------------------- | ------------------------------------------------------------------ |
| Unit          | Vitest                 | AgentService loop, ToolRegistry, SemanticGate, VectorMemoryService |
| Integration   | Vitest + mock ChromaDB | Full ingest → query cycle                                          |
| E2E           | Playwright (electron)  | App launch → send message → assert reply appears in UI             |
| Type checking | `tsc --noEmit` in CI   | Zero type errors gate merges                                       |

---

## 11. Key Dependencies Summary

```json
{
  "dependencies": {
    "electron": "^30",
    "react": "^18",
    "react-dom": "^18",
    "langchain": "^0.3",
    "@langchain/openai": "^0.3",
    "@langchain/core": "^0.3",
    "chromadb": "^1.9",
    "vectra": "^0.9",
    "@xenova/transformers": "^2.17",
    "zod": "^3",
    "zustand": "^4",
    "react-markdown": "^9",
    "rehype-highlight": "^7",
    "dotenv": "^16",
    "electron-log": "^5",
    "electron-updater": "^6"
  },
  "devDependencies": {
    "electron-vite": "^2",
    "electron-builder": "^24",
    "typescript": "^5",
    "@types/react": "^18",
    "tailwindcss": "^3",
    "vite": "^5",
    "vitest": "^1",
    "playwright": "^1",
    "eslint": "^8",
    "prettier": "^3"
  }
}
```

---

## 12. Milestone Summary

| #   | Milestone   | Output                                         | Est. Time |
| --- | ----------- | ---------------------------------------------- | --------- |
| 1   | Scaffold    | Dev environment runs, IPC round-trip works     | Day 1     |
| 2   | LLM         | Streaming chat via GitHub Copilot in terminal  | Day 2     |
| 3   | Vector DB   | Requirements ingested, similarity search works | Day 3–4   |
| 4   | Agent Tools | All tools ported, AgentService loop functional | Day 5–6   |
| 5   | React UI    | Full chat UI with streaming + tool badges      | Day 7–9   |
| 6   | Polish      | Tray, shortcuts, themes, status bar            | Day 10    |
| 7   | Package     | Windows installer `.exe` ready to distribute   | Day 11    |

---

## 13. Risk & Mitigation

| Risk                                        | Mitigation                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| ChromaDB Node client stability              | Pre-test against target version; have Vectra fallback                        |
| `@xenova/transformers` bundle size (~80 MB) | Lazy-load model on first query; ship only `all-MiniLM-L6-v2`                 |
| GitHub Copilot endpoint rate limits         | Implement exponential back-off in `LLMService`                               |
| Context-bridge security                     | Validate and sanitize all IPC inputs in main; never expose raw `ipcRenderer` |
| Windows code signing                        | Use `electron-builder` self-signed for dev; document production cert steps   |
