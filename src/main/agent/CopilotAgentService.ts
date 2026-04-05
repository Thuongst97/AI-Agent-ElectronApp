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
import { app } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import log from 'electron-log'
import type { ChatChunk, ChatRequest, AppSettings } from '../../shared/ipc-types'
import type { CopilotClientService } from './CopilotClientService'
import type { ToolRegistry } from '../tools/ToolRegistry'
import { BASE_SYSTEM_PROMPT, SEMANTIC_GATE_ADDENDUM, buildSkillsSection } from './prompts'

// Built-in CLI shell/file tools that must be excluded to prevent the agent from
// entering infinite execution loops when it tries to run shell commands.
const EXCLUDED_BUILTIN_TOOLS = [
  // Shell / process execution
  'powershell', 'write_powershell', 'bash', 'sh', 'cmd',
  'run_command', 'execute_command', 'shell', 'run_in_terminal',
  // File system
  'read_file', 'write_file', 'create_file', 'edit_file', 'view',
  'search_files', 'list_directory', 'find_files', 'list_dir',
  // Text search / grep
  'grep', 'grep_search', 'text_search', 'semantic_search',
  // Misc SDK built-ins
  'report_intent', 'web_search', 'browser',
]

export class CopilotAgentService {
  private settings: AppSettings
  private toolRegistry: ToolRegistry | null = null
  private _activeSession: CopilotSession | null = null
  private _abortRequested = false

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

  /**
   * Compute a fingerprint of the current system prompt + tool names.
   * If it differs from what's stored on disk, purge all SDK session files so
   * fresh sessions are created with the current tools and system message.
   * Call this each time the tool registry is finalised.
   */
  purgeStaleSessionsIfNeeded(): void {
    const configDir = join(app.getPath('userData'), 'sdk-sessions')
    const toolNames = (this.toolRegistry?.getAll() ?? [])
      .map((t: any) => t.name as string)
      .sort()
      .join(',')
    // Include enabled skill keys + custom instructions in fingerprint so that
    // changing skills forces fresh sessions with the updated system prompt.
    const skillsFingerprint = Object.entries(this.settings.skills ?? {})
      .filter(([, cfg]) => cfg.enabled)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, cfg]) => `${k}:${cfg.customInstruction ?? ''}`)
      .join('|')
    const fingerprint = createHash('sha1')
      .update(this.settings.systemPrompt?.trim() || BASE_SYSTEM_PROMPT)
      .update('|')
      .update(toolNames)
      .update('|')
      .update(skillsFingerprint)
      .digest('hex')
      .slice(0, 12)

    const fpFile = join(configDir, '.fingerprint')
    const stored = existsSync(fpFile) ? readFileSync(fpFile, 'utf-8').trim() : ''

    if (stored !== fingerprint) {
      log.info('[CopilotAgentService] Config changed (tools/prompt) — purging stale SDK sessions')
      try {
        if (existsSync(configDir)) rmSync(configDir, { recursive: true, force: true })
      } catch (e) {
        log.warn('[CopilotAgentService] Failed to purge sessions dir:', e)
      }
      mkdirSync(configDir, { recursive: true })
      writeFileSync(fpFile, fingerprint, 'utf-8')
      log.info('[CopilotAgentService] Sessions purged — new fingerprint: %s (tools: [%s])', fingerprint, toolNames)
    } else {
      log.info('[CopilotAgentService] Session fingerprint matches (%s) — no purge needed', fingerprint)
    }
  }

  updateSettings(settings: AppSettings): void {
    this.settings = settings
  }

  /** Interrupt the currently running agent turn (if any). */
  abort(): void {
    this._abortRequested = true
    if (this._activeSession) {
      this._activeSession.disconnect().catch(() => {})
      this._activeSession = null
      log.info('[CopilotAgentService] Abort requested — session disconnected')
    }
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

    this._abortRequested = false
    const session = await this._getOrCreateSession(conversationId)
    this._activeSession = session
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
      if (this._abortRequested) {
        // User-initiated stop — emit final with whatever was buffered
        onChunk({ type: 'final', content: fullReply || '' })
        log.info('[CopilotAgentService] Turn cancelled by user')
      } else {
        const raw = String(err)
        const msg = raw.includes('Personal Access Tokens are not supported')
          ? 'Authentication error: Personal Access Tokens (ghp_…) are not supported by the Copilot SDK.\n\n'
            + 'Please use a GitHub OAuth token. Run `gh auth token` in your terminal and paste the result into Settings → GitHub Token.'
          : `Agent error: ${raw}`
        onChunk({ type: 'error', content: msg })
        log.error('[CopilotAgentService] sendAndWait error:', err)
      }
    } finally {
      this._activeSession = null
      this._abortRequested = false
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
        excludedTools: EXCLUDED_BUILTIN_TOOLS,
        configDir: join(app.getPath('userData'), 'sdk-sessions'),
        systemMessage: {
          content: (this.settings.systemPrompt?.trim() || BASE_SYSTEM_PROMPT)
            + buildSkillsSection(this.settings.skills ?? {})
            + SEMANTIC_GATE_ADDENDUM,
        },
        streaming:    true,
        model:        this.settings.copilotModel || 'gpt-4o',
        ...(this.settings.reasoningEffort ? { reasoningEffort: this.settings.reasoningEffort } : {}),
      } as any)
      log.info('[CopilotAgentService] Resumed session %s with %d tools: [%s]',
        conversationId, tools.length, tools.map((t: any) => t.name).join(', '))
      return session
    } catch {
      // First message for this conversation (or session was deleted)
      log.info('[CopilotAgentService] Creating new session %s', conversationId)
      return client.createSession(this._buildSessionConfig(conversationId))
    }
  }

  private _buildSessionConfig(sessionId: string) {
    const tools   = this.toolRegistry?.getAll() ?? []
    log.info('[CopilotAgentService] Building session %s with %d tools: [%s]',
      sessionId, tools.length, tools.map((t: any) => t.name).join(', '))
    // Exclude built-in CLI shell tools — this agent works with the requirements
    // database only; unrestricted shell access causes infinite execution loops.
    const config: Record<string, unknown> = {
      sessionId,
      configDir:     join(app.getPath('userData'), 'sdk-sessions'),
      model:         this.settings.copilotModel || 'gpt-4o',
      streaming:     true,
      tools,
      excludedTools: EXCLUDED_BUILTIN_TOOLS,
      systemMessage: {
        content: (this.settings.systemPrompt?.trim() || BASE_SYSTEM_PROMPT)
          + buildSkillsSection(this.settings.skills ?? {})
          + SEMANTIC_GATE_ADDENDUM,
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
