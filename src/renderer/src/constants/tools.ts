// ── Tool picker constants ─────────────────────────────────────────────────────
// Mirrors the tools registered in ToolRegistry / jiraTools / requirementTools.
// Used by InputBar to let the user hint the agent toward specific tools.

export interface ToolOption {
  value:       string  // matches the defineTool() name in main
  label:       string  // short display text
  description: string  // one-line tooltip
}

export interface ToolGroup {
  group: string
  icon:  string
  tools: ToolOption[]
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    group: 'Jira',
    icon:  '🎫',
    tools: [
      {
        value:       'search_project_tickets',
        label:       'Search Tickets',
        description: 'JQL search across Jira project tickets',
      },
      {
        value:       'get_ticket_details',
        label:       'Get Ticket',
        description: 'Fetch full details of a Jira ticket by key',
      },
      {
        value:       'ping_jira',
        label:       'Ping Jira',
        description: 'Check Jira connectivity and credentials',
      },
    ],
  },
  {
    group: 'Requirements',
    icon:  '📋',
    tools: [
      {
        value:       'search_requirements',
        label:       'Search Reqs',
        description: 'Semantic similarity search over the requirements database',
      },
      {
        value:       'get_requirement_by_id',
        label:       'Get Req by ID',
        description: 'Fetch a specific requirement by its exact ID',
      },
      {
        value:       'get_requirements_by_assignee',
        label:       'By Assignee',
        description: 'List requirements filtered by owner/assignee',
      },
      {
        value:       'get_related_requirements',
        label:       'Related Reqs',
        description: 'Find requirements similar to a given requirement',
      },
      {
        value:       'get_assignee_statistics',
        label:       'Req Stats',
        description: 'Workload breakdown and statistics by assignee',
      },
    ],
  },
]

export const ALL_TOOLS: ToolOption[] = TOOL_GROUPS.flatMap(g => g.tools)

/** Return a short label for a set of selected tools (used in the pill button). */
export function toolSelectionLabel(selected: string[]): string {
  if (selected.length === 0) return 'Auto'
  if (selected.length === 1) {
    const t = ALL_TOOLS.find(t => t.value === selected[0])
    return t?.label ?? selected[0]
  }
  return `${selected.length} tools`
}

/** Build the tool-hint string injected at the top of the user message. */
export function buildToolHintPrefix(selected: string[]): string {
  if (selected.length === 0) return ''
  const names = selected.join(', ')
  return (
    `[Tool guidance: For this request, prefer using: ${names}. ` +
    `You may still use other tools if they are necessary to fulfil the request.]\n\n`
  )
}
