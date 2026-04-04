# Architecture

## Process Model

Electron runs two isolated OS processes. The agent brain lives entirely in the **main process** — the renderer is a pure display layer.

```
┌──────────────────────────────────────────────────────────────────────┐
│                          ELECTRON SHELL                              │
│                                                                      │
│  ┌──────────────────────────┐   IPC    ┌────────────────────────┐   │
│  │     RENDERER PROCESS      │◄────────►│     MAIN PROCESS        │   │
│  │  (React 18 + Tailwind)    │          │  (Node.js + Agent)      │   │
│  │                          │          │                        │   │
│  │  App.tsx                 │          │  index.ts              │   │
│  │  ├── TitleBar            │          │  └── ipc/handler.ts    │   │
│  │  ├── HistoryView         │          │      ├── AgentService  │   │
│  │  ├── ChatView            │          │      ├── LLMService    │   │
│  │  ├── SettingsView        │          │      ├── MemoryService │   │
│  │  └── InputBar            │          │      ├── SemanticGate  │   │
│  │                          │          │      ├── ToolRegistry  │   │
│  │  Stores (Zustand)        │          │      ├── VectorMemory  │   │
│  │  ├── chatStore           │          │      ├── DataIngester  │   │
│  │  └── settingsStore       │          │      ├── ConvService   │   │
│  └──────────────────────────┘          │      └── SettingsServ  │   │
│                                        └────────────────────────┘   │
│          ▲                                        ▲                  │
│    preload/index.ts                               │                  │
│    (contextBridge)                      External Services            │
│                                         ├── GitHub Copilot API       │
│                                         ├── ChromaDB (vector DB)     │
│                                         └── Vectra (local fallback)  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Main Process Modules

### `src/main/index.ts`

App entry point. Creates the `BrowserWindow`, loads `.env`, acquires single-instance lock, registers window control IPC handlers, and calls `registerIpcHandlers()`.

### `src/main/ipc/handler.ts`

Central IPC registration. Instantiates all services as **singletons** and wires them to `ipcMain.handle()` channels. Also manages startup tasks:

- VectorMemory init + auto-seed CSVs on first run
- ToolRegistry injection into AgentService
- LLM connection probe

### `src/main/agent/`

| File               | Role                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `AgentService.ts`  | Main orchestration loop — SemanticGate → MemoryService → LLMService → optional tool calls → persist        |
| `LLMService.ts`    | LangChain `ChatOpenAI` wrapper targeting the GitHub Copilot endpoint; exposes `streamChat()` and `probe()` |
| `MemoryService.ts` | Sliding window message buffer (last N turns); builds the message array sent to the LLM                     |
| `SemanticGate.ts`  | Pre-flight intent validator; rejects ambiguous/incomplete queries before they hit the LLM                  |
| `prompts.ts`       | System prompt templates                                                                                    |

### `src/main/data/`

| File                     | Role                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `VectorMemoryService.ts` | Manages ChromaDB connection (primary) with automatic fallback to Vectra (local); exposes `search()`, `probe()`, `totalCount()` |
| `DataIngester.ts`        | Reads CSV/JSON requirement files, chunks them, and upserts embeddings into the vector store                                    |

### `src/main/services/`

| File                     | Role                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `SettingsService.ts`     | Persists `AppSettings` to Electron's `userData` directory; uses `safeStorage` to encrypt the GitHub token |
| `ConversationService.ts` | File-based conversation store — each conversation is a JSON file in `userData/conversations/`             |

### `src/main/tools/`

| File                  | Role                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------- |
| `ToolRegistry.ts`     | Registers all LangChain tools; provides `run(name, input)` and `getAll()`                       |
| `requirementTools.ts` | Concrete tools: `SearchRequirements`, `GetRequirementDetails`, `GenerateTests`, `ListAssignees` |

---

## Preload Bridge

`src/preload/index.ts` exposes exactly two objects to the renderer via `contextBridge`:

- **`window.electronAPI`** — typed as `ElectronAPI` from `shared/ipc-types.ts`
- **`window.windowControls`** — `{ minimize, maximize, close }`

No raw Node.js APIs, no `ipcRenderer`, no `require` leaks into the renderer.

---

## Renderer Process Modules

### Views (full-page)

| View               | Purpose                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `ChatView.tsx`     | Message thread, streaming token rendering, tool call cards         |
| `HistoryView.tsx`  | Collapsible left sidebar — conversation list + new chat + settings |
| `SettingsView.tsx` | LLM endpoint, model, token, ChromaDB, theme configuration          |

### Components (shared)

| Component      | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `TitleBar.tsx` | Frameless drag region + custom window controls                 |
| `InputBar.tsx` | Unified chat input box — textarea + model picker + send button |

### Stores (Zustand)

| Store              | State                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| `chatStore.ts`     | `messages[]`, `isLoading`, `conversationId`, `sendMessage()`, `resetChat()` |
| `settingsStore.ts` | `settings: AppSettings`, `saveSettings()`, `loadSettings()`                 |

### Constants

| File                  | Exports                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `constants/models.ts` | `MODEL_GROUPS`, `modelLabel()`, `ALL_KNOWN_VALUES`, `CUSTOM_SENTINEL` |

---

## Dependency Graph

```
renderer
  └── chatStore ──────────────────────────────► window.electronAPI
  └── settingsStore ──────────────────────────► window.electronAPI
                                                      │
                                               preload (contextBridge)
                                                      │
                                               ipc/handler.ts
                                                 ├── AgentService
                                                 │     ├── SemanticGate
                                                 │     ├── MemoryService
                                                 │     ├── LLMService ──► GitHub Copilot
                                                 │     └── ToolRegistry
                                                 │           └── requirementTools
                                                 │                 └── VectorMemoryService ──► ChromaDB / Vectra
                                                 ├── ConversationService ──► userData/conversations/*.json
                                                 └── SettingsService ──────► userData/settings.json (encrypted token)
```
