/**
 * LLMService — wraps LangChain.js ChatOpenAI targeting the GitHub Copilot /
 * GitHub Models OpenAI-compatible endpoint with **streaming** support.
 *
 * Streaming design:
 *   - `streamChat()` accepts an array of LangChain BaseMessages and calls
 *     `llm.stream()`, emitting each token chunk via the `onToken` callback.
 *   - A non-streaming `invoke()` shortcut is provided for quick probes
 *     (e.g. SemanticGate intent checks) where we don't need token-by-token output.
 *
 * Connection health:
 *   - `probe()` sends a single cheap message and returns 'connected' | 'error'.
 *   - Call probe() at startup and after settings changes.
 */
import { ChatOpenAI } from '@langchain/openai'
import { BaseMessage, HumanMessage } from '@langchain/core/messages'
import { StructuredTool } from '@langchain/core/tools'
import log from 'electron-log'
import type { AppSettings } from '../../shared/ipc-types'
import type { ConnectionState } from '../../shared/ipc-types'

export class LLMService {
  private llm:          ChatOpenAI | null = null
  private llmWithTools: ChatOpenAI | null = null
  private settings: AppSettings

  constructor(settings: AppSettings) {
    this.settings = settings
    this._buildClients()
  }

  // ── Build / Rebuild ──────────────────────────────────────────────────────────

  private _buildClients(): void {
    const { githubToken, llmBaseUrl, llmModel, llmMaxTokens, llmTemperature } = this.settings

    if (!githubToken) {
      log.warn('[LLMService] No API token configured — LLM unavailable until token is set in Settings')
      this.llm = null
      this.llmWithTools = null
      return
    }

    try {
      this.llm = new ChatOpenAI({
        modelName:    llmModel,
        openAIApiKey: githubToken,
        maxTokens:    llmMaxTokens,
        temperature:  llmTemperature,
        streaming:    true,
        configuration: { baseURL: llmBaseUrl },
      })
      // llmWithTools starts as the same instance; bindTools() updates it
      this.llmWithTools = this.llm
      log.info('[LLMService] Clients built (model=%s)', llmModel)
    } catch (err) {
      log.warn('[LLMService] Failed to build ChatOpenAI client: %s', String(err))
      this.llm = null
      this.llmWithTools = null
    }
  }

  /** Rebuild clients after settings change (e.g. new token / model). */
  updateSettings(settings: AppSettings): void {
    this.settings = settings
    this._buildClients()
    log.info('[LLMService] Rebuilt with new settings (model=%s)', settings.llmModel)
  }

  /** Bind tools so the LLM can perform function-calling (used in Phase 4). */
  bindTools(tools: StructuredTool[]): void {
    if (!this.llm) { log.warn('[LLMService] bindTools skipped — no client'); return }
    this.llmWithTools = this.llm.bindTools(tools) as unknown as ChatOpenAI
    log.info('[LLMService] Bound %d tools', tools.length)
  }

  // ── Streaming ────────────────────────────────────────────────────────────────

  /**
   * Stream a chat response token-by-token.
   * @param messages  Full conversation (system + history + user message)
   * @param onToken   Called for each partial token string as it arrives
   * @param useTools  When true, uses the tools-bound model (Phase 4+)
   * @returns         Assembled full reply text
   */
  async streamChat(
    messages:  BaseMessage[],
    onToken:   (token: string) => void,
    useTools = false,
  ): Promise<string> {
    const model = useTools ? (this.llmWithTools ?? this.llm) : this.llm
    if (!model) throw new Error('LLM not configured — please set your GitHub token in Settings')
    let fullContent = ''

    log.debug('[LLMService] streamChat — %d messages, useTools=%s', messages.length, useTools)

    const stream = await model.stream(messages)

    for await (const chunk of stream) {
      const token = typeof chunk.content === 'string'
        ? chunk.content
        : Array.isArray(chunk.content)
          ? chunk.content.map(c => (typeof c === 'string' ? c : '')).join('')
          : ''

      if (token) {
        onToken(token)
        fullContent += token
      }
    }

    return fullContent
  }

  /**
   * Non-streaming single invoke — used by SemanticGate and quick checks.
   * @returns The assistant's reply text
   */
  async invoke(messages: BaseMessage[]): Promise<string> {
    if (!this.llm) throw new Error('LLM not configured — please set your GitHub token in Settings')
    log.debug('[LLMService] invoke — %d messages', messages.length)
    const response = await this.llm.invoke(messages)
    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content)
  }

  /**
   * Invoke with tool-calling enabled (for AgentService loop in Phase 4).
   * Returns the raw AIMessage so the caller can inspect `.tool_calls`.
   */
  async invokeWithTools(messages: BaseMessage[]) {
    const model = this.llmWithTools ?? this.llm
    if (!model) throw new Error('LLM not configured — please set your GitHub token in Settings')
    return model.invoke(messages)
  }

  // ── Health probe ─────────────────────────────────────────────────────────────

  async probe(): Promise<ConnectionState> {
    try {
      await this.invoke([new HumanMessage('ping')])
      log.info('[LLMService] probe → connected')
      return 'connected'
    } catch (err) {
      log.warn('[LLMService] probe → error: %s', String(err))
      return 'error'
    }
  }

  /** Expose raw model for tool-registration inspection */
  get rawLlm(): ChatOpenAI | null { return this.llm }
}
