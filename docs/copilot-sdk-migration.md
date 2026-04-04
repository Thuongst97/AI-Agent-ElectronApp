# Migration Plan: LangChain.js → GitHub Copilot SDK (`@github/copilot-sdk`)

> Branch: current checkout
> SDK version targeted: `@github/copilot-sdk` v0.2.x (Public Preview)
> Status: Planning

---

## 1. Why Migrate

| Concern        | Current (LangChain.js)                                      | After (Copilot SDK)                                   |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------- |
| Agentic loop   | Hand-written in `AgentService._runWithTools()` (~120 lines) | SDK built-in orchestration                            |
| Tool calling   | Manual `invokeWithTools` + JSON parse loop                  | `defineTool()` — SDK handles dispatch                 |
| Streaming      | `llm.stream()` + token callbacks                            | `session.on("assistant.message_delta")`               |
| Context window | Manual `MemoryService` sliding window                       | `infiniteSessions` auto-compaction                    |
| Auth           | Raw `openAIApiKey` header                                   | `githubToken` in `CopilotClient` constructor          |
| Model choice   | `llmModel` string in settings                               | `model` per session (`gpt-5`, `claude-sonnet-4.5`, …) |
| Maintenance    | LangChain abstractions                                      | First-party GitHub SDK                                |

---

## 2. Architecture Mapping

```
CURRENT                         │  AFTER
────────────────────────────────│──────────────────────────────────
LLMService (ChatOpenAI)         │  CopilotClientService (CopilotClient)
AgentService._runWithTools()    │  SDK built-in tool orchestration
ToolRegistry (LangChain tools)  │  defineTool() array on createSession()
MemoryService (JSON window)     │  resumeSession() + infiniteSessions
SemanticGate (LLM intent check) │  hooks.onUserPromptSubmitted OR keep via SDK session
IPC Handler singletons          │  single CopilotClient + session map
AppSettings (llmBaseUrl/model)  │  model + optional provider (BYOK)
```

---

## 3. Prerequisites

```powershell
# 1. Copilot CLI (global, required by the SDK to spawn as a server process)
npm install -g @github/copilot

# 2. SDK in the project
npm install @github/copilot-sdk

# 3. Confirm CLI is reachable
copilot --version
```

> **Important for Electron packaging**: the CLI binary must be bundled inside
> the `resources/` directory or referenced via `cliPath` in `CopilotClient`
> options so packaged `.exe` works offline. See Phase 8.

---

## 4. Phase-by-Phase Plan

---

### Phase 1 — Install & Dependency Audit

**Goal**: add the SDK; identify what LangChain packages can be removed.

Tasks:

- [ ] `npm install @github/copilot-sdk zod` (zod is already present)
- [ ] Audit `@langchain/core`, `@langchain/openai`, `langchain` — mark for removal
      after all usages are migrated
- [ ] Keep `zod` for `defineTool()` schemas (replaces LangChain `z.object()`)
- [ ] Update `package.json` — do NOT remove LangChain yet (parallel while migrating)

---

### Phase 2 — New `CopilotClientService.ts`

**Replaces**: `LLMService.ts`
**File**: `src/main/agent/CopilotClientService.ts`

```typescript
import { CopilotClient } from '@github/copilot-sdk'
import type { AppSettings } from '../../shared/ipc-types'
import log from 'electron-log'

export class CopilotClientService {
  private client: CopilotClient

  constructor(settings: AppSettings) {
    this.client = new CopilotClient({
      githubToken: settings.githubToken, // takes priority over CLI login
      autoStart: true,
    })
  }

  async start(): Promise<void> {
    await this.client.start()
    log.info('[CopilotClientService] Client started')
  }

  async stop(): Promise<void> {
    await this.client.stop()
  }

  getClient(): CopilotClient {
    return this.client
  }

  /** Rebuild with new settings (e.g. token change). */
  async updateSettings(settings: AppSettings): Promise<void> {
    await this.client.stop()
    this.client = new CopilotClient({ githubToken: settings.githubToken })
    await this.client.start()
    log.info('[CopilotClientService] Restarted with new settings')
  }

  async probe(): Promise<'connected' | 'error'> {
    try {
      await this.client.ping()
      return 'connected'
    } catch {
      return 'error'
    }
  }
}
```

**BYOK option** (if keeping the custom `llmBaseUrl` from settings):

```typescript
// inside createSession() call in CopilotAgentService:
provider: {
  type: 'openai',
  baseUrl: settings.llmBaseUrl,
  apiKey:  settings.githubToken,
}
```

---

### Phase 3 — New `CopilotAgentService.ts`

**Replaces**: `AgentService.ts` (the entire agentic loop)
**File**: `src/main/agent/CopilotAgentService.ts`

Key design decisions:

- `conversationId` maps 1-to-1 with Copilot `sessionId`
- First message → `createSession({ sessionId: conversationId, … })`
- Subsequent messages → `resumeSession(conversationId, …)`
- Tools passed at session creation (same tool list every time)
- Streaming via `"assistant.message_delta"` events

```typescript
import { CopilotClient, approveAll, defineTool } from '@github/copilot-sdk'
import type { ChatChunk, ChatRequest } from '../../shared/ipc-types'
import { BASE_SYSTEM_PROMPT } from './prompts'
import type { CopilotClientService } from './CopilotClientService'
import type { IToolRegistry } from './CopilotAgentService' // see Phase 4
import log from 'electron-log'

export class CopilotAgentService {
  private activeSessions = new Set<string>()

  constructor(
    private readonly copilotService: CopilotClientService,
    private toolRegistry: IToolRegistry | null = null,
  ) {}

  setToolRegistry(registry: IToolRegistry): void {
    this.toolRegistry = registry
    log.info('[CopilotAgentService] Tool registry set — %d tools', registry.getAll().length)
  }

  async chat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<void> {
    const { message, conversationId } = req
    const client = this.copilotService.getClient()

    const sessionConfig = {
      sessionId: conversationId,
      model: 'gpt-4o', // from settings
      streaming: true,
      tools: this.toolRegistry?.toCopilotTools() ?? [],
      systemMessage: {
        mode: 'customize' as const,
        sections: {
          identity: { action: 'append' as const, content: BASE_SYSTEM_PROMPT },
        },
      },
      onPermissionRequest: approveAll,
      infiniteSessions: { enabled: true },
    }

    const isExisting = this.activeSessions.has(conversationId)
    const session = isExisting
      ? await client.resumeSession(conversationId, { onPermissionRequest: approveAll })
      : await client.createSession(sessionConfig)

    if (!isExisting) this.activeSessions.add(conversationId)

    // Wire streaming events → IPC ChatChunks
    const unsub: Array<() => void> = []

    unsub.push(
      session.on('assistant.message_delta', e => {
        onChunk({ type: 'token', content: e.data.deltaContent })
      }),
    )

    unsub.push(
      session.on('tool.execution_start', e => {
        onChunk({
          type: 'tool_call',
          content: JSON.stringify(e.data.toolArgs ?? {}),
          toolName: e.data.toolName,
        })
      }),
    )

    unsub.push(
      session.on('tool.execution_complete', e => {
        onChunk({
          type: 'tool_result',
          content: JSON.stringify(e.data.result ?? ''),
          toolName: e.data.toolName,
        })
      }),
    )

    try {
      await session.sendAndWait({ prompt: message })
      onChunk({ type: 'final', content: '' })
    } catch (err) {
      onChunk({ type: 'error', content: String(err) })
      log.error('[CopilotAgentService] sendAndWait error:', err)
    } finally {
      unsub.forEach(fn => fn())
      await session.disconnect()
    }
  }

  reset(conversationId: string): void {
    this.activeSessions.delete(conversationId)
    // SDK: session data persists on disk; to hard-reset call client.deleteSession()
  }
}
```

---

### Phase 4 — Adapt `ToolRegistry` → `defineTool()`

**Replaces**: `ToolRegistry.toLangChainTools()` with `toCopilotTools()`
**File**: `src/main/tools/ToolRegistry.ts` (extend existing)

The current tools are LangChain `DynamicStructuredTool`s. Wrap them via adapter:

```typescript
import { defineTool } from '@github/copilot-sdk'
import type { Tool } from '@github/copilot-sdk'
import { z }         from 'zod'

// Add to ToolRegistry class:
toCopilotTools(): Tool[] {
  return [...this.tools.values()].map(t =>
    defineTool(t.name, {
      description:   t.description,
      parameters:    t.zodSchema,      // expose Zod schema — see note below
      skipPermission: true,            // read-only tools don't need approval
      handler: async (args) => {
        const result = await t.run(args as ToolInput)
        return result.content
      },
    })
  )
}
```

> **Note on Zod schemas**: the existing LangChain tools already define Zod schemas
> internally. Refactor each tool in `requirementTools.ts` to export its schema
> so `ToolRegistry` can pass it to `defineTool()`.
> Alternatively, use raw JSON Schema objects — both are supported by the SDK.

Schema export pattern for each tool:

```typescript
// requirementTools.ts
export const searchSchema = z.object({
  query: z.string().describe('Keyword to search for'),
  limit: z.number().optional().default(10),
})

export function makeSearchRequirementsTool(memory: VectorMemoryService) {
  return defineTool('search_requirements', {
    description: 'Search requirements by keyword',
    parameters:  searchSchema,
    skipPermission: true,
    handler: async ({ query, limit }) => { … }
  })
}
```

---

### Phase 5 — Migrate `SemanticGate`

**Options** (pick one):

#### Option A — `hooks.onUserPromptSubmitted` (recommended)

Replace the pre-flight LLM call with a session hook that the SDK invokes before
every user message:

```typescript
hooks: {
  onUserPromptSubmitted: async ({ prompt }) => {
    const result = await runIntentCheck(prompt)   // lightweight local check
    if (!result.clear) {
      // Return modified prompt that instructs the model to ask for clarification
      return {
        modifiedPrompt: `[SYSTEM: The user query is ambiguous. Ask: "${result.question}" before proceeding.]\n${prompt}`,
      }
    }
    return { modifiedPrompt: prompt }
  },
}
```

#### Option B — Keep SemanticGate, use a throwaway SDK session

Create a cheap single-turn session (no tools, no streaming) for the validation
call instead of a raw LangChain `invoke()`:

```typescript
// SemanticGate remains structurally the same; replace LLMService.invoke() with:
const checkSession = await client.createSession({
  model: 'gpt-4o-mini',
  onPermissionRequest: approveAll,
  infiniteSessions: { enabled: false },
  systemMessage: { mode: 'replace', content: INTENT_CHECK_SYSTEM },
})
const response = await checkSession.sendAndWait({ prompt: userQuery })
await checkSession.disconnect()
```

#### Option C — Remove SemanticGate

The Copilot SDK's built-in agent is better at disambiguating unclear queries
natively via `onUserInputRequest`. Register the handler and let the model ask:

```typescript
onUserInputRequest: async ({ question }) => {
  // Forward the model's clarifying question back to the user via IPC
  onChunk({ type: 'token', content: question })
  onChunk({ type: 'final', content: '' })
  // Block until user replies (implement a Promise that resolves via IPC)
  return { answer: await waitForUserReply(conversationId) }
}
```

---

### Phase 6 — Replace `MemoryService`

**Context**: `MemoryService` serves two purposes in the current code:

1. Build LangChain message arrays for the LLM (`buildMessages`)
2. Persist conversation history to `userData/*.history.json` for UI display

With the SDK:

- Purpose 1 is handled by `resumeSession()` + `infiniteSessions` — **remove**
- Purpose 2 is still needed for `HistoryView` in the renderer — **keep a slim version**

```
MemoryService (slim — UI only)
  appendTurn()       → still called after chat completes (for UI display)
  getHistory()       → used by HistoryView to render message list
  buildMessages()    → DELETE (SDK owns the context window)
  clear()            → call client.deleteSession() in addition
```

New `ConversationService` can absorb these responsibilities:

```typescript
// src/main/services/ConversationService.ts — add:
appendMessage(convId: string, role: 'user' | 'assistant', content: string): void
getMessages(convId: string): Message[]
```

---

### Phase 7 — Update `IPC Handler` (`handler.ts`)

**Key changes**:

```typescript
// Old: separate LLMService + AgentService singletons
let _llm: LLMService | null = null
let _agent: AgentService | null = null

// New: CopilotClientService + CopilotAgentService
let _copilot: CopilotClientService | null = null
let _agent: CopilotAgentService | null = null
```

Lifecycle wiring:

```typescript
export async function registerIpcHandlers(win: BrowserWindow): Promise<void> {
  _settings = new SettingsService()
  _copilot  = new CopilotClientService(_settings.get())
  await _copilot.start()                        // start CLI server process

  app.on('before-quit', async () => {           // graceful shutdown
    await _copilot?.stop()
  })

  // VectorMemory init → ToolRegistry → inject into agent (unchanged)
  _vectorMemory = new VectorMemoryService()
  await _vectorMemory.init()
  const registry = new ToolRegistry(_vectorMemory)
  _agent = new CopilotAgentService(_copilot, registry)
  …
}
```

Settings change handler:

```typescript
ipcMain.handle(IPC.SETTINGS_SET, async (_, partial: Partial<AppSettings>) => {
  _settings!.set(partial)
  if (partial.githubToken) {
    await _copilot!.updateSettings(_settings!.get()) // restart client
  }
})
```

---

### Phase 8 — Electron Packaging: Bundle the CLI

The `CopilotClient` spawns the `@github/copilot` CLI as a subprocess. For
packaged Electron apps this binary must be accessible at runtime.

**Strategy**:

```typescript
// In CopilotClientService constructor:
const cliPath = app.isPackaged
  ? join(process.resourcesPath, 'copilot-cli', 'copilot') // bundled
  : undefined // dev: use global PATH install

this.client = new CopilotClient({
  githubToken: settings.githubToken,
  cliPath,
})
```

`electron-builder.yml` additions:

```yaml
extraResources:
  - from: node_modules/@github/copilot/bin/
    to: copilot-cli/
    filter: ['**/*']
```

---

### Phase 9 — Update `AppSettings` & `SettingsView`

Remove fields no longer needed; add new SDK-specific options:

```typescript
// shared/ipc-types.ts — AppSettings changes
export interface AppSettings {
  githubToken: string // kept — used for CopilotClient auth
  copilotModel: string // new — 'gpt-4o' | 'gpt-4.1' | 'claude-sonnet-4.5' | …
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | null // new
  // REMOVED: llmBaseUrl, llmMaxTokens, llmTemperature
  // KEPT:    theme, other UI prefs
}
```

`SettingsView.tsx`: replace model/URL/temperature inputs with model dropdown +
reasoning effort selector (or keep BYOK fields as an "Advanced" toggle).

---

### Phase 10 — Remove LangChain Dependencies

After all phases above pass `typecheck` and manual testing:

```powershell
npm uninstall @langchain/core @langchain/openai langchain
```

Files to delete:

- `src/main/agent/LLMService.ts`
- `src/main/agent/AgentService.ts` (replaced by `CopilotAgentService.ts`)

Files to modify:

- `src/main/agent/MemoryService.ts` — slim to UI-only
- `src/main/agent/SemanticGate.ts` — adapt or remove
- `src/main/tools/ToolRegistry.ts` — switch to `defineTool()` output
- `src/main/tools/requirementTools.ts` — export Zod schemas, convert to SDK tools

---

## 5. Risk Register

| Risk                                        | Likelihood | Mitigation                                                                       |
| ------------------------------------------- | ---------- | -------------------------------------------------------------------------------- |
| SDK in Public Preview — breaking changes    | Medium     | Pin to `0.2.x`; review CHANGELOG on each SDK update                              |
| CLI must be installed / bundled             | High       | Phase 8 bundles CLI in `extraResources`; dev docs updated                        |
| Session resume across app restarts          | Medium     | SDK persists sessions in `~/.copilot/session-state/`; `resumeSession` handles it |
| `onUserInputRequest` blocks the IPC thread  | Medium     | Implement a `Promise` + IPC round-trip so user replies flow back to the hook     |
| Rate limits: each session = premium request | Low-Med    | Reuse sessions via `resumeSession`; `infiniteSessions` reduces total calls       |
| Tool Zod schema migration                   | Low        | Schemas already exist in LangChain tools; refactor is mechanical                 |

---

## 6. Migration Sequence (recommended order)

```
Phase 1  Install SDK
    │
Phase 2  CopilotClientService (new LLMService)
    │
Phase 3  CopilotAgentService (no tools yet) — test basic chat
    │
Phase 4  Convert tools to defineTool()
    │
Phase 3b Re-integrate tools into CopilotAgentService
    │
Phase 5  Migrate SemanticGate (pick option)
    │
Phase 6  Slim MemoryService → ConversationService
    │
Phase 7  Update IPC Handler
    │
Phase 8  Packaging (CLI bundling)
    │
Phase 9  Settings UI update
    │
Phase 10 Remove LangChain — final cleanup
```

Each phase can be committed independently; the app remains runnable because both
the old and new services coexist until Phase 10 removes the old ones.

---

## 7. File Change Summary

| File                                       | Action                                              |
| ------------------------------------------ | --------------------------------------------------- |
| `src/main/agent/CopilotClientService.ts`   | **NEW**                                             |
| `src/main/agent/CopilotAgentService.ts`    | **NEW**                                             |
| `src/main/agent/LLMService.ts`             | **DELETE** (Phase 10)                               |
| `src/main/agent/AgentService.ts`           | **DELETE** (Phase 10)                               |
| `src/main/agent/MemoryService.ts`          | **SLIM** (remove `buildMessages`)                   |
| `src/main/agent/SemanticGate.ts`           | **ADAPT / REMOVE** (Phase 5)                        |
| `src/main/agent/prompts.ts`                | Keep — `systemMessage` content reused               |
| `src/main/tools/ToolRegistry.ts`           | **MODIFY** — add `toCopilotTools()`                 |
| `src/main/tools/requirementTools.ts`       | **MODIFY** — export Zod schemas, use `defineTool()` |
| `src/main/ipc/handler.ts`                  | **MODIFY** — swap service singletons                |
| `src/main/services/ConversationService.ts` | **EXTEND** — absorb slim memory                     |
| `src/shared/ipc-types.ts`                  | **MODIFY** — AppSettings fields                     |
| `src/renderer/src/views/SettingsView.tsx`  | **MODIFY** — model dropdown                         |
| `electron-builder.yml`                     | **MODIFY** — bundle CLI binary                      |
| `package.json`                             | **MODIFY** — add/remove deps                        |
