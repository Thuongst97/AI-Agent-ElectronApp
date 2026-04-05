/**
 * Requirement tool implementations — migrated to GitHub Copilot SDK.
 *
 * Tools use raw JSON Schema (not Zod) to avoid schema-serialisation issues,
 * and every handler returns an error string instead of throwing — the SDK
 * treats thrown exceptions as "tool unavailable", which confuses the model.
 *
 * Tools:
 *   search_requirements           → semantic similarity search
 *   get_requirement_by_id         → exact ID lookup
 *   get_requirements_by_assignee  → filter by owner name
 *   get_related_requirements      → similar reqs for a given ID
 *   get_assignee_statistics       → workload breakdown
 */

import { defineTool }            from '@github/copilot-sdk'
import type { Tool }             from '@github/copilot-sdk'
import type { VectorMemoryService } from '../data/VectorMemoryService'
import log from 'electron-log'

/**
 * Build all requirement tools bound to the provided VectorMemoryService.
 * Pass the returned array directly to `client.createSession({ tools })`.
 */
export function makeRequirementTools(memory: VectorMemoryService): Tool[] {
  return [

    // ── 1. search_requirements ───────────────────────────────────────────────

    defineTool('search_requirements', {
      description:
        'Perform a semantic similarity search over the requirements database. ' +
        'Use this when the user asks to find, search, or query requirements ' +
        'by topic, keyword, or natural-language description. ' +
        'Returns a Markdown table of the most relevant requirements.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural-language search query, e.g. "OTA firmware update security"',
          },
          n_results: {
            type: 'number',
            description: 'Maximum number of results to return (default 5)',
            default: 5,
          },
        },
        required: ['query'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          const query     = args.query as string
          const n_results = typeof args.n_results === 'number' ? args.n_results : 5
          log.info('[search_requirements] query="%s" n=%d', query, n_results)
          return await memory.queryTable(query, n_results)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[search_requirements] error:', msg)
          return `Error searching requirements: ${msg}`
        }
      },
    }),

    // ── 2. get_requirement_by_id ─────────────────────────────────────────────

    defineTool('get_requirement_by_id', {
      description:
        'Look up a single requirement by its exact ID (e.g. Core_01110, APP_02050). ' +
        'Use this when the user asks for a specific requirement by ID. ' +
        'Returns the full description, user story, and assignee.',
      parameters: {
        type: 'object',
        properties: {
          requirement_id: {
            type: 'string',
            description: 'The exact requirement ID, e.g. "Core_01150" or "APP_01060"',
          },
        },
        required: ['requirement_id'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          const requirement_id = args.requirement_id as string
          log.info('[get_requirement_by_id] id=%s', requirement_id)
          const row = await memory.getById(requirement_id)
          if (!row) return `No requirement found with ID: ${requirement_id}`
          return [
            `**${row.reqId}** — ${row.userStory}`,
            '',
            `**Description:** ${row.description}`,
            '',
            `**Assignee:** ${row.assignee}`,
          ].join('\n')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[get_requirement_by_id] error:', msg)
          return `Error fetching requirement: ${msg}`
        }
      },
    }),

    // ── 3. get_requirements_by_assignee ─────────────────────────────────────

    defineTool('get_requirements_by_assignee', {
      description:
        'Retrieve all requirements assigned to a specific team member. ' +
        'Use this when the user asks "show requirements for <name>", ' +
        '"what is <name> working on", or "list <name>\'s requirements". ' +
        'Returns a Markdown table of matching requirements.',
      parameters: {
        type: 'object',
        properties: {
          assignee_name: {
            type: 'string',
            description: 'The assignee name exactly as stored, e.g. "mimi", "harry", "teetee", "vtee", "stee"',
          },
        },
        required: ['assignee_name'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          const assignee_name = args.assignee_name as string
          log.info('[get_requirements_by_assignee] assignee=%s', assignee_name)
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[get_requirements_by_assignee] error:', msg)
          return `Error fetching requirements: ${msg}`
        }
      },
    }),

    // ── 4. get_related_requirements ─────────────────────────────────────────

    defineTool('get_related_requirements', {
      description:
        'Find requirements that are semantically similar to a given requirement ID. ' +
        'Use this for impact analysis, dependency discovery, or when the user asks ' +
        '"what is related to <ID>" or "find similar requirements to <ID>". ' +
        'Returns a ranked Markdown table of related requirements.',
      parameters: {
        type: 'object',
        properties: {
          requirement_id: {
            type: 'string',
            description: 'The source requirement ID to find relatives for, e.g. "Core_01150"',
          },
          n_results: {
            type: 'number',
            description: 'How many related requirements to return (default 3)',
            default: 3,
          },
        },
        required: ['requirement_id'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          const requirement_id = args.requirement_id as string
          const n_results      = typeof args.n_results === 'number' ? args.n_results : 3
          log.info('[get_related_requirements] id=%s n=%d', requirement_id, n_results)
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
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[get_related_requirements] error:', msg)
          return `Error fetching related requirements: ${msg}`
        }
      },
    }),

    // ── 5. get_assignee_statistics ───────────────────────────────────────────

    defineTool('get_assignee_statistics', {
      description:
        'Return a workload breakdown showing how many requirements are assigned ' +
        'to each team member. Use this for team overview, "how many requirements ' +
        'does each person have", or "show statistics" queries. ' +
        'Returns a sorted Markdown table of assignees and their requirement counts.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      skipPermission: true,
      handler: async () => {
        try {
          const stats   = await memory.getAssigneeStats()
          const total   = await memory.totalCount()
          const entries = Object.entries(stats).sort((a, b) => b[1] - a[1])

          if (entries.length === 0) return 'No requirements in the database yet.'

          const header = '| Assignee | Requirements | % of Total |\n|---|---|---|'
          const lines  = entries.map(([name, count]) => {
            const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0.0'
            return `| ${name} | ${count} | ${pct}% |`
          })
          return [
            `**Requirements by Assignee** (${total} total)`,
            '',
            header,
            ...lines,
          ].join('\n')
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[get_assignee_statistics] error:', msg)
          return `Error fetching statistics: ${msg}`
        }
      },
    }),

  ]
}