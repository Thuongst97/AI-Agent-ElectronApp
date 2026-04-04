/**
 * MemoryService — sliding-window conversation memory with JSON persistence.
 *
 * Responsibilities:
 *   1. Keep the last N turns (user + assistant pairs) in RAM.
 *   2. Provide `buildMessages(systemPrompt, userQuery)` that returns the full
 *      LangChain message array ready to pass to LLMService.streamChat().
 *   3. Persist history to `userData/conversations/<id>.history.json` so it
 *      survives app restarts (loaded lazily on first access per conversation).
 *
 * Thread-safety note: IPC calls to the main process are serialised by Electron
 * (one at a time per renderer), so no locking is needed here.
 */
import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import {
  BaseMessage,
  HumanMessage,
  AIMessage,
  SystemMessage,
} from '@langchain/core/messages'
import log from 'electron-log'

/** Maximum number of (user + assistant) turn pairs to keep in the context window. */
const MAX_HISTORY_TURNS = 12

export class MemoryService {
  /** In-memory cache: conversationId → message history */
  private readonly cache = new Map<string, BaseMessage[]>()
  private readonly dir:  string

  constructor() {
    this.dir = join(app.getPath('userData'), 'conversations')
    mkdirSync(this.dir, { recursive: true })
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Build the full message array for one LLM call:
   *   [SystemMessage] + last N history pairs + [HumanMessage(userQuery)]
   */
  buildMessages(conversationId: string, systemPrompt: string, userQuery: string): BaseMessage[] {
    const history = this._getHistory(conversationId)
    const window  = history.slice(-(MAX_HISTORY_TURNS * 2))
    return [
      new SystemMessage(systemPrompt),
      ...window,
      new HumanMessage(userQuery),
    ]
  }

  /**
   * Append a completed turn (user query + assistant reply) to memory and persist.
   * Call this AFTER the full streamed reply has been assembled.
   */
  appendTurn(conversationId: string, userQuery: string, assistantReply: string): void {
    const history = this._getHistory(conversationId)
    history.push(new HumanMessage(userQuery))
    history.push(new AIMessage(assistantReply))
    this.cache.set(conversationId, history)
    this._persist(conversationId, history)
  }

  /** Wipe history for a conversation (e.g. on chat:reset). */
  clear(conversationId: string): void {
    this.cache.set(conversationId, [])
    this._persist(conversationId, [])
    log.info('[MemoryService] Cleared history for conv=%s', conversationId)
  }

  /** Get raw history array (for display or export). */
  getHistory(conversationId: string): BaseMessage[] {
    return this._getHistory(conversationId)
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _getHistory(conversationId: string): BaseMessage[] {
    if (this.cache.has(conversationId)) {
      return this.cache.get(conversationId)!
    }
    // Lazy-load from disk on first access
    const loaded = this._load(conversationId)
    this.cache.set(conversationId, loaded)
    return loaded
  }

  private _path(conversationId: string): string {
    return join(this.dir, `${conversationId}.history.json`)
  }

  /** Serialise BaseMessage[] to a plain JSON format that survives process restart. */
  private _persist(conversationId: string, messages: BaseMessage[]): void {
    try {
      const serialisable = messages.map(m => ({
        type:    m._getType(),  // 'human' | 'ai' | 'system'
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      }))
      writeFileSync(this._path(conversationId), JSON.stringify(serialisable, null, 2), 'utf-8')
    } catch (err) {
      log.warn('[MemoryService] Failed to persist conv=%s: %s', conversationId, String(err))
    }
  }

  /** Deserialise from disk; returns [] if no history file exists yet. */
  private _load(conversationId: string): BaseMessage[] {
    const path = this._path(conversationId)
    if (!existsSync(path)) return []

    try {
      const raw  = readFileSync(path, 'utf-8')
      const data = JSON.parse(raw) as Array<{ type: string; content: string }>
      return data.map(entry => {
        switch (entry.type) {
          case 'human':  return new HumanMessage(entry.content)
          case 'ai':     return new AIMessage(entry.content)
          case 'system': return new SystemMessage(entry.content)
          default:       return new HumanMessage(entry.content)
        }
      })
    } catch (err) {
      log.warn('[MemoryService] Failed to load conv=%s: %s', conversationId, String(err))
      return []
    }
  }
}
