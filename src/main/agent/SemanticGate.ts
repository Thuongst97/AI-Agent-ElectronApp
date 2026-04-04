/**
 * SemanticGate — runs a lightweight intent-check BEFORE dispatching any tool.
 *
 * Ported from the Python `SEMANTIC_GATE` + `INTENT_CHECK_PROMPT` in engine.py.
 *
 * The gate asks the LLM (without tools, without streaming) one question:
 *   "Is this query complete and actionable?"
 *
 * VERDICT: CLEAR   → proceed with the agent loop
 * VERDICT: UNCLEAR → return the clarifying question directly to the user
 *
 * The gate receives full conversation history so it can resolve follow-ups
 * correctly (e.g. a bare "show all" after "how many power requirements?" is CLEAR).
 */
import { BaseMessage, SystemMessage, HumanMessage } from '@langchain/core/messages'
import log from 'electron-log'
import type { LLMService } from './LLMService'

// ── Intent-check system prompt ─────────────────────────────────────────────────

const INTENT_CHECK_SYSTEM = `\
You are a query-completeness verifier for an AI assistant.

Available actions this assistant can perform:
  • Search / count requirements by TOPIC      → needs a topic keyword
  • Count requirements by ASSIGNEE            → needs a person name
  • List ALL requirements by ASSIGNEE         → needs a person name
  • Show team statistics / overview           → no extra info needed
  • Get DETAILS of a specific requirement     → needs a requirement ID  (format: Word_12345)
  • GENERATE TESTS for a specific requirement → needs a requirement ID  (format: Word_12345)
  • Analyse logs / files                      → needs a file path or log content
  • General greeting or open question         → no extra info needed

Rules:
  1. Map the latest user message to one of the actions above.
  2. If it maps clearly AND has all required details → VERDICT: CLEAR
  3. If the intent is recognisable but a required detail is MISSING:
       • "how many" with no topic AND no person name    → VERDICT: UNCLEAR
       • "generate tests" / "explain" with no requirement ID → VERDICT: UNCLEAR
  4. Consider the CONVERSATION HISTORY — a vague follow-up may be clear in context.
     Example: after "how many power requirements?", a bare "show all" is CLEAR (topic = power).
  5. Greetings, thanks, and casual chat are always CLEAR.
  6. Single words or obvious fragments ("does", "the", random letters) → VERDICT: UNCLEAR

Output format — EXACT, no extra text:

  VERDICT: CLEAR

or

  VERDICT: UNCLEAR
  QUESTION: <one concise clarifying question for the user>`

export interface GateResult {
  clear:    boolean
  question: string | null   // set when clear === false
}

export class SemanticGate {
  constructor(private readonly llm: LLMService) {}

  /**
   * Validate the user's latest message.
   *
   * @param userQuery   The raw user input to validate.
   * @param history     Recent conversation messages (for follow-up resolution).
   * @returns           { clear: true } or { clear: false, question: '...' }
   */
  async validate(userQuery: string, history: BaseMessage[]): Promise<GateResult> {
    // Always PASS greetings and very short conversational messages without
    // hitting the LLM — saves latency and a token round-trip.
    if (this._isObviouslyClear(userQuery)) {
      return { clear: true, question: null }
    }

    const messages: BaseMessage[] = [
      new SystemMessage(INTENT_CHECK_SYSTEM),
      ...history.slice(-6),   // last 3 turns is enough for context
      new HumanMessage(
        `Latest user message to evaluate:\n"${userQuery}"\n\nOutput ONLY the VERDICT block.`,
      ),
    ]

    try {
      const reply = await this.llm.invoke(messages)
      return this._parseVerdict(reply)
    } catch (err) {
      // Gate failure → default to CLEAR so the agent still tries to help
      log.warn('[SemanticGate] LLM call failed, defaulting to CLEAR: %s', String(err))
      return { clear: true, question: null }
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private _isObviouslyClear(query: string): boolean {
    const q = query.trim().toLowerCase()
    // Greetings
    if (/^(hi|hello|hey|thanks|thank you|ok|okay|sure|bye)[\s!?.]*$/.test(q)) return true
    // Long enough queries almost certainly have intent
    if (q.split(/\s+/).length >= 5) return true
    return false
  }

  private _parseVerdict(text: string): GateResult {
    const upper = text.toUpperCase()
    if (upper.includes('VERDICT: CLEAR')) {
      return { clear: true, question: null }
    }

    const qMatch = text.match(/QUESTION:\s*(.+)/i)
    const question = qMatch ? qMatch[1].trim() : 'Could you please clarify what you\'d like to know?'
    log.info('[SemanticGate] Query blocked — asking: %s', question)
    return { clear: false, question }
  }
}
