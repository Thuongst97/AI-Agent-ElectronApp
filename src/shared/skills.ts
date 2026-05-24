// ── Skill definitions ─────────────────────────────────────────────────────────
// A "skill" is a named block of additional instructions injected into the agent's
// system prompt that tells it HOW to use tools for a specific task type.
// Users can enable/disable each skill and optionally override the instruction text.
//
// This file is the SINGLE SOURCE OF TRUTH for skill definitions, imported by
// both the main process (for prompt engineering) and the renderer process (for UI).

export interface SkillDefinition {
  key: string // stable identifier — used as the settings key
  label: string // display name
  icon: string // emoji icon
  description: string // one-line description shown in settings
  relatedTools: string[] // tool names this skill primarily governs
  defaultInstruction: string // injected into system prompt when enabled
}

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    key: 'jira_analysis',
    label: 'Jira Ticket Analysis',
    icon: '🎫',
    description: 'Cross-reference Jira tickets with requirements and identify gaps',
    relatedTools: ['get_ticket_details', 'search_project_tickets', 'search_requirements'],
    defaultInstruction:
      'When analysing Jira tickets:\n' +
      '1. Fetch the ticket(s) using get_ticket_details or search_project_tickets.\n' +
      '2. Call search_requirements with keywords from the ticket summary/description to find related requirements.\n' +
      '3. Output a Markdown table: Ticket Key | Summary | Status | Linked Requirement IDs | Gaps.\n' +
      '4. In the Gaps column, flag any ticket that has no matching requirement as "⚠️ No req found".\n' +
      '5. Conclude with a short risk summary.',
  },
  {
    key: 'requirement_search',
    label: 'Requirement Search',
    icon: '📋',
    description: 'Controls how requirements are displayed and when to broaden searches',
    relatedTools: ['search_requirements', 'get_requirement_by_id', 'get_related_requirements'],
    defaultInstruction:
      'When searching or listing requirements:\n' +
      '1. Always return results as a Markdown table: ID | Name | Description | Assignee | Priority.\n' +
      '2. Never show raw similarity scores.\n' +
      '3. If fewer than 3 results are returned, automatically suggest: "Try broadening the query with related terms: <suggestion>".\n' +
      '4. For a single-ID lookup, include the full description and all metadata fields.\n' +
      '5. When showing related requirements, explain the relationship in one sentence.',
  },
  {
    key: 'test_generation',
    label: 'Test Case Generation',
    icon: '🧪',
    description: 'Structure and format for generated test suites',
    relatedTools: ['search_requirements', 'get_requirement_by_id'],
    defaultInstruction:
      'When generating test cases:\n' +
      '1. First fetch the relevant requirement(s) using search_requirements or get_requirement_by_id.\n' +
      '2. For each requirement, produce three test levels: Unit | Integration | System.\n' +
      '3. Format as a table: Test ID | Level | Description | Input | Expected Output | Req ID.\n' +
      '4. Assign Test IDs as TC-<REQ_ID>-U01, TC-<REQ_ID>-I01, TC-<REQ_ID>-S01.\n' +
      '5. Add edge-case tests for boundary conditions, null inputs, and hardware faults where applicable.',
  },
  {
    key: 'gap_analysis',
    label: 'Gap Analysis',
    icon: '⚠️',
    description: 'ISO 26262 / ASPICE-aligned gap analysis with severity classification',
    relatedTools: ['search_requirements', 'get_requirements_by_assignee', 'get_assignee_statistics'],
    defaultInstruction:
      'When performing gap analysis:\n' +
      '1. Search requirements for all relevant topics using multiple queries.\n' +
      '2. Classify each gap as: Missing (requirement absent) | Incomplete (partial coverage) | Ambiguous (unclear wording).\n' +
      '3. Assign severity: Critical | Major | Minor — based on safety/functional impact.\n' +
      '4. Reference applicable standards by clause: ISO 26262-X §Y, ISO/SAE 21434 §Z, ASPICE BP.\n' +
      '5. Output as a Markdown table: Gap | Type | Severity | Affected Req IDs | Standard Reference.\n' +
      '6. Never skip the Identified Gaps section even if the list is empty — write "No gaps found" explicitly.',
  },
  {
    key: 'weekly_report',
    label: 'Weekly Report',
    icon: '📊',
    description: 'Format and structure for weekly status reports from Jira data',
    relatedTools: ['search_project_tickets', 'get_assignee_statistics'],
    defaultInstruction:
      'When generating a weekly report:\n' +
      '1. Call search_project_tickets for the current sprint / recent tickets.\n' +
      '2. Group tickets by status: Done | In Progress | Blocked | To Do.\n' +
      '3. Compute: completion % = Done / Total tickets.\n' +
      '4. Output sections: Summary | Done This Week | In Progress | Blockers | Planned Next Week.\n' +
      '5. Flag any ticket with no update in 3+ days as 🔴 Stale.\n' +
      '6. Keep bullet points concise — one line per ticket.',
  },
]