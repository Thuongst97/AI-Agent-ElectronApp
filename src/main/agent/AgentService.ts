/**
 * AgentService — the main agentic orchestration loop.
 *
 * Architecture (mirrors Python engine.py):
 *
 *   User message
 *       │
 *       ▼
 *   SemanticGate.validate()          ← intent completeness check
 *       │ PASS
 *       ▼
 *   MemoryService.buildMessages()    ← system prompt + last N turns + user query
 *       │
 *       ▼
 *   LLMService.streamChat()          ← streams tokens via onChunk callback
 *       │
 *       ├── tool_calls present?  YES → ToolRegistry.run()  (Phase 4)
 *       │                               → append ToolMessage → loop back
 *       │
 *       └── final text → onChunk('final') + persist via MemoryService
 *
 * Phase 2: full streaming pipeline with no tools.
 * Phase 4: tool-calling loop added via ToolRegistry injection.
 */

import log from 'electron-log'
import { LLMService }    from './LLMService'
import { MemoryService } from './MemoryService'
import { SemanticGate }  from './SemanticGate'
import {
  BASE_SYSTEM_PROMPT,
  SEMANTIC_GATE_ADDENDUM,
  SYNTHESIS_PROMPT_CONCISE,
  SYNTHESIS_PROMPT_FULL,
} from './prompts'
import type { ChatChunk, ChatRequest } from '../../shared/ipc-types'
import { ToolMessage, AIMessage, HumanMessage } from '@langchain/core/messages'

// ── Tool interface (fulfilled by ToolRegistry in Phase 4) ─────────────────────

export interface ToolInput  { [key: string]: unknown }
export interface ToolOutput { content: string; metadata?: Record<string, unknown> }

export interface RegisteredTool {
  name:        string
  description: string
  run(input: ToolInput): Promise<ToolOutput>
}

export interface IToolRegistry {
  getAll():          RegisteredTool[]
  get(name: string): RegisteredTool | undefined
  toLangChainTools(): import('@langchain/core/tools').StructuredTool[]
}

// ── Simple‐query detector ─────────────────────────────────────────────────────
// Returns true for counts / lists / stats — uses the concise synthesis prompt.
// Returns false for engineering analysis — uses the full 5-section prompt.

function isSimpleQuery(query: string): boolean {
  const q = query.toLowerCase()
  const complexSignals = [
    'analyz', 'analyse', 'generate test', 'test case', 'test suite',
    'gap', 'risk', 'compliance', 'impact', 'conflict', 'prioriti',
    'review', 'audit', 'explain', 'what is', 'how does', 'how do',
    'depend', 'integrat', 'certif', 'iso ', 'asil', 'aspice',
    'improve', 'recommend', 'assess',
  ]
  if (complexSignals.some(s => q.includes(s))) return false
  const simpleSignals = [
    'how many', 'count', 'number of', 'total', 'statistic',
    'overview', 'show all', 'list all', 'show me all',
    'who has', 'assigned to',
  ]
  return simpleSignals.some(s => q.includes(s))
}

// ── AgentService ──────────────────────────────────────────────────────────────

export class AgentService {
  private readonly llm:    LLMService
  private readonly memory: MemoryService
  private readonly gate:   SemanticGate
  private toolRegistry:    IToolRegistry | null = null

  private get systemPrompt() {
    return BASE_SYSTEM_PROMPT + SEMANTIC_GATE_ADDENDUM
  }

  constructor(llm: LLMService, memory: MemoryService) {
    this.llm    = llm
    this.memory = memory
    this.gate   = new SemanticGate(llm)
  }

  /** Inject tool registry (called from Phase 4 ToolRegistry init). */
  setToolRegistry(registry: IToolRegistry): void {
    this.toolRegistry = registry
    // Re-bind tools on the LLM client
    this.llm.bindTools(registry.toLangChainTools())
    log.info('[AgentService] Tool registry set — %d tools bound', registry.getAll().length)
  }

  // ── Main entry point ─────────────────────────────────────────────────────────

  /**
   * Process one user message end-to-end, emitting ChatChunks via `onChunk`.
   *
   * Chunk sequence:
   *   token …   (one per streamed word/token)
   *   [tool_call + tool_result …]   (Phase 4, when tools are registered)
   *   final     (marks end of stream)
   */
  async chat(req: ChatRequest, onChunk: (chunk: ChatChunk) => void): Promise<void> {
    const { message: userQuery, conversationId } = req

    log.info('[AgentService] chat — conv=%s query="%s"', conversationId, userQuery.slice(0, 60))

    // ── 1. Semantic gate ─────────────────────────────────────────────────────
    const history = this.memory.getHistory(conversationId)
    const gate    = await this.gate.validate(userQuery, history)

    if (!gate.clear) {
      const clarification = gate.question ?? 'Could you please clarify your question?'
      // Stream clarification as normal text so the renderer shows it naturally
      for (const word of clarification.split(' ')) {
        onChunk({ type: 'token', content: word + ' ' })
        await sleep(10)
      }
      onChunk({ type: 'final', content: '' })
      // Don't persist this to memory — it's a meta-interaction, not a real turn
      return
    }

    // ── 2. Tool-calling path (Phase 4) ───────────────────────────────────────
    if (this.toolRegistry && this.toolRegistry.getAll().length > 0) {
      await this._runWithTools(req, onChunk)
      return
    }

    // ── 3. Direct streaming path (Phase 2 — no tools) ────────────────────────
    const messages = this.memory.buildMessages(conversationId, this.systemPrompt, userQuery)

    let fullReply = ''
    try {
      fullReply = await this.llm.streamChat(
        messages,
        token => onChunk({ type: 'token', content: token }),
        false, // useTools = false at this phase
      )
    } catch (err) {
      log.error('[AgentService] streamChat error: %s', String(err))
      onChunk({ type: 'error', content: `LLM error: ${String(err)}` })
      return
    }

    // Persist the completed turn
    this.memory.appendTurn(conversationId, userQuery, fullReply)

    onChunk({ type: 'final', content: '' })
    log.info('[AgentService] Turn complete — %d chars', fullReply.length)
  }

  /** Reset conversation memory for a given conversation. */
  reset(conversationId: string): void {
    this.memory.clear(conversationId)
  }

  // ── Tool-calling loop (active from Phase 4 onwards) ───────────────────────

  private async _runWithTools(
    req:     ChatRequest,
    onChunk: (chunk: ChatChunk) => void,
  ): Promise<void> {
    const { message: userQuery, conversationId } = req
    const registry = this.toolRegistry!
    const messages = this.memory.buildMessages(conversationId, this.systemPrompt, userQuery)
    const toolsUsed: string[] = []

    // Agentic loop: LLM → tool calls → tool results → LLM → … → final answer
    const MAX_ITERATIONS = 6
    let iteration = 0

    while (iteration < MAX_ITERATIONS) {
      iteration++
      log.debug('[AgentService] Tool loop iteration %d', iteration)

      // Step 1: LLM decides which tool(s) to call
      let response: Awaited<ReturnType<LLMService['invokeWithTools']>>
      try {
        response = await this.llm.invokeWithTools(messages)
      } catch (err) {
        onChunk({ type: 'error', content: `LLM error: ${String(err)}` })
        return
      }

      const toolCalls = (response as any).tool_calls as Array<{
        id:   string
        name: string
        args: ToolInput
      }> | undefined

      // Step 2: No tool calls → synthesise final answer and stream it
      if (!toolCalls || toolCalls.length === 0) {
        const simple   = isSimpleQuery(userQuery)
        const preview  = userQuery.slice(0, 60) + (userQuery.length > 60 ? '…' : '')
        const toolNames = toolsUsed.map(t => `\`${t}\``).join(', ') || 'none'
        const synthPrompt = simple
          ? SYNTHESIS_PROMPT_CONCISE.replace('{toolNames}', toolNames)
          : SYNTHESIS_PROMPT_FULL.replace('{toolNames}', toolNames).replace('{queryPreview}', preview)

        // If there were tool calls earlier, ask the LLM to synthesise
        const finalMessages = toolsUsed.length > 0
          ? [...messages, new HumanMessage(synthPrompt)]
          : messages

        let fullReply = ''
        try {
          fullReply = await this.llm.streamChat(
            finalMessages,
            token => onChunk({ type: 'token', content: token }),
          )
        } catch (err) {
          onChunk({ type: 'error', content: `LLM error: ${String(err)}` })
          return
        }

        this.memory.appendTurn(conversationId, userQuery, fullReply)
        onChunk({ type: 'final', content: '' })
        return
      }

      // Step 3: Execute each tool and attach results as ToolMessages
      messages.push(response as AIMessage)

      for (const tc of toolCalls) {
        const tool = registry.get(tc.name)
        toolsUsed.push(tc.name)

        onChunk({ type: 'tool_call', content: JSON.stringify(tc.args, null, 2), toolName: tc.name })
        log.info('[AgentService] Calling tool "%s" with args: %o', tc.name, tc.args)

        let toolResult: string
        if (tool) {
          try {
            const output = await tool.run(tc.args)
            toolResult   = output.content
          } catch (err) {
            toolResult = `Tool error (${tc.name}): ${String(err)}`
            log.error('[AgentService] Tool "%s" failed: %s', tc.name, String(err))
          }
        } else {
          toolResult = `Unknown tool: ${tc.name}`
        }

        onChunk({ type: 'tool_result', content: toolResult, toolName: tc.name })
        messages.push(new ToolMessage({ content: toolResult, tool_call_id: tc.id }))
      }
    }

    // Safety: if MAX_ITERATIONS reached, ask for a final answer anyway
    log.warn('[AgentService] Max tool iterations reached — forcing synthesis')
    let fullReply = ''
    try {
      fullReply = await this.llm.streamChat(
        [...messages, new HumanMessage('Summarise what you have found so far.')],
        token => onChunk({ type: 'token', content: token }),
      )
    } catch (_err) {
      onChunk({ type: 'error', content: 'Max iterations reached without a final answer.' })
      return
    }
    this.memory.appendTurn(conversationId, userQuery, fullReply)
    onChunk({ type: 'final', content: '' })
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
