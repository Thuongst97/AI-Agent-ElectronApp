# Data Flow

## Overview

All data in the system flows through a single direction:

```
User Input → Renderer → IPC → Main Process → LLM / Vector DB → IPC Stream → Renderer
```

---

## Chat Message Flow

```mermaid
flowchart TD
    A([User types message]) --> B[InputBar.tsx]
    B --> C[chatStore.sendMessage]
    C --> D["window.electronAPI.sendMessage(req)"]
    D -->|IPC invoke: chat:send| E[ipc/handler.ts]

    E --> F[AgentService.chat]

    F --> G{SemanticGate\n.validate}
    G -->|REJECT| H[stream error chunk]
    G -->|PASS| I[MemoryService\n.buildMessages]

    I --> J[LLMService\n.streamChat]
    J -->|streaming tokens| K["win.webContents.send\n(chat:chunk, token)"]
    K -->|IPC on: chat:chunk| L[chatStore onChatChunk]
    L --> M[ChatView renders token]

    J --> N{tool_calls\nin response?}
    N -->|YES| O[ToolRegistry.run]
    O --> P[requirementTools\nvector search / analysis]
    P --> Q[append ToolMessage]
    Q --> J

    N -->|NO — final| R[MemoryService.persist]
    R --> S[ConversationService\n.appendMessages]
    S --> T[(userData/conversations/\n{id}.json)]
```

---

## Settings Flow

```mermaid
flowchart LR
    A[SettingsView] -->|setSettings| B[settingsStore]
    B -->|window.electronAPI.setSettings| C[ipc/handler.ts]
    C --> D[SettingsService.set]
    D -->|encrypt token\nsafeStorage| E[(userData/settings.json)]
    C --> F[LLMService.updateSettings]
    F --> G[re-probe LLM connection]
```

---

## Vector Memory & Data Ingestion Flow

```mermaid
flowchart TD
    A[CSV / JSON requirement files] --> B[DataIngester.ingestFile]
    B --> C[chunk & embed text]
    C --> D{VectorMemoryService}
    D -->|primary| E[(ChromaDB\nlocalhost:8000)]
    D -->|fallback| F[(Vectra\nuserData/vectra/)]

    G[User query] --> H[ToolRegistry]
    H --> I[SearchRequirementsTool]
    I --> D
    D --> J[top-K similar chunks]
    J --> K[LLMService — augmented context]
```

---

## Startup Initialization Flow

```mermaid
flowchart TD
    A[app.whenReady] --> B[createWindow]
    B --> C[registerIpcHandlers]

    C --> D[SettingsService.load]
    C --> E[VectorMemoryService.init]

    E --> F{ChromaDB\nreachable?}
    F -->|YES| G[use ChromaDB]
    F -->|NO| H[fall back to Vectra]

    G --> I{collection\nempty?}
    H --> I
    I -->|YES| J[DataIngester.ingestDirectory\nseed CSVs]
    I -->|NO| K[skip seeding]

    J --> L[ToolRegistry created]
    K --> L
    L --> M[AgentService.setToolRegistry]

    C --> N[LLMService.probe]
    N --> O[update _llmState]
```

---

## Theme / UI State Flow

```mermaid
flowchart LR
    A[settingsStore.settings.theme] -->|effect| B[App.tsx useEffect]
    B -->|set data-theme attr| C[html element]
    C -->|CSS vars resolved| D[Tailwind + globals.css\nvar--bg-primary, etc.]
```

---

## Key Data Structures

### `ChatRequest` (renderer → main)

```typescript
{
  message: string
  conversationId: string
}
```

### `ChatChunk` (main → renderer, streamed)

```typescript
{
  type: 'token' | 'tool_call' | 'tool_result' | 'final' | 'error'
  content: string
  toolName?: string
}
```

### `Message` (stored in conversation JSON)

```typescript
{
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  createdAt: string
  toolName?: string
}
```

### `AppSettings` (persisted in userData)

```typescript
{
  githubToken: string // AES-encrypted via safeStorage
  llmBaseUrl: string // GitHub Copilot endpoint
  llmModel: string // e.g. "gpt-4o"
  llmMaxTokens: number
  llmTemperature: number
  chromaHost: string
  chromaPort: number
  theme: 'light' | 'dark' | 'system'
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
```
