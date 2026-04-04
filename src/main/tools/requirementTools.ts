/**
 * Requirement tool implementations — Phase 4.
 *
 * Five LangChain StructuredTools that wrap VectorMemoryService methods,
 * mirroring the Python agent's tool set (agent.py).
 *
 * Each tool:
 *   • Has a Zod input schema (enables LLM function-calling JSON)
 *   • Returns a plain string (Markdown) that the LLM synthesises into prose
 *   • Is stateless — VectorMemoryService is injected at construction time
 *
 * Tools:
 *   search_requirements           → semantic similarity search
 *   get_requirement_by_id         → exact ID lookup
 *   get_requirements_by_assignee  → filter by owner name
 *   get_related_requirements      → similar reqs for a given ID
 *   get_assignee_statistics       → workload breakdown
 */

import { DynamicStructuredTool } from '@langchain/core/tools'
import { z }                     from 'zod'
import type { VectorMemoryService } from '../data/VectorMemoryService'

// ── 1. search_requirements ─────────────────────────────────────────────────────

export function makeSearchRequirementsTool(memory: VectorMemoryService) {
  return new DynamicStructuredTool({
    name: 'search_requirements',
    description:
      'Perform a semantic similarity search over the requirements database. ' +
      'Use this when the user asks to find, search, or query requirements ' +
      'by topic, keyword, or natural-language description. ' +
      'Returns a Markdown table of the most relevant requirements.',
    schema: z.object({
      query: z.string().describe(
        'Natural-language search query, e.g. "OTA firmware update security"',
      ),
      n_results: z.number().int().min(1).max(20).default(5).describe(
        'Maximum number of results to return (default 5)',
      ),
    }),
    func: async ({ query, n_results }) => {
      const table = await memory.queryTable(query, n_results)
      return table
    },
  })
}

// ── 2. get_requirement_by_id ───────────────────────────────────────────────────

export function makeGetByIdTool(memory: VectorMemoryService) {
  return new DynamicStructuredTool({
    name: 'get_requirement_by_id',
    description:
      'Look up a single requirement by its exact ID (e.g. Core_01110, APP_02050). ' +
      'Use this when the user asks for a specific requirement by ID. ' +
      'Returns the full description, user story, and assignee.',
    schema: z.object({
      requirement_id: z.string().describe(
        'The exact requirement ID, e.g. "Core_01150" or "APP_01060"',
      ),
    }),
    func: async ({ requirement_id }) => {
      const row = await memory.getById(requirement_id)
      if (!row) return `No requirement found with ID: ${requirement_id}`
      return [
        `**${row.reqId}** — ${row.userStory}`,
        '',
        `**Description:** ${row.description}`,
        '',
        `**Assignee:** ${row.assignee}`,
      ].join('\n')
    },
  })
}

// ── 3. get_requirements_by_assignee ───────────────────────────────────────────

export function makeGetByAssigneeTool(memory: VectorMemoryService) {
  return new DynamicStructuredTool({
    name: 'get_requirements_by_assignee',
    description:
      'Retrieve all requirements assigned to a specific team member. ' +
      'Use this when the user asks "show requirements for <name>", ' +
      '"what is <name> working on", or "list <name>\'s requirements". ' +
      'Returns a Markdown table of matching requirements.',
    schema: z.object({
      assignee_name: z.string().describe(
        'The assignee name exactly as stored, e.g. "mimi", "harry", "teetee", "vtee", "stee"',
      ),
    }),
    func: async ({ assignee_name }) => {
      const rows = await memory.getByAssignee(assignee_name)
      if (rows.length === 0) {
        return `No requirements found for assignee: ${assignee_name}`
      }
      const header = '| Requirement ID | Description | User Story |\n|---|---|---|'
      const lines  = rows.map(r => {
        const desc = r.description.replace(/\|/g, '\\|').slice(0, 120)
        return `| ${r.reqId} | ${desc} | ${r.userStory} |`
      })
      return [`**${rows.length} requirement(s) assigned to ${assignee_name}:**`, '', header, ...lines].join('\n')
    },
  })
}

// ── 4. get_related_requirements ────────────────────────────────────────────────

export function makeGetRelatedTool(memory: VectorMemoryService) {
  return new DynamicStructuredTool({
    name: 'get_related_requirements',
    description:
      'Find requirements that are semantically similar to a given requirement ID. ' +
      'Use this for impact analysis, dependency discovery, or when the user asks ' +
      '"what is related to <ID>" or "find similar requirements to <ID>". ' +
      'Returns a ranked Markdown table of related requirements.',
    schema: z.object({
      requirement_id: z.string().describe(
        'The source requirement ID to find relatives for, e.g. "Core_01150"',
      ),
      n_results: z.number().int().min(1).max(10).default(3).describe(
        'How many related requirements to return (default 3)',
      ),
    }),
    func: async ({ requirement_id, n_results }) => {
      const rows = await memory.getRelated(requirement_id, n_results)
      if (rows.length === 0) {
        return `No related requirements found for: ${requirement_id}`
      }
      const header = '| Requirement ID | Description | Assignee |\n|---|---|---|'
      const lines  = rows.map(r => {
        const desc = r.description.replace(/\|/g, '\\|').slice(0, 120)
        return `| ${r.reqId} | ${desc} | ${r.assignee} |`
      })
      return [`**Requirements related to ${requirement_id}:**`, '', header, ...lines].join('\n')
    },
  })
}

// ── 5. get_assignee_statistics ─────────────────────────────────────────────────

export function makeAssigneeStatsTool(memory: VectorMemoryService) {
  return new DynamicStructuredTool({
    name: 'get_assignee_statistics',
    description:
      'Return a workload breakdown showing how many requirements are assigned ' +
      'to each team member. Use this for team overview, "how many requirements ' +
      'does each person have", or "show statistics" queries. ' +
      'Returns a sorted Markdown table of assignees and their requirement counts.',
    schema: z.object({}),
    func: async () => {
      const stats   = await memory.getAssigneeStats()
      const total   = await memory.totalCount()
      const entries = Object.entries(stats).sort((a, b) => b[1] - a[1])

      if (entries.length === 0) return 'No requirements in the database yet.'

      const header  = '| Assignee | Requirements | % of Total |\n|---|---|---|'
      const lines   = entries.map(([name, count]) => {
        const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
        return `| ${name} | ${count} | ${pct}% |`
      })
      return [
        `**Requirements by Assignee** (${total} total)`,
        '',
        header,
        ...lines,
      ].join('\n')
    },
  })
}
