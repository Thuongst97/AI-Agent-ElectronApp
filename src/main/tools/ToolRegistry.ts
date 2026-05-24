/**
 * ToolRegistry — aggregates all tools for injection into CopilotAgentService.
 *
 * Usage:
 *   const registry = new ToolRegistry(jira)          // immediate — Jira tools ready now
 *   agentService.setToolRegistry(registry)
 *   // ... later, once VectorMemory is ready:
 *   registry.addTools(makeRequirementTools(memory))
 *
 * Tools are GitHub Copilot SDK `Tool` objects created via `defineTool()`.
 * The registry's `getAll()` output is passed whenever a new session is created.
 */

import type { Tool }              from '@github/copilot-sdk'
import type { JiraService }         from '../services/JiraService'
import { makeJiraTools }          from './jiraTools'
import { makeMermaidTools }       from './mermaidTools'
import log from 'electron-log'

export class ToolRegistry {
  private tools: Tool[]

  constructor(jira: JiraService) {
    this.tools = [
      ...makeJiraTools(jira),
      ...makeMermaidTools(),
    ]
    log.info('[ToolRegistry] Created with %d Jira tool(s)', this.tools.length)
  }

  /** Add more tools (e.g. requirement tools once VectorMemory is ready). */
  addTools(newTools: Tool[]): void {
    this.tools = [...this.tools, ...newTools]
    for (const t of newTools) {
      log.info('[ToolRegistry] Added tool: %s', (t as any).name ?? t)
    }
    log.info('[ToolRegistry] Total tools: %d', this.tools.length)
  }

  /** Return all registered tools — pass directly to createSession({ tools }). */
  getAll(): Tool[] {
    return this.tools
  }
}
