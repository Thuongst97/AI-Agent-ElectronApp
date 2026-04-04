import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import {
  IPC, ChatRequest, AppStatus, ConversationMeta,
  Message, AppSettings, IngestResult,
} from '../../shared/ipc-types'
import { SettingsService }      from '../services/SettingsService'
import { ConversationService }  from '../services/ConversationService'
import { LLMService }           from '../agent/LLMService'
import { MemoryService }        from '../agent/MemoryService'
import { AgentService }         from '../agent/AgentService'
import { VectorMemoryService }  from '../data/VectorMemoryService'
import { DataIngester }         from '../data/DataIngester'
import { ToolRegistry }         from '../tools/ToolRegistry'
import log from 'electron-log'

// ── Singletons (created once, shared across all IPC calls) ───────────────────
// Initialised lazily inside registerIpcHandlers so Electron's app.getPath()
// is available when MemoryService and SettingsService constructors run.
let _settings:      SettingsService     | null = null
let _llm:           LLMService          | null = null
let _memory:        MemoryService       | null = null
let _agent:         AgentService        | null = null
let _convService:   ConversationService  | null = null
let _vectorMemory:  VectorMemoryService  | null = null
let _ingester:      DataIngester         | null = null

/** Cached LLM connection state — updated by probe on startup & settings change. */
let _llmState:    AppStatus['llm']     = 'disconnected'
let _chromaState: AppStatus['chromadb'] = 'disconnected'

function getServices(settings: SettingsService) {
  if (!_convService) _convService = new ConversationService()
  if (!_llm) {
    _llm = new LLMService(settings.get())
    log.info('[Handler] LLMService created (model=%s)', settings.get().llmModel)
  }
  if (!_memory) _memory = new MemoryService()
  if (!_agent)  _agent  = new AgentService(_llm, _memory)
  return { llm: _llm, memory: _memory, agent: _agent, conv: _convService }
}

// ─────────────────────────────────────────────────────────────────────────────

export function registerIpcHandlers(win: BrowserWindow): void {
  _settings = new SettingsService()
  const { agent, conv, llm } = getServices(_settings)

  // VectorMemory: init (connects to ChromaDB or falls back to Vectra)
  _vectorMemory = new VectorMemoryService()
  _ingester     = new DataIngester(_vectorMemory)

  _vectorMemory.init().then(async () => {
    _chromaState = _vectorMemory!.connectionState
    log.info('[Handler] VectorMemory ready (backend=%s)', _vectorMemory!.activeBackend)

    // Auto-ingest seed CSVs if the collection is empty
    const count = await _vectorMemory!.totalCount()
    if (count === 0) {
      const seedDir = app.isPackaged
        ? join(process.resourcesPath, 'requirements')
        : join(app.getAppPath(), 'data', 'requirements')

      log.info('[Handler] Collection empty — seeding from %s', seedDir)
      const result = await _ingester!.ingestDirectory(seedDir)
      log.info('[Handler] Seed ingest: inserted=%d skipped=%d errors=%d',
        result.inserted, result.skipped, result.errors.length)
    } else {
      log.info('[Handler] Collection has %d existing requirements — skipping auto-seed', count)
    }

    // Wire tools into the agent now that the vector store is ready
    const registry = new ToolRegistry(_vectorMemory!)
    agent.setToolRegistry(registry)
    log.info('[Handler] ToolRegistry injected — %d tools active', registry.getAll().length)
  }).catch(err => {
    _chromaState = 'error'
    log.error('[Handler] VectorMemory init failed:', err)
  })

  // Probe LLM connection in the background at startup
  llm.probe().then(state => {
    _llmState = state
    log.info('[Handler] Startup LLM probe → %s', state)
  }).catch(() => { _llmState = 'error' })

  // ── Chat ───────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_SEND, async (_event, req: ChatRequest) => {
    log.info(`[IPC] chat:send conversationId=${req.conversationId}`)
    try {
      await agent.chat(req, chunk => win.webContents.send(IPC.CHAT_CHUNK, chunk))
      // Mirror the user message into ConversationService for the history panel
      conv.appendMessages(req.conversationId, [
        {
          id:        Date.now().toString(),
          role:      'user',
          content:   req.message,
          createdAt: new Date().toISOString(),
        },
      ])
    } catch (err) {
      log.error('[IPC] chat:send error', err)
      win.webContents.send(IPC.CHAT_CHUNK, { type: 'error', content: String(err) })
    }
  })

  ipcMain.handle(IPC.CHAT_RESET, async (_event, conversationId: string) => {
    log.info(`[IPC] chat:reset conversationId=${conversationId}`)
    agent.reset(conversationId)
  })

  // ── History ────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.HISTORY_LIST, async (): Promise<ConversationMeta[]> => {
    return conv.listConversations()
  })

  ipcMain.handle(IPC.HISTORY_GET, async (_event, id: string): Promise<Message[]> => {
    return conv.getMessages(id)
  })

  ipcMain.handle(IPC.HISTORY_DELETE, async (_event, id: string): Promise<void> => {
    conv.deleteConversation(id)
  })

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_GET, async (): Promise<AppSettings> => {
    // Never expose the real token to the renderer — return masked version
    return _settings!.getForRenderer()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, partial: Partial<AppSettings>): Promise<void> => {
    _settings!.set(partial)
    // Rebuild LLM client with updated credentials / model
    llm.updateSettings(_settings!.get())
    // Re-probe connection with new settings
    llm.probe().then(state => { _llmState = state }).catch(() => { _llmState = 'error' })
    log.info('[IPC] Settings updated — LLM rebuilt')
  })

  // ── Data ingest ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DATA_INGEST, async (_event, filePath: string): Promise<IngestResult> => {
    log.info(`[IPC] data:ingest path=${filePath}`)
    if (!_ingester || !_vectorMemory) {
      return { success: false, inserted: 0, skipped: 0, errors: ['Vector memory not initialised'] }
    }
    const result = await _ingester.ingestFile(filePath)
    // Refresh chromadb state after a successful ingest
    _chromaState = await _vectorMemory.probe()
    return result
  })

  // ── Status ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.STATUS_GET, async (): Promise<AppStatus> => {
    // Re-probe both services for a fresh reading on every status request
    if (_llm)          _llmState    = await llm.probe().catch(() => 'error' as const)
    if (_vectorMemory) _chromaState = await _vectorMemory.probe().catch(() => 'error' as const)
    return {
      llm:      _llmState,
      chromadb: _chromaState,
      version:  process.env['npm_package_version'] ?? '1.0.0',
    }
  })

  log.info('[IPC] All handlers registered')
}
