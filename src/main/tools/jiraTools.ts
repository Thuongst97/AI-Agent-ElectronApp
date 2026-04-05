/**
 * Jira tools for the Copilot agent.
 *
 * Tools use raw JSON Schema (not Zod) to avoid schema-serialisation issues,
 * and every handler wraps errors in a return string instead of throwing —
 * the SDK treats thrown exceptions as "tool unavailable", which confuses the model.
 *
 * Tools:
 *   ping_jira              → connectivity / config check (diagnostic)
 *   get_ticket_details     → fetch & format a single Jira issue by key
 *   search_project_tickets → JQL search, returns a formatted summary list
 */

import { defineTool }       from '@github/copilot-sdk'
import type { Tool }        from '@github/copilot-sdk'
import type { JiraService } from '../services/JiraService'
import log from 'electron-log'

export function makeJiraTools(jira: JiraService): Tool[] {
  return [

    // ── 0. ping_jira (diagnostic — always callable) ──────────────────────────

    defineTool('ping_jira', {
      description:
        'Check whether the Jira integration is configured and reachable. ' +
        'Returns a short status message. Use this to verify connectivity before ' +
        'fetching tickets.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      skipPermission: true,
      handler: async () => {
        try {
          if (!jira.isConfigured()) {
            return 'Jira is NOT configured — no credentials found in Settings.'
          }
          const result = await jira.searchIssues('assignee = currentUser()', 1)
          const total  = result.total ?? result.totalCount ?? result.issues.length
          return `Jira is connected ✓  (found ${total} ticket(s) assigned to you)`
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[ping_jira] error:', msg)
          return `Jira connectivity error: ${msg}`
        }
      },
    }),

    // ── 1. get_ticket_details ────────────────────────────────────────────────

    defineTool('get_ticket_details', {
      description:
        'Fetch a project ticket by its key and return a full Markdown summary ' +
        'including status, priority, assignee, description and recent comments. ' +
        'Use this when the user provides a ticket key such as SCRUM-42 or APP-7 ' +
        'and asks to analyze, summarize, review, or explain it. ' +
        'This tool reads from the project management database.',
      parameters: {
        type: 'object',
        properties: {
          issue_key: {
            type: 'string',
            description: 'The ticket key, e.g. "SCRUM-42" or "APP-7"',
          },
        },
        required: ['issue_key'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          if (!jira.isConfigured()) {
            return 'Jira is not configured. Please add credentials in Settings → Jira.'
          }
          const key = (args.issue_key as string).trim().toUpperCase()
          log.info('[get_ticket_details] fetching %s', key)
          const issue = await jira.getIssue(key)
          return jira.formatIssue(issue)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[get_ticket_details] error:', msg)
          return `Error fetching ticket: ${msg}`
        }
      },
    }),

    // ── 2. search_project_tickets ─────────────────────────────────────────────

    defineTool('search_project_tickets', {
      description:
        'Search project tickets using a JQL query and return a summary list. ' +
        'Use this when the user wants to find tickets by project, status, assignee, ' +
        'sprint, label, or any other filter. This tool queries the project management database. ' +
        'Examples: "project = SCRUM AND status = Open", ' +
        '"assignee = currentUser() AND sprint in openSprints()", ' +
        '"assignee = currentUser()" to find tickets assigned to the current user.',
      parameters: {
        type: 'object',
        properties: {
          jql: {
            type: 'string',
            description: 'JQL query string, e.g. "project = SCRUM AND status = Open"',
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results to return (default 10, max 50)',
            default: 10,
          },
        },
        required: ['jql'],
      },
      skipPermission: true,
      handler: async (args: any) => {
        try {
          if (!jira.isConfigured()) {
            return 'Jira is not configured. Please add credentials in Settings → Jira.'
          }
          const jql        = args.jql as string
          const maxResults = typeof args.max_results === 'number' ? args.max_results : 10
          log.info('[search_project_tickets] JQL: %s (max=%d)', jql, maxResults)
          const result = await jira.searchIssues(jql, maxResults)
          return jira.formatSearchResult(result)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.error('[search_project_tickets] error:', msg)
          return `Error searching tickets: ${msg}`
        }
      },
    }),

  ]
}
