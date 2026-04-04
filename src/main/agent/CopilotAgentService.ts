/**
 * CopilotAgentService — agentic orchestration via the GitHub Copilot SDK.
 *
 * Architecture:
 *
 *   User message (via IPC)
 *       │
 *       ▼
 *   resumeSession() / createSession()   ← lazily creates a per-conversation session
 *       │
 *       ▼
 *   session.sendAndWait({ prompt })     ← SDK handles: planning, tool dispatch, synthesis
 *       │
 *   ┌── assistant.message_delta  → onChunk({ type: 'token',       … })
 *   ├── tool.execution_start    → onChunk({ type: 'tool_call',   … })
 *   ├── tool.execution_complete → onChunk({ type: 'tool_result', … })
 *   └── session.idle            → onChunk({ type: 'final',       … })
 *
 * Replaces: AgentService (manual LangChain tool-calling loop)
 * Memory:   infiniteSessions (SDK auto-compaction) + ConversationService (UI history)
 */

import { approveAll } from '@github/copilot-sdk'
import type { CopilotSession } from '@github/copilot-sdk'
import log from 'electron-log'
import type { ChatChunk, ChatRequest, AppSettings } from '../../shared/ipc-types'
import type { CopilotClientService } from './CopilotClientService'
import type { ToolRegistry } from '../tools/ToolRegistry'
import { BASE_SYSTEM_PROMPT, SEMANTIC_GATE_ADDENDUM } from './prompts'

export class CopilotAgentService {
  private settings: AppSettings
  private toolRegistry: ToolRegistry | null = null

  constructor(
    private readonly copilotService: CopilotClientService,
    settings: AppSettings,
  ) {
    this.settings = settings
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  setToolRegistry(registry: ToolRegistry): void {
    this.toolRegistry = registry
    log.info('[CopilotAgentService] Tool registry set — %d tools registered', registry.getAll().length)
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings
  }

  // ── Main entry point ───────────────────────────────────────────────────────

  /**
   * Process one user message end-to-end, emitting ChatChunks via `onChunk`.
   * Returns the full assembled assistant reply (for ConversationService persistence).
   *
   * Chunk sequence:
   *   token …          (streaming tokens as they arrive)
   *   tool_call …      (when agent decides to invoke a tool)
   *   tool_result …    (when a tool returns its output)
   *   final            (marks end — stream complete)
   */
  async chat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<string> {
    const { message, conversationId } = req

    log.info('[CopilotAgentService] chat — conv=%s query="%s"', conversationId, message.slice(0, 60))

    const session = await this._getOrCreateSession(conversationId)
    let fullReply = ''

    // Wire streaming + tool events → IPC ChatChunks
    const unsubs: Array<() => void> = []

    unsubs.push(
      session.on('assistant.message_delta', (e: any) => {
        const delta: string = e?.data?.deltaContent ?? ''
        if (delta) {
          onChunk({ type: 'token', content: delta })
          fullReply += delta
        }
      }),
    )

    unsubs.push(
      session.on('tool.execution_start', (e: any) => {
        const toolName: string = e?.data?.toolName ?? 'tool'
        const toolArgs: unknown = e?.data?.toolArgs ?? {}
        onChunk({
          type:     'tool_call',
          content:  JSON.stringify(toolArgs, null, 2),
          toolName,
        })
        log.info('[CopilotAgentService] Tool invoked: %s', toolName)
      }),
    )

    unsubs.push(
      session.on('tool.execution_complete', (e: any) => {
        const toolName: string  = e?.data?.toolName ?? 'tool'
        const result:   unknown = e?.data?.result ?? ''
        onChunk({
          type:     'tool_result',
          content:  typeof result === 'string' ? result : JSON.stringify(result),
          toolName,
        })
      }),
    )

    try {
      const finalEvent = await session.sendAndWait({ prompt: message })

      // Fallback: if no delta events arrived (non-streaming mode), use final content
      if (!fullReply && finalEvent) {
        fullReply = (finalEvent as any)?.data?.content ?? ''
        // Emit as a token so the streaming bubble shows the text
        if (fullReply) onChunk({ type: 'token', content: fullReply })
      }

      // Pass fullReply in final so the store can use it as a safety fallback
      onChunk({ type: 'final', content: fullReply })
      log.info('[CopilotAgentService] Turn complete — %d chars', fullReply.length)
    } catch (err) {
      const raw = String(err)
      const msg = raw.includes('Personal Access Tokens are not supported')
        ? 'Authentication error: Personal Access Tokens (ghp_…) are not supported by the Copilot SDK.\n\n'
          + 'Please use a GitHub OAuth token. Run `gh auth token` in your terminal and paste the result into Settings → GitHub Token.'
        : `Agent error: ${raw}`
      onChunk({ type: 'error', content: msg })
      log.error('[CopilotAgentService] sendAndWait error:', err)
    } finally {
      // Unsubscribe all listeners and disconnect (preserves session on disk)
      unsubs.forEach(fn => fn())
      await session.disconnect().catch(e => log.warn('[CopilotAgentService] disconnect error:', e))
    }

    return fullReply
  }

  /** Delete the session from disk (called on chat:reset). */
  async reset(conversationId: string): Promise<void> {
    const client = this.copilotService.getClient()
    try {
      await client.deleteSession(conversationId)
      log.info('[CopilotAgentService] Session deleted: %s', conversationId)
    } catch {
      // Session may not exist on disk — that's fine
    }
  }

  // ── Session management ────────────────────────────────────────────────────

  /**
   * Try to resume an existing session (preserves conversation context across
   * messages and app restarts via SDK disk persistence).
   * Falls back to creating a fresh session when none exists.
   */
  private async _getOrCreateSession(conversationId: string): Promise<CopilotSession> {
    const client = this.copilotService.getClient()
    const tools  = this.toolRegistry?.getAll() ?? []

    try {
      const session = await client.resumeSession(conversationId, {
        onPermissionRequest: approveAll,
        tools,
      } as any)
      log.info('[CopilotAgentService] Resumed session %s', conversationId)
      return session
    } catch {
      // First message for this conversation (or session was deleted)
      log.info('[CopilotAgentService] Creating new session %s', conversationId)
      return client.createSession(this._buildSessionConfig(conversationId))
    }
  }

  private _buildSessionConfig(sessionId: string) {
    const tools   = this.toolRegistry?.getAll() ?? []
    const config: Record<string, unknown> = {
      sessionId,
      model:         this.settings.copilotModel || 'gpt-4o',
      streaming:     true,
      tools,
      systemMessage: {
        content: BASE_SYSTEM_PROMPT + SEMANTIC_GATE_ADDENDUM,
      },
      onPermissionRequest: approveAll,
      infiniteSessions: { enabled: true },
    }

    // Only include reasoningEffort when the model supports it
    if (this.settings.reasoningEffort) {
      config['reasoningEffort'] = this.settings.reasoningEffort
    }

    return config as any // SDK SessionConfig shape
  }
}
