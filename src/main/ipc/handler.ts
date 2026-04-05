import { ipcMain, BrowserWindow, app } from 'electron'
import { join } from 'path'
import {
  IPC, ChatRequest, AppStatus, ConversationMeta,
  Message, AppSettings, IngestResult, TOKEN_MASKED,
} from '../../shared/ipc-types'
import { SettingsService }          from '../services/SettingsService'
import { ConversationService }       from '../services/ConversationService'
import { JiraService }               from '../services/JiraService'
import { CopilotClientService }      from '../agent/CopilotClientService'
import { CopilotAgentService }       from '../agent/CopilotAgentService'
import { VectorMemoryService }       from '../data/VectorMemoryService'
import { DataIngester }              from '../data/DataIngester'
import { ToolRegistry }              from '../tools/ToolRegistry'
import { makeRequirementTools }      from '../tools/requirementTools'
import log from 'electron-log'

// ── Singletons (created once, shared across all IPC calls) ───────────────────
let _settings:      SettingsService      | null = null
let _copilot:       CopilotClientService | null = null
let _agent:         CopilotAgentService  | null = null
let _convService:   ConversationService  | null = null
let _vectorMemory:  VectorMemoryService  | null = null
let _ingester:      DataIngester         | null = null
let _jira:          JiraService          | null = null

/** Cached connection states — updated by probe on startup & settings change. */
let _llmState:    AppStatus['llm']      = 'disconnected'
let _chromaState: AppStatus['chromadb'] = 'disconnected'

function getServices(settings: SettingsService) {
  if (!_convService) _convService = new ConversationService()
  if (!_copilot) {
    _copilot = new CopilotClientService(settings.get())
    log.info('[Handler] CopilotClientService created (model=%s)', settings.get().copilotModel)
  }
  if (!_agent) _agent = new CopilotAgentService(_copilot, settings.get())
  return { copilot: _copilot, agent: _agent, conv: _convService }
}

// ─────────────────────────────────────────────────────────────────────────────

export async function registerIpcHandlers(win: BrowserWindow): Promise<void> {
  _settings = new SettingsService()
  const { agent, conv, copilot } = getServices(_settings)

  // Jira service — credentials from settings
  _jira = new JiraService(_settings.get())

  // ToolRegistry: register Jira tools immediately so agent is ready on first message
  const registry = new ToolRegistry(_jira)
  agent.setToolRegistry(registry)
  agent.purgeStaleSessionsIfNeeded()        // purge any sessions missing Jira tools
  log.info('[Handler] ToolRegistry created with Jira tools immediately')

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

    // Add requirement tools now that VectorMemory is ready
    registry.addTools(makeRequirementTools(_vectorMemory!))
    log.info('[Handler] Requirement tools added — total tools: %d', registry.getAll().length)
    agent.purgeStaleSessionsIfNeeded()      // re-check fingerprint with full tool set
  }).catch(err => {
    _chromaState = 'error'
    log.error('[Handler] VectorMemory init failed:', err)
  })

  // ── Chat ───────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.CHAT_SEND, async (_event, req: ChatRequest) => {
    log.info(`[IPC] chat:send conversationId=${req.conversationId}`)
    try {
      const assistantReply = await agent.chat(req, chunk => win.webContents.send(IPC.CHAT_CHUNK, chunk))

      // Persist both sides of the turn for the history panel
      conv.appendMessages(req.conversationId, [
        {
          id:        `${Date.now()}-user`,
          role:      'user',
          content:   req.message,
          createdAt: new Date().toISOString(),
        },
        ...(assistantReply ? [{
          id:        `${Date.now()}-assistant`,
          role:      'assistant' as const,
          content:   assistantReply,
          createdAt: new Date().toISOString(),
        }] : []),
      ])
    } catch (err) {
      log.error('[IPC] chat:send error', err)
      win.webContents.send(IPC.CHAT_CHUNK, { type: 'error', content: String(err) })
    }
  })

  ipcMain.handle(IPC.CHAT_RESET, async (_event, conversationId: string) => {
    log.info(`[IPC] chat:reset conversationId=${conversationId}`)
    await agent.reset(conversationId)
  })

  ipcMain.handle(IPC.CHAT_CANCEL, () => {
    log.info('[IPC] chat:cancel — aborting active turn')
    agent.abort()
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
    // Also delete the SDK session from disk
    await agent.reset(id)
  })

  // ── Settings ───────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SETTINGS_GET, async (): Promise<AppSettings> => {
    return _settings!.getForRenderer()
  })

  ipcMain.handle(IPC.SETTINGS_SET, async (_event, partial: Partial<AppSettings>): Promise<void> => {
    _settings!.set(partial)
    const updated = _settings!.get()
    agent.updateSettings(updated)
    // Reconfigure Jira credentials if they changed
    _jira?.reconfigure(updated)
    // Rebuild Copilot client if the token was explicitly changed (including clearing it)
    if (partial.githubToken !== undefined && partial.githubToken !== TOKEN_MASKED) {
      await copilot.updateSettings(updated)
      copilot.probe().then(state => { _llmState = state }).catch(() => { _llmState = 'error' })
    }
    log.info('[IPC] Settings updated')
  })

  // ── Data ingest ────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.DATA_INGEST, async (_event, filePath: string): Promise<IngestResult> => {
    log.info(`[IPC] data:ingest path=${filePath}`)
    if (!_ingester || !_vectorMemory) {
      return { success: false, inserted: 0, skipped: 0, errors: ['Vector memory not initialised'] }
    }
    const result = await _ingester.ingestFile(filePath)
    _chromaState = await _vectorMemory.probe().catch(() => 'error' as const)
    return result
  })

  // ── Status ─────────────────────────────────────────────────────────────────
  ipcMain.handle(IPC.STATUS_GET, async (): Promise<AppStatus> => {
    if (_copilot)      _llmState    = await copilot.probe().catch(() => 'error' as const)
    if (_vectorMemory) _chromaState = await _vectorMemory.probe().catch(() => 'error' as const)
    return {
      llm:      _llmState,
      chromadb: _chromaState,
      version:  process.env['npm_package_version'] ?? '1.0.0',
    }
  })

  log.info('[IPC] All handlers registered')

  // ── Start async services after handlers are registered ──────────────────
  // Graceful shutdown — stop the CLI subprocess before quitting
  app.on('before-quit', (event) => {
    log.info('[Handler] App quitting — stopping Copilot client')
    event.preventDefault()
    copilot.stop()
      .catch(err => log.warn('[Handler] Cleanup error:', err))
      .finally(() => {
        app.exit(0)
      })
  })

  // Start the Copilot CLI and probe (fire-and-forget — never blocks handler reg)
  copilot.start()
    .then(() => {
      log.info('[Handler] CopilotClientService started')
      return copilot.probe()
    })
    .then(state => {
      _llmState = state
      log.info('[Handler] Startup probe → %s', state)
    })
    .catch(err => {
      _llmState = 'error'
      log.error('[Handler] Copilot start/probe failed:', err)
    })
}
