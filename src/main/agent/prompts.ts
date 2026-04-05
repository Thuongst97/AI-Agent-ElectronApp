/**
 * System prompts for the AI agent.
 *
 * BASE_SYSTEM_PROMPT  — injected at the top of every LLM call.
 * SYNTHESIS_PROMPT_*  — appended after tool results to guide the final answer.
 * SEMANTIC_GATE_ADDENDUM — injected into every system message for the tool-calling
 *                           loop so the model silently validates intent before acting.
 * buildSkillsSection  — composes enabled skills into an additional system-prompt block.
 */

import type { SkillConfig } from '../../shared/ipc-types'
import { DEFAULT_SYSTEM_PROMPT } from '../../shared/defaultSystemPrompt'

// ── Default skill instructions (keyed by skill key) ───────────────────────────
// These are the fallback instructions when the user has not overridden them.
// Keep in sync with src/renderer/src/constants/skills.ts defaultInstruction values.
const DEFAULT_SKILL_INSTRUCTIONS: Record<string, string> = {
  jira_analysis:
    'When analysing Jira tickets:\n' +
    '1. Fetch the ticket(s) using get_ticket_details or search_project_tickets.\n' +
    '2. Call search_requirements with keywords from the ticket summary/description to find related requirements.\n' +
    '3. Output a Markdown table: Ticket Key | Summary | Status | Linked Requirement IDs | Gaps.\n' +
    '4. In the Gaps column, flag any ticket that has no matching requirement as "⚠️ No req found".\n' +
    '5. Conclude with a short risk summary.',

  requirement_search:
    'When searching or listing requirements:\n' +
    '1. Always return results as a Markdown table: ID | Name | Description | Assignee | Priority.\n' +
    '2. Never show raw similarity scores.\n' +
    '3. If fewer than 3 results are returned, automatically suggest: "Try broadening the query with related terms: <suggestion>".\n' +
    '4. For a single-ID lookup, include the full description and all metadata fields.\n' +
    '5. When showing related requirements, explain the relationship in one sentence.',

  test_generation:
    'When generating test cases:\n' +
    '1. First fetch the relevant requirement(s) using search_requirements or get_requirement_by_id.\n' +
    '2. For each requirement, produce three test levels: Unit | Integration | System.\n' +
    '3. Format as a table: Test ID | Level | Description | Input | Expected Output | Req ID.\n' +
    '4. Assign Test IDs as TC-<REQ_ID>-U01, TC-<REQ_ID>-I01, TC-<REQ_ID>-S01.\n' +
    '5. Add edge-case tests for boundary conditions, null inputs, and hardware faults where applicable.',

  gap_analysis:
    'When performing gap analysis:\n' +
    '1. Search requirements for all relevant topics using multiple queries.\n' +
    '2. Classify each gap as: Missing (requirement absent) | Incomplete (partial coverage) | Ambiguous (unclear wording).\n' +
    '3. Assign severity: Critical | Major | Minor — based on safety/functional impact.\n' +
    '4. Reference applicable standards by clause: ISO 26262-X §Y, ISO/SAE 21434 §Z, ASPICE BP.\n' +
    '5. Output as a Markdown table: Gap | Type | Severity | Affected Req IDs | Standard Reference.\n' +
    '6. Never skip the Identified Gaps section even if the list is empty — write "No gaps found" explicitly.',

  weekly_report:
    'When generating a weekly report:\n' +
    '1. Call search_project_tickets for the current sprint / recent tickets.\n' +
    '2. Group tickets by status: Done | In Progress | Blocked | To Do.\n' +
    '3. Compute: completion % = Done / Total tickets.\n' +
    '4. Output sections: Summary | Done This Week | In Progress | Blockers | Planned Next Week.\n' +
    '5. Flag any ticket with no update in 3+ days as 🔴 Stale.\n' +
    '6. Keep bullet points concise — one line per ticket.',
}

/**
 * Build the skills section for the system prompt from the user's saved skill configs.
 * Returns an empty string if no skills are enabled.
 */
export function buildSkillsSection(skills: Record<string, SkillConfig>): string {
  const activeEntries = Object.entries(skills).filter(([, cfg]) => cfg.enabled)
  if (activeEntries.length === 0) return ''

  const lines: string[] = [
    '',
    '── ACTIVE SKILLS (follow these instructions for the relevant task types) ──────',
  ]

  for (const [key, cfg] of activeEntries) {
    const instruction = cfg.customInstruction?.trim() || DEFAULT_SKILL_INSTRUCTIONS[key] || ''
    if (!instruction) continue
    // Find a friendly label — fall back to the key itself
    const label = key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
    lines.push('', `[${label}]`, instruction)
  }

  lines.push('────────────────────────────────────────────────────────────────────────────')
  return lines.join('\n')
}

/**
 * BASE_SYSTEM_PROMPT re-exported from shared so both main and renderer
 * reference the same source string.
 */
export const BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT

export const SEMANTIC_GATE_ADDENDUM = `

── SEMANTIC INTENT GATE (run silently before every action) ──────────────────

Before calling any tool, confirm:
  STEP 1 – Is the message a complete, coherent thought with a clear intent?
  STEP 2 – Is it within the domain this assistant handles?
            Domain includes: requirements engineering, telematics, automotive,
            embedded systems, project management, AND project ticket management.
            Any mention of a ticket key (e.g. SCRUM-1, APP-7) is IN domain.
  STEP 3 – Does the implied action have all required parameters?

If any step fails: ask ONE targeted clarifying question. Never call a tool
with missing or nonsensical parameters.
────────────────────────────────────────────────────────────────────────────`

export const SYNTHESIS_PROMPT_CONCISE = `\
You called: {toolNames}. The user asked a simple factual question.

Check relevance: do the tool results actually relate to what the user asked?
  • If YES: reply with a short, direct answer — 1-sentence summary + clean table.
  • If NO: respond "I couldn't find anything matching that — could you rephrase?"

Keep the total response under 10 lines. Do NOT include analysis or next-steps sections.`

export const SYNTHESIS_PROMPT_FULL = `\
You called: {toolNames}. The user's query was: "{queryPreview}".

Check relevance first. If relevant, write your final response with ALL 5 sections:

 1. 🔍 **Analysis Trace** — tool called, args, result count, first pattern spotted.
 2. 📊 **Findings** — data in a clean Markdown table, no raw text dumps.
 3. 🧠 **Engineering Analysis** — apply the most relevant skill; cite specific requirement
    IDs; reference ISO 26262 / ISO/SAE 21434 / ASPICE clauses by number where relevant.
 4. ⚠️ **Identified Gaps / Risks** — list what is ABSENT with exact severity labels.
    Be explicit: "No requirement covers [X] → Severity: Critical". Never skip this.
 5. ➡️ **Recommended Next Steps** — 2–3 items, each referencing a specific req ID or standard.

Show your reasoning. A senior engineer should learn something from your response.`
