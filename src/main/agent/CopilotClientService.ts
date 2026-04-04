/**
 * CopilotClientService — manages the lifecycle of a single CopilotClient.
 *
 * The CopilotClient spawns the `@github/copilot` CLI as a child process (JSON-RPC
 * server) and communicates with it via stdio.  One client is shared across all
 * IPC calls; individual conversations each get their own CopilotSession.
 *
 * Replaces: LLMService (ChatOpenAI / LangChain wrapper)
 */

import { CopilotClient } from '@github/copilot-sdk'
import { app } from 'electron'
import { join } from 'path'
import log from 'electron-log'
import type { AppSettings, ConnectionState } from '../../shared/ipc-types'

export class CopilotClientService {
  private client: CopilotClient

  constructor(settings: AppSettings) {
    this.client = this._buildClient(settings)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Start the CLI subprocess and establish the JSON-RPC connection. */
  async start(): Promise<void> {
    await this.client.start()
    log.info('[CopilotClientService] Client started')
  }

  /** Gracefully stop the CLI subprocess and all active sessions. */
  async stop(): Promise<void> {
    await this.client.stop()
    log.info('[CopilotClientService] Client stopped')
  }

  // ── Settings hot-reload ───────────────────────────────────────────────────

  /** Rebuild and restart the client after a token or model change. */
  async updateSettings(settings: AppSettings): Promise<void> {
    try { await this.client.stop() } catch { /* ignore */ }
    this.client = this._buildClient(settings)
    await this.client.start()
    log.info('[CopilotClientService] Restarted with updated settings')
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /** Raw CopilotClient — used by CopilotAgentService to open sessions. */
  getClient(): CopilotClient {
    return this.client
  }

  // ── Health probe ──────────────────────────────────────────────────────────

  async probe(): Promise<ConnectionState> {
    try {
      await this.client.ping()
      log.info('[CopilotClientService] probe → connected')
      return 'connected'
    } catch (err) {
      log.warn('[CopilotClientService] probe → error: %s', String(err))
      return 'error'
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _buildClient(settings: AppSettings): CopilotClient {
    // In packaged builds, the CLI binary is placed under resources/copilot-cli/.
    // In development, rely on the global `@github/copilot` install (in PATH).
    const cliPath = app.isPackaged
      ? join(process.resourcesPath, 'copilot-cli', 'copilot')
      : undefined

    return new CopilotClient({
      githubToken: settings.githubToken || undefined,
      cliPath,
    })
  }
}
